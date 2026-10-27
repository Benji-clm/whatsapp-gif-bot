export const COFFEE_UPDATE_DEADLINE_MS = 5 * 60 * 1000;
export const COFFEE_STRIKE_LIMIT = 2;

export function coffeeReminder(strikes) {
  return `You requested coffee but did not send "coffee used" within 5 minutes. Please send "coffee used" to update the subscription usage. Strike ${strikes}/${COFFEE_STRIKE_LIMIT}.${strikes >= COFFEE_STRIKE_LIMIT ? ' You are now banned from using "coffee".' : ' Missing another deadline will ban you from using "coffee".'}`;
}

// This state lives alongside daily usage, but never resets at midnight.
export class CoffeeAccountability {
  constructor(users = []) {
    if (!Array.isArray(users) || users.some(user =>
      !Array.isArray(user.ids) || !user.ids.length ||
      user.ids.some(id => typeof id !== 'string' || !/@(s\.whatsapp\.net|lid)$/.test(id)) ||
      !Number.isInteger(user.strikes) || user.strikes < 0 || user.strikes > COFFEE_STRIKE_LIMIT ||
      (user.deadline !== null && (!Number.isSafeInteger(user.deadline) || user.deadline < 0)) ||
      typeof user.reminderPending !== 'boolean'
    )) throw new Error('Invalid saved coffee accountability data');
    this.users = users;
  }

  user(ids) {
    const matches = this.users.filter(user => user.ids.some(id => ids.includes(id)));
    let user = matches[0];
    if (!user) {
      user = { ids: [], strikes: 0, deadline: null, reminderPending: false };
      this.users.push(user);
    }
    for (const other of matches.slice(1)) {
      user.ids.push(...other.ids);
      user.strikes = Math.min(COFFEE_STRIKE_LIMIT, user.strikes + other.strikes);
      user.deadline = Math.max(user.deadline ?? 0, other.deadline ?? 0) || null;
      user.reminderPending ||= other.reminderPending;
      this.users.splice(this.users.indexOf(other), 1);
    }
    user.ids = [...new Set([...user.ids, ...ids])];
    if (this.banned(user)) user.deadline = null;
    return user;
  }

  banned(user) {
    return user.strikes >= COFFEE_STRIKE_LIMIT;
  }

  requested(user, now = Date.now(), inCooldown = false) {
    if (inCooldown || this.banned(user)) return false;
    user.deadline = now + COFFEE_UPDATE_DEADLINE_MS;
    return true;
  }

  used(user) {
    user.deadline = null;
  }

  expire(now = Date.now()) {
    let changed = false;
    for (const user of this.users) {
      if (user.deadline === null || now < user.deadline) continue;
      user.deadline = null;
      user.strikes = Math.min(COFFEE_STRIKE_LIMIT, user.strikes + 1);
      user.reminderPending = true;
      changed = true;
    }
    return changed;
  }
}
