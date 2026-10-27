export const COFFEE_UPDATE_DEADLINE_MS = 5 * 60 * 1000;
export const COFFEE_WARNING_DELAY_MS = 2.5 * 60 * 1000;
export const COFFEE_STRIKE_LIMIT = 3;

export function coffeeWarning() {
  return 'Hey, I saw you didn\'t call "coffee used", did you use it? Should I send an autonomous drone with an explosive payload after you? \nThanks — Bibi.';
}

export function coffeeReminder(strikes) {
  return `You requested coffee but did not send "coffee used" within 5 minutes. Either you forgot to update, or you did not use it, and if so, why did you call it? Strike ${strikes}/${COFFEE_STRIKE_LIMIT}.${strikes >= COFFEE_STRIKE_LIMIT ? ' You are now banned from using "coffee".' : ` Missing ${COFFEE_STRIKE_LIMIT} deadline will ban you from using "coffee", and you'll have to beg to be granted back you access.`}`;
}

// This state lives alongside daily usage, but never resets at midnight.
export class CoffeeAccountability {
  constructor(users = []) {
    if (!Array.isArray(users) || users.some(user =>
      !Array.isArray(user.ids) || !user.ids.length ||
      user.ids.some(id => typeof id !== 'string' || !/@(s\.whatsapp\.net|lid)$/.test(id)) ||
      !Number.isInteger(user.strikes) || user.strikes < 0 || user.strikes > COFFEE_STRIKE_LIMIT ||
      (user.deadline !== null && (!Number.isSafeInteger(user.deadline) || user.deadline < 0)) ||
      typeof user.reminderPending !== 'boolean' ||
      (user.warningAt !== undefined && user.warningAt !== null && (!Number.isSafeInteger(user.warningAt) || user.warningAt < 0)) ||
      (user.warningPending !== undefined && typeof user.warningPending !== 'boolean')
    )) throw new Error('Invalid saved coffee accountability data');
    this.users = users;
    for (const user of users) {
      // Upgrade pending requests saved before the early warning was added.
      if (user.warningAt === undefined) user.warningAt = user.deadline === null ? null : Math.max(0, user.deadline - COFFEE_WARNING_DELAY_MS);
      user.warningPending ??= false;
    }
  }

  user(ids) {
    const matches = this.users.filter(user => user.ids.some(id => ids.includes(id)));
    let user = matches[0];
    if (!user) {
      user = { ids: [], strikes: 0, deadline: null, reminderPending: false, warningAt: null, warningPending: false };
      this.users.push(user);
    }
    for (const other of matches.slice(1)) {
      user.ids.push(...other.ids);
      user.strikes = Math.min(COFFEE_STRIKE_LIMIT, user.strikes + other.strikes);
      if ((other.deadline ?? 0) > (user.deadline ?? 0)) {
        user.deadline = other.deadline;
        user.warningAt = other.warningAt;
        user.warningPending = other.warningPending;
      }
      user.reminderPending ||= other.reminderPending;
      this.users.splice(this.users.indexOf(other), 1);
    }
    user.ids = [...new Set([...user.ids, ...ids])];
    if (this.banned(user)) this.used(user);
    return user;
  }

  banned(user) {
    return user.strikes >= COFFEE_STRIKE_LIMIT;
  }

  requested(user, now = Date.now(), inCooldown = false) {
    if (inCooldown || this.banned(user)) return false;
    user.deadline = now + COFFEE_UPDATE_DEADLINE_MS;
    user.warningAt = now + COFFEE_WARNING_DELAY_MS;
    user.warningPending = false;
    return true;
  }

  used(user) {
    user.deadline = null;
    user.warningAt = null;
    user.warningPending = false;
  }

  expire(now = Date.now()) {
    let changed = false;
    for (const user of this.users) {
      if (user.deadline === null) continue;
      if (now >= user.deadline) {
        this.used(user);
        user.strikes = Math.min(COFFEE_STRIKE_LIMIT, user.strikes + 1);
        user.reminderPending = true;
        changed = true;
      } else if (user.warningAt !== null && now >= user.warningAt) {
        user.warningAt = null;
        user.warningPending = true;
        changed = true;
      }
    }
    return changed;
  }
}
