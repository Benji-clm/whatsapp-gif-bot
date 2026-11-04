import { readFile, writeFile, rename } from 'node:fs/promises';
import { jidNormalizedUser } from 'baileys';

export function normalizeUserId(value) {
  const text = String(value ?? '').trim();
  if (/^\+?\d+$/.test(text)) return `${text.replace(/^\+/, '')}@s.whatsapp.net`;
  const jid = jidNormalizedUser(text);
  return /^\d+@(s\.whatsapp\.net|lid)$/.test(jid) ? jid : null;
}

export async function userIds(sock, values) {
  const ids = new Set(values.map(normalizeUserId).filter(Boolean));
  const mapping = sock.signalRepository?.lidMapping;
  for (const id of [...ids]) {
    const other = id.endsWith('@lid')
      ? await mapping?.getPNForLID(id) : await mapping?.getLIDForPN(id);
    const normalized = normalizeUserId(other);
    if (normalized) ids.add(normalized);
  }
  return [...ids];
}

export function parseAdminCommand(text) {
  const match = text.match(/^(clear|ban|unban)(?:\s+(.*))?\s*$/i);
  return match ? { name: 'admin', action: match[1].toLowerCase(), target: match[2]?.trim() ?? '' } : null;
}

export async function createAccessControl(path, configuredAdmins = '') {
  const admins = new Set();
  for (const value of configuredAdmins.split(',').map(value => value.trim()).filter(Boolean)) {
    const id = normalizeUserId(value);
    if (!id) throw new Error('Invalid BOT_ADMINS entry. Use international phone numbers or WhatsApp user IDs.');
    admins.add(id);
  }
  let bans = [];
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(saved) || saved.some(ids => !Array.isArray(ids) || !ids.length
      || ids.some(id => !normalizeUserId(id)))) throw new Error('Invalid bans file');
    bans = saved.map(ids => ids.map(normalizeUserId));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load bot-bans.json; check the file before restarting.');
  }
  return {
    isAdmin: ids => ids.some(id => admins.has(id)),
    isBanned: ids => bans.some(ban => ban.some(id => ids.includes(id))),
    async setBanned(ids, banned) {
      if (!ids.length) throw new Error('No WhatsApp user identity found.');
      const matching = bans.filter(ban => ban.some(id => ids.includes(id)));
      const next = bans.filter(ban => !ban.some(id => ids.includes(id)));
      if (banned) next.push([...new Set([...ids, ...matching.flat()])]);
      await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
      await rename(`${path}.tmp`, path);
      bans = next;
    },
  };
}
