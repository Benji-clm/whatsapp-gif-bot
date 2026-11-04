import { readFile, writeFile, rename } from 'node:fs/promises';
import { COFFEE_DAILY_LIMIT, coffeeCooldownWarning, coffeeUsageDay, handleCoffee } from './coffee.js';
import { CoffeeAccountability, coffeeReminder, coffeeWarning } from './coffee-accountability.js';

export async function createCoffeeService({ path: coffeeUsagePath, getSocket, isConnected, isStopping, enqueue, trackSentMessage }) {
  async function loadCoffeeUsage() {
    try {
      const stored = JSON.parse(await readFile(coffeeUsagePath, 'utf8'));
      if (typeof stored.day !== 'string' || !Number.isInteger(stored.usedCount) || stored.usedCount < 0) {
        throw new Error('Invalid saved data');
      }
      return {
        day: stored.day,
        usedCount: Math.min(stored.usedCount, COFFEE_DAILY_LIMIT),
        lastUsedAt: Number.isSafeInteger(stored.lastUsedAt) && stored.lastUsedAt >= 0 ? stored.lastUsedAt : null,
        coffeeUsers: new CoffeeAccountability(stored.coffeeUsers).users,
      };
    } catch (error) {
      if (error.code !== 'ENOENT') throw new Error(`Could not load coffee usage: ${error.message}`);
      return { day: coffeeUsageDay(), usedCount: 0, lastUsedAt: null, coffeeUsers: [] };
    }
  }

  let coffeeWrites = Promise.resolve();
  let coffeeUsage = await loadCoffeeUsage();
  const coffeeAccountability = new CoffeeAccountability(coffeeUsage.coffeeUsers);
  let coffeeTimer;
  const currentCoffeeUsage = () => {
    const today = coffeeUsageDay();
    if (coffeeUsage.day !== today) coffeeUsage = { ...coffeeUsage, day: today, usedCount: 0 };
    return coffeeUsage;
  };
  const saveCoffeeUsage = () => {
    const contents = JSON.stringify(coffeeUsage);
    coffeeWrites = coffeeWrites.then(async () => {
      const temporaryPath = `${coffeeUsagePath}.tmp`;
      await writeFile(temporaryPath, contents);
      await rename(temporaryPath, coffeeUsagePath);
    }).catch(error => {
      console.error('Could not save coffee usage:', error.message);
    });
    return coffeeWrites;
  };
  const scheduleCoffeeCheck = () => {
    clearTimeout(coffeeTimer);
    if (isStopping()) return;
    const deadlines = coffeeAccountability.users.flatMap(user => [user.deadline, user.warningAt].filter(time => time !== null));
    if (coffeeAccountability.users.some(user => user.reminderPending || user.warningPending)) deadlines.push(Date.now() + 60_000);
    if (!deadlines.length) return;
    coffeeTimer = setTimeout(() => {
      enqueue(checkCoffeeDeadlines).catch(error => {
        console.error('Could not process coffee deadlines:', error.message);
      }).finally(scheduleCoffeeCheck);
    }, Math.max(0, Math.min(...deadlines) - Date.now()));
  };
  const checkCoffeeDeadlines = async () => {
    if (isStopping()) return;
    if (coffeeAccountability.expire()) await saveCoffeeUsage();
    if (!isConnected()) return;
    for (const user of coffeeAccountability.users) {
      for (const notification of ['reminderPending', 'warningPending']) {
        if (!user[notification]) continue;
        try {
          const recipient = user.ids.find(id => id.endsWith('@s.whatsapp.net')) ?? user.ids[0];
          const text = notification === 'warningPending' ? coffeeWarning() : coffeeReminder(user.strikes);
          const sent = await getSocket().sendMessage(recipient, { text });
          user[notification] = false;
          await saveCoffeeUsage();
          await trackSentMessage(sent.key);
        } catch {
          console.error('Could not send a private coffee reminder; retrying in one minute.');
        }
      }
    }
  };
  const requestCoffee = async (send, senderIds) => {
    const user = coffeeAccountability.user(senderIds);
    await checkCoffeeDeadlines();
    scheduleCoffeeCheck();
    if (coffeeAccountability.banned(user)) {
      await send({ text: 'You are banned from using "coffee" after missing two "coffee used" deadlines.' });
      return;
    }
    const usage = currentCoffeeUsage();
    if (usage.usedCount >= COFFEE_DAILY_LIMIT) {
      await send({ text: `Coffee limit reached for today (${COFFEE_DAILY_LIMIT}/${COFFEE_DAILY_LIMIT}). Try again tomorrow.` });
      return;
    }
    const warning = coffeeCooldownWarning(usage.lastUsedAt);
    if (warning) await send({ text: warning });
    const instructions = warning ? '' : '\nSend "coffee used" within 5 minutes. Two missed deadlines result in a coffee ban.';
    if (!await handleCoffee(send, process.env, `Pret Subscription QR code ☕\nUsed today: ${usage.usedCount}/${COFFEE_DAILY_LIMIT}${instructions}`)) return;
    // A QR requested during cooldown never creates or resets a deadline.
    if (coffeeAccountability.requested(user, Date.now(), Boolean(warning))) {
      await saveCoffeeUsage();
      scheduleCoffeeCheck();
    }
    console.log(`Coffee QR sent (${usage.usedCount}/${COFFEE_DAILY_LIMIT} used today).`);
  };
  const showCoffeeCount = async send => {
    const usage = currentCoffeeUsage();
    await send({ text: `Coffee uses today: ${usage.usedCount}/${COFFEE_DAILY_LIMIT}.` });
  };
  const markCoffeeUsed = async (send, senderIds) => {
    const user = coffeeAccountability.user(senderIds);
    await checkCoffeeDeadlines();
    coffeeAccountability.used(user);
    await saveCoffeeUsage();
    scheduleCoffeeCheck();
    const usage = currentCoffeeUsage();
    if (usage.usedCount >= COFFEE_DAILY_LIMIT) {
      await send({ text: `Coffee is already at ${COFFEE_DAILY_LIMIT}/${COFFEE_DAILY_LIMIT} for today.` });
      return;
    }
    coffeeUsage = {
      ...usage,
      usedCount: usage.usedCount + 1,
      lastUsedAt: Date.now(),
    };
    await saveCoffeeUsage();
    await send({ text: `Coffee marked as used (${coffeeUsage.usedCount}/${COFFEE_DAILY_LIMIT} today).` });
    console.log(`Coffee use recorded (${coffeeUsage.usedCount}/${COFFEE_DAILY_LIMIT}); 30-minute cooldown started.`);
  };

  return {
    requestCoffee,
    markCoffeeUsed,
    showCoffeeCount,
    start: scheduleCoffeeCheck,
    async onConnected() {
      try {
        await checkCoffeeDeadlines();
      } catch (error) {
        console.error('Could not process coffee deadlines:', error.message);
      } finally {
        scheduleCoffeeCheck();
      }
    },
    stopScheduling: () => clearTimeout(coffeeTimer),
    flush: () => coffeeWrites,
  };
}
