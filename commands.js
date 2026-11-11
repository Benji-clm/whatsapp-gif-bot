import { normalizeMessageContent } from 'baileys';
import { normalizeUserId, parseAdminCommand, userIds } from './admin.js';
import { parseStupidCommand } from './stupid.js';
import { isCoffeeCommand, isCoffeeCountCommand, isCoffeeUsedCommand } from './coffee.js';
import { randomNasaMessage, sendNasaMessage } from './nasa.js';

function parseCommand(text) {
  const adminCommand = parseAdminCommand(text);
  if (adminCommand) return adminCommand;
  const stupidCommand = parseStupidCommand(text);
  if (stupidCommand) return stupidCommand;
  if (/^nasa(?:\s|$)/i.test(text)) return { name: 'nasa', query: text.slice(4).trim() };
  if (isCoffeeUsedCommand(text)) return { name: 'coffee-used' };
  if (isCoffeeCountCommand(text)) return { name: 'coffee-count' };
  if (isCoffeeCommand(text)) return { name: 'coffee' };
  if (/^gif(?:\s|$)/i.test(text)) {
    return { name: 'gif', query: text.slice(3).trim() };
  }
  if (/^inshallah\s*$/i.test(text)) {
    return { name: 'inshallah' };
  }
  if (/^tfl(?:\s|$)/i.test(text)) {
    return { name: 'tfl', input: text.slice(3).trim() };
  }
  return null;
}

export function createMessageHandler({ trackSentMessage, coffee, handleStupid, access, handleTfl, handleGif }) {
  async function handleMessage(sock, message) {
    const jid = message.key.remoteJid;
    if (message.key.fromMe || !jid || !/@(s\.whatsapp\.net|lid|g\.us)$/.test(jid)) return;
    const content = normalizeMessageContent(message.message);
    const text = content?.conversation ?? content?.extendedTextMessage?.text ?? '';
    const command = parseCommand(text);
    if (!command) return;
    const group = jid.endsWith('@g.us');
    const senderIds = await userIds(sock, group
      ? [message.key.participant, message.key.participantAlt]
      : [jid, message.key.remoteJidAlt]);
    if (!senderIds.length || access.isBanned(senderIds)) return;
    const sendBotMessage = async (content, options = {}) => {
      const sent = await sock.sendMessage(jid, content, { quoted: message, ...options });
      await trackSentMessage(sent.key);
      return sent;
    };
    const reply = text => sendBotMessage({ text });
    if (command.name === 'admin') {
      if (!access.isAdmin(senderIds)) {
        await reply('This command is for bot admins only.');
        return;
      }
      if (command.action === 'clear') {
        await handleStupid(command, reply);
        return;
      }
      const mentions = [...new Set(content?.extendedTextMessage?.contextInfo?.mentionedJid ?? [])];
      if (mentions.length !== 1 || !normalizeUserId(mentions[0])) {
        await reply(`Usage: ${command.action} @person (select one person from the WhatsApp mention menu).`);
        return;
      }
      const targetIds = await userIds(sock, mentions);
      await access.setBanned(targetIds, command.action === 'ban');
      await reply(command.action === 'ban' ? 'User banned from using the bot.' : 'User unbanned.');
      return;
    }
    if (command.name === 'stupid-counter') {
      await handleStupid(command, reply);
      return;
    }
    if (command.name === 'nasa') {
      if ([...command.query].length > 200) {
        await reply('Please keep your NASA search to 200 characters or fewer.');
        return;
      }
      console.log('NASA request received.');
      try {
        const content = await randomNasaMessage(command.query);
        if (!content.image) {
          await reply(content.text);
          return;
        }
        // Manual NASA posts are permanent too, just like the daily post.
        await sendNasaMessage(content => sock.sendMessage(jid, content, { quoted: message }), content);
        console.log('Random NASA image sent.');
      } catch {
        console.error('NASA request failed.');
        await reply('Could not fetch or send a NASA image. Please try again later.');
      }
      return;
    }
    if (command.name === 'coffee-used') {
      await coffee.markCoffeeUsed(sendBotMessage, senderIds);
      return;
    }
    if (command.name === 'coffee-count') {
      await coffee.showCoffeeCount(sendBotMessage);
      return;
    }
    if (command.name === 'coffee') {
      await coffee.requestCoffee(sendBotMessage, senderIds);
      return;
    }
    if (command.name === 'tfl') {
      await handleTfl(command.input, reply);
      return;
    }
    if (command.name === 'inshallah') {
      await reply("Allah yisma' minnak");
      return;
    }
    await handleGif(command.query, sendBotMessage);
  }
  return handleMessage;
}
