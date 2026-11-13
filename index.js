import dotenv from 'dotenv';
import makeWASocket, {
  DisconnectReason,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState,
} from 'baileys';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { createAccessControl } from './admin.js';
import { createStupidCounter } from './stupid.js';
import { createNasaScheduler, nasaMessage, nextNasaPost, sendNasaMessage } from './nasa.js';
import { createCoffeeService } from './coffee-service.js';
import { createDeletionScheduler } from './message-deletion.js';
import { createTflHandler } from './tfl.js';
import { createGifHandler } from './gif.js';
import { createLaunchHandler } from './launch.js';
import { createMessageHandler } from './commands.js';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(projectDir, '.env.coffee'), quiet: true });
dotenv.config({ path: join(projectDir, '.env'), quiet: true });
const apiKey = process.env.GIPHY_API_KEY?.trim();
const nasaApiKey = process.env.NASA_API_KEY?.trim();
const nasaGroupJid = process.env.NASA_GROUP_JID?.trim();
const tflApiKey = process.env.TFL_APP_KEY?.trim();
const tempDir = join(projectDir, 'tmp');
const nasaPostedPath = join(projectDir, 'nasa-last-post.json');
const coffeeUsagePath = join(projectDir, 'coffee-usage.json');
const scheduledDeletionsPath = join(projectDir, 'scheduled-deletions.json');
const logger = pino({ level: 'warn' });

async function main() {
  const options = new Set(process.argv.slice(2));
  const validGroup = /^\d+(?:-\d+)?@g\.us$/.test(nasaGroupJid ?? '');
  const formatUk = time => new Date(time).toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' });
  const safeError = error => {
    let message = String(error?.message ?? 'Unknown error');
    for (const secret of [nasaApiKey, nasaGroupJid]) {
      if (secret) message = message.replaceAll(secret, '[redacted]').replaceAll(encodeURIComponent(secret), '[redacted]');
    }
    const code = error?.output?.statusCode ?? error?.cause?.code;
    return `${message}${code ? ` (code ${code})` : ''}`;
  };
  console.log(`NASA configuration: API key ${nasaApiKey ? 'present' : 'missing'}; group ID ${validGroup ? 'valid format' : 'missing or invalid'}.`);
  console.log(`Current UK time: ${formatUk(Date.now())}; next daily slot: ${formatUk(nextNasaPost())}.`);
  if (options.has('--nasa-check-config')) return;
  const groupDiagnostic = options.has('--nasa-check-group') || options.has('--nasa-test-group') || options.has('--nasa-test-trigger');
  if (groupDiagnostic && !validGroup) throw new Error('Set a valid NASA_GROUP_JID in .env before running group diagnostics.');
  if (options.has('--nasa-test-trigger') && !nasaApiKey) throw new Error('Set NASA_API_KEY in .env before testing the daily trigger.');
  if (!apiKey || apiKey === 'your_giphy_api_key_here') {
    throw new Error('Set GIPHY_API_KEY in .env before starting. See README.md.');
  }
  await mkdir(tempDir, { recursive: true });
  const handleStupid = await createStupidCounter(join(projectDir, 'stupid-counters.json'));
  const access = await createAccessControl(join(projectDir, 'bot-bans.json'), process.env.BOT_ADMINS);
  const { state, saveCreds } = await useMultiFileAuthState(join(projectDir, 'auth'));
  let socket;
  let connected = false;
  let diagnosticsStarted = false;
  const checkNasaGroup = async () => {
    console.log('NASA group check: querying groups this account belongs to...');
    const groups = await socket.groupFetchAllParticipating();
    const group = Object.values(groups).find(group => group.id === nasaGroupJid);
    if (!group) throw new Error('Configured NASA_GROUP_JID was not found among this account’s groups. Check the ID and bot membership.');
    console.log(`NASA group found: ${group.subject}; ${group.announce ? 'admins-only posting (a test send will check permission)' : 'members can post'}.`);
  };
  let lastPostedDate = null;
  try {
    const saved = JSON.parse(await readFile(nasaPostedPath, 'utf8'));
    if (saved.group === nasaGroupJid && /^\d{4}-\d{2}-\d{2}$/.test(saved.date ?? '')) lastPostedDate = saved.date;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not read nasa-last-post.json; check the file before restarting.');
  }
  const nasaScheduler = createNasaScheduler(async date => {
    console.log(`NASA timer fired for ${date} at ${formatUk(Date.now())}.`);
    if (!connected) throw new Error('WhatsApp is disconnected.');
    console.log('NASA stage: fetching today’s APOD and media...');
    const content = await nasaMessage(date, { apiKey: nasaApiKey });
    if (!connected || stopping) throw new Error('WhatsApp is unavailable.');
    console.log('NASA stage: sending APOD to configured group...');
    // Scheduled NASA posts deliberately bypass automatic reply deletion.
    await sendNasaMessage(content => socket.sendMessage(nasaGroupJid, content), content);
    console.log(`NASA APOD sent for ${date}.`);
  }, {
    firstRunDelayMs: options.has('--nasa-test-trigger') ? 10_000 : undefined,
    lastPostedDate,
    savePostedDate: async date => {
      await writeFile(`${nasaPostedPath}.tmp`, JSON.stringify({ group: nasaGroupJid, date }), { mode: 0o600 });
      await rename(`${nasaPostedPath}.tmp`, nasaPostedPath);
    },
    onSchedule: due => console.log(`NASA timer scheduled: ${formatUk(due)}.`),
    onError: error => console.error(`Daily NASA post failed: ${safeError(error)} Unsent posts retry in five minutes.`),
  });
  let reconnectTimer;
  let attempts = 0;
  let stopping = false;
  let credentialWrites = Promise.resolve();
  let messageQueue = Promise.resolve();
  const deletionScheduler = createDeletionScheduler(() => socket, scheduledDeletionsPath);
  await deletionScheduler.load();
  const trackSentMessage = key => deletionScheduler.track(key).catch(error => {
    console.error('Could not schedule deletion for a bot message:', error.message);
  });
  const coffee = await createCoffeeService({
    path: coffeeUsagePath,
    getSocket: () => socket,
    isConnected: () => connected,
    isStopping: () => stopping,
    enqueue: task => {
      const pending = messageQueue.then(task);
      messageQueue = pending.catch(() => {});
      return pending;
    },
    trackSentMessage,
  });
  const handleMessage = createMessageHandler({
    trackSentMessage,
    coffee,
    handleStupid,
    access,
    handleTfl: createTflHandler(tflApiKey),
    handleGif: createGifHandler({ apiKey, tempDir }),
    handleLaunch: createLaunchHandler(),
  });

  async function stop(exitCode = 0) {
    if (stopping) return;
    stopping = true;
    clearTimeout(reconnectTimer);
    coffee.stopScheduling();
    console.log('Stopping bot...');
    await nasaScheduler.stop();
    await messageQueue;
    await deletionScheduler.stop();
    await coffee.flush();
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
        connected = true;
        attempts = 0;
        console.log('Connected. Waiting for commands in private chats and groups.');
        void deletionScheduler.deleteDueMessages();
        messageQueue = messageQueue.then(coffee.onConnected);
        if (nasaApiKey && validGroup && !options.has('--nasa-test-trigger')) nasaScheduler.start();
        if (groupDiagnostic && !diagnosticsStarted) {
          diagnosticsStarted = true;
          messageQueue = messageQueue.then(async () => {
            await checkNasaGroup();
            if (options.has('--nasa-test-group')) {
              await sock.sendMessage(nasaGroupJid, { text: 'NASA bot group test: the configured group received this message. The daily schedule is unchanged.' });
              console.log('NASA group test sent. Confirm it appeared in the intended group.');
            }
            if (options.has('--nasa-test-trigger')) {
              console.log('NASA trigger test: starting a 10-second timer using the daily posting path.');
              nasaScheduler.start();
            }
          }).catch(error => console.error(`NASA diagnostic failed: ${safeError(error)}`));
        }
      }
      if (connection === 'close') {
        connected = false;
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
  if (nasaApiKey && validGroup) {
    console.log('Daily NASA posting enabled: 09:00 UK, with same-day catch-up and five-minute retries.');
  } else {
    console.log('Daily NASA posts disabled: set NASA_API_KEY and a valid NASA_GROUP_JID in .env.');
  }
  coffee.start();
  connect();
}

main().catch(error => {
  console.error('Startup failed:', error.message);
  process.exitCode = 1;
});
