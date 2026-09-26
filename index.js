import dotenv from 'dotenv';
import makeWASocket, {
  DisconnectReason,
  jidNormalizedUser,
  makeCacheableSignalKeyStore,
  normalizeMessageContent,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(projectDir, '.env'), quiet: true });
const apiKey = process.env.GIPHY_API_KEY?.trim();
const tempDir = join(projectDir, 'tmp');
const logger = pino({ level: 'warn' });
const MAX_DOWNLOAD_BYTES = 16 * 1024 * 1024;

async function searchGif(query) {
  const url = new URL('https://api.giphy.com/v1/gifs/search');
  url.search = new URLSearchParams({ api_key: apiKey, q: query, limit: '20' });
  let response;
  let result;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (response.ok) result = await response.json();
  } catch {
    throw new Error('Could not reach GIPHY. Please try again shortly.');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('GIPHY rejected the API key. Ask the bot owner to check GIPHY_API_KEY.');
  }
  if (response.status === 429) {
    throw new Error('GIPHY rate limit reached. Please try again later.');
  }
  if (!response.ok || !Array.isArray(result?.data)) {
    throw new Error('GIPHY search failed. Please try again shortly.');
  }
  if (!result.data.length) {
    throw new Error('No GIFs found. Try a different search.');
  }
  const choices = result.data.slice(0, 10).map(gif => ({
    url: gif.images?.fixed_height?.mp4 || gif.images?.original?.mp4,
  })).filter(gif => gif.url);
  if (!choices.length) {
    throw new Error('No WhatsApp-compatible GIFs found. Try a different search.');
  }
  return choices[Math.floor(Math.random() * choices.length)];
}

async function downloadGif(url, destination) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok || !response.body) throw new Error('Download failed');
    if (Number(response.headers.get('content-length')) > MAX_DOWNLOAD_BYTES) {
      await response.body.cancel();
      throw new Error('Too large');
    }
    await pipeline(response.body, async function* (source) {
      let bytes = 0;
      for await (const chunk of source) {
        bytes += chunk.length;
        if (bytes > MAX_DOWNLOAD_BYTES) throw new Error('Too large');
        yield chunk;
      }
      if (!bytes) throw new Error('Empty download');
    }, createWriteStream(destination));
  } catch {
    throw new Error('Could not download that GIF (it may be too large). Please try again.');
  }
}

function extractQuery(text, mentionedJids = [], user = {}) {
  if (/^@gif-bot(?:\s|$)/.test(text)) return text.slice('@gif-bot'.length).trim();
  const token = text.match(/^@([^\s]+)(?:\s|$)/)?.[1];
  if (!token) return null;
  const ownIds = [user.id, user.lid, user.phoneNumber].filter(Boolean).map(jidNormalizedUser);
  const mentionsBot = mentionedJids.some(jid => {
    const normalized = jidNormalizedUser(jid);
    return ownIds.includes(normalized) && normalized.split('@')[0] === token;
  });
  return mentionsBot ? text.slice(token.length + 1).trim() : null;
}

async function handleMessage(sock, message) {
  const jid = message.key.remoteJid;
  if (message.key.fromMe || !jid || !/@(s\.whatsapp\.net|lid|g\.us)$/.test(jid)) return;
  const content = normalizeMessageContent(message.message);
  const text = content?.conversation ?? content?.extendedTextMessage?.text ?? '';
  const mentionedJids = content?.extendedTextMessage?.contextInfo?.mentionedJid ?? [];
  const query = extractQuery(text, mentionedJids, sock.user);
  if (query === null) {
    if (mentionedJids.length) console.log('Ignored mention: message must start with a mention of this bot account.');
    return;
  }
  const reply = text => sock.sendMessage(jid, { text }, { quoted: message });
  if (!query) {
    await reply('Usage: @gif-bot <search>');
    return;
  }
  if ([...query].length > 50) {
    await reply('Please keep your GIF search to 50 characters or fewer.');
    return;
  }

  console.log('GIF request received.');
  let requestDir;
  try {
    const gif = await searchGif(query);
    requestDir = await mkdtemp(join(tempDir, 'gif-'));
    const filename = join(requestDir, 'animation.mp4');
    await downloadGif(gif.url, filename);
    try {
      await sock.sendMessage(jid, {
        video: { url: filename },
        mimetype: 'video/mp4',
        gifPlayback: true,

        jpegThumbnail: Buffer.alloc(0),
      }, { quoted: message });
    } catch {
      throw new Error('Could not send the GIF to WhatsApp. Please try again.');
    }
    console.log('GIF sent.');
  } catch (error) {
    console.error('GIF request failed:', error.message);
    await reply(error.message);
  } finally {
    if (requestDir) await rm(requestDir, { recursive: true, force: true });
  }
}

async function main() {
  if (!apiKey || apiKey === 'your_giphy_api_key_here') {
    throw new Error('Set GIPHY_API_KEY in .env before starting. See README.md.');
  }
  await mkdir(tempDir, { recursive: true });
  const { state, saveCreds } = await useMultiFileAuthState(join(projectDir, 'auth'));
  let socket;
  let reconnectTimer;
  let attempts = 0;
  let stopping = false;
  let credentialWrites = Promise.resolve();
  let messageQueue = Promise.resolve();

  async function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    clearTimeout(reconnectTimer);
    console.log('Stopping bot...');
    await messageQueue;
    socket?.end(new Error('Bot stopped'));
    await credentialWrites;
    process.exitCode = exitCode;
  }
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });

  function reconnect(immediate = false) {
    if (stopping || reconnectTimer) return;
    const delay = immediate ? 0 : Math.min(30_000, 1000 * 2 ** Math.min(attempts++, 5));
    console.log(`Reconnecting in ${delay / 1000}s...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      connect();
    }, delay);
  }

  function connect() {
    if (stopping) return;
    let sock;
    try {
      sock = makeWASocket({
        auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
        logger,
        markOnlineOnConnect: false,
        syncFullHistory: false,
      });
    } catch {
      console.error('Could not create WhatsApp connection.');
      reconnect();
      return;
    }
    socket = sock;
    sock.ev.on('creds.update', () => {
      credentialWrites = credentialWrites.then(saveCreds).catch(() => {
        console.error('Could not save credentials. Check auth/ permissions and disk space.');
        void stop(1);
      });
    });
    sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
      if (stopping || socket !== sock) return;
      if (qr) {
        console.log('Scan this QR using the spare account: WhatsApp > Linked devices > Link a device.');
        qrcode.generate(qr, { small: true });
      }
      if (connection === 'open') {
        attempts = 0;
        console.log('Connected. Waiting for @gif-bot <search> or a leading mention of this account.');
      }
      if (connection === 'close') {
        sock.ev.removeAllListeners('messages.upsert');
        const code = lastDisconnect?.error?.output?.statusCode;
        console.log(`WhatsApp connection closed (code ${code ?? 'unknown'}).`);
        const terminalCodes = [DisconnectReason.loggedOut, DisconnectReason.badSession,
          DisconnectReason.connectionReplaced, DisconnectReason.multideviceMismatch,
          DisconnectReason.forbidden];
        if (terminalCodes.includes(code)) {
          console.error('Session needs attention. See the README troubleshooting section.');
          void stop(1);
        } else {
          reconnect(code === DisconnectReason.restartRequired);
        }
      }
    });
    sock.ev.on('messages.upsert', ({ type, messages }) => {
      console.log(`WhatsApp message event: ${messages.length} message(s), type=${type}, own=${messages.filter(message => message.key.fromMe).length}.`);
      if (type !== 'notify' || stopping) return;
      for (const message of messages) {
        messageQueue = messageQueue.then(async () => {
          if (!stopping && socket === sock) await handleMessage(sock, message);
        }).catch(() => console.error('Could not handle/reply to a message. Check the connection and disk space.'));
      }
    });
  }
  connect();
}

main().catch(error => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});
