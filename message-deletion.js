import { readFile, writeFile, rename } from 'node:fs/promises';

const AUTO_DELETE_DELAY_MS = 60 * 60 * 1000;
const DELETE_RETRY_DELAY_MS = 60 * 1000;

export function createDeletionScheduler(getSocket, scheduledDeletionsPath) {
  let pending = [];
  let timer;
  let writeQueue = Promise.resolve();

  const persist = () => {
    const contents = JSON.stringify(pending, null, 2);
    writeQueue = writeQueue.then(async () => {
      const temporaryPath = `${scheduledDeletionsPath}.tmp`;
      await writeFile(temporaryPath, contents);
      await rename(temporaryPath, scheduledDeletionsPath);
    }).catch(error => {
      console.error('Could not save scheduled message deletions:', error.message);
    });
    return writeQueue;
  };

  const scheduleNext = () => {
    clearTimeout(timer);
    const next = pending.reduce((soonest, item) => {
      const dueAt = item.nextAttemptAt ?? item.deleteAt;
      return !soonest || dueAt < soonest ? dueAt : soonest;
    }, null);
    if (next === null) return;
    timer = setTimeout(() => { void deleteDueMessages(); }, Math.max(0, next - Date.now()));
  };

  const retryDueMessages = async () => {
    const now = Date.now();
    pending = pending.map(item => (item.deleteAt <= now ? {
      ...item, nextAttemptAt: now + DELETE_RETRY_DELAY_MS,
    } : item));
    await persist();
  };

  const deleteDueMessages = async () => {
    const now = Date.now();
    const due = pending.filter(item => item.deleteAt <= now && (item.nextAttemptAt ?? 0) <= now);
    if (!due.length) {
      scheduleNext();
      return;
    }
    const sock = getSocket();
    if (!sock) {
      await retryDueMessages();
      scheduleNext();
      return;
    }
    for (const item of due) {
      try {
        await sock.sendMessage(item.key.remoteJid, { delete: item.key });
        pending = pending.filter(candidate => (
          candidate.key.id !== item.key.id || candidate.key.remoteJid !== item.key.remoteJid
        ));
        console.log(`Deleted bot message ${item.key.id} for everyone.`);
      } catch (error) {
        console.error(`Could not delete bot message ${item.key.id}; will retry:`, error.message);
        pending = pending.map(candidate => (
          candidate.key.id === item.key.id && candidate.key.remoteJid === item.key.remoteJid ? {
          ...candidate, nextAttemptAt: Date.now() + DELETE_RETRY_DELAY_MS,
          } : candidate
        ));
      }
    }
    await persist();
    scheduleNext();
  };

  return {
    async load() {
      try {
        const stored = JSON.parse(await readFile(scheduledDeletionsPath, 'utf8'));
        pending = Array.isArray(stored) ? stored.filter(item => (
          item && Number.isFinite(item.deleteAt) && item.key?.id && item.key?.remoteJid
        )) : [];
      } catch (error) {
        if (error.code !== 'ENOENT') console.error('Could not load scheduled message deletions:', error.message);
      }
      scheduleNext();
    },
    async track(key) {
      if (!key?.id || !key.remoteJid) return;
      pending.push({ key, deleteAt: Date.now() + AUTO_DELETE_DELAY_MS });
      await persist();
      scheduleNext();
    },
    deleteDueMessages,
    async stop() {
      clearTimeout(timer);
      await writeQueue;
    },
  };
}
