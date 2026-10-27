import test from 'node:test';
import assert from 'node:assert/strict';
import { CoffeeAccountability, COFFEE_UPDATE_DEADLINE_MS as FIVE_MINUTES, coffeeReminder } from './coffee-accountability.js';

const alice = ['111@s.whatsapp.net'];
const bob = ['222@s.whatsapp.net'];

test('a deadline gives exactly one strike and a private reminder to process', () => {
  const tracker = new CoffeeAccountability();
  const user = tracker.user(alice);
  tracker.requested(user, 1000);
  assert.equal(tracker.expire(1000 + FIVE_MINUTES - 1), false);
  assert.equal(tracker.expire(1000 + FIVE_MINUTES), true);
  assert.equal(user.strikes, 1);
  assert.equal(user.reminderPending, true);
  assert.equal(tracker.expire(1000 + FIVE_MINUTES * 2), false);
  assert.equal(user.strikes, 1);
});

test('requesting again resets the deadline; confirmation cancels it', () => {
  const tracker = new CoffeeAccountability();
  const user = tracker.user(alice);
  tracker.requested(user, 1000);
  tracker.requested(user, 1000 + FIVE_MINUTES - 1);
  assert.equal(tracker.expire(1000 + FIVE_MINUTES), false);
  tracker.used(user);
  assert.equal(tracker.expire(1000 + FIVE_MINUTES * 3), false);
  assert.equal(user.strikes, 0);
});

test('another person cannot confirm or reset a requester’s deadline', () => {
  const tracker = new CoffeeAccountability();
  const first = tracker.user(alice);
  const second = tracker.user(bob);
  tracker.requested(first, 1000);
  tracker.requested(second, 2000);
  tracker.used(second);
  tracker.expire(1000 + FIVE_MINUTES);
  assert.equal(first.strikes, 1);
  assert.equal(second.strikes, 0);
});

test('cooldown requests neither create nor reset a deadline', () => {
  const tracker = new CoffeeAccountability();
  const user = tracker.user(alice);
  assert.equal(tracker.requested(user, 0, true), false);
  assert.equal(user.deadline, null);
  tracker.requested(user, 1000);
  assert.equal(tracker.requested(user, 2000, true), false);
  assert.equal(user.deadline, 1000 + FIVE_MINUTES);
});

test('linking phone and LID addresses preserves strikes and the ban', () => {
  const tracker = new CoffeeAccountability();
  const phone = tracker.user(alice);
  const lid = tracker.user(['123@lid']);
  tracker.requested(phone, 0);
  tracker.requested(lid, 0);
  tracker.expire(FIVE_MINUTES);
  const linked = tracker.user([...alice, '123@lid']);
  assert.equal(tracker.users.length, 1);
  assert.equal(tracker.banned(linked), true);
  assert.equal(tracker.user(alice), tracker.user(['123@lid']));
});

test('two misses ban the user, and a late confirmation cannot remove strikes', () => {
  const tracker = new CoffeeAccountability();
  const user = tracker.user(alice);
  tracker.requested(user, 0);
  tracker.expire(FIVE_MINUTES);
  tracker.used(user);
  assert.equal(user.strikes, 1);
  tracker.requested(user, FIVE_MINUTES + 1);
  tracker.expire(FIVE_MINUTES * 2 + 1);
  assert.equal(tracker.banned(user), true);
  tracker.used(user);
  tracker.requested(user, FIVE_MINUTES * 3);
  assert.equal(user.deadline, null);
  assert.equal(user.strikes, 2);
  assert.match(coffeeReminder(user.strikes), /now banned/);
});

test('restart preserves deadlines, strikes, reminders, and sender aliases', () => {
  let tracker = new CoffeeAccountability();
  const user = tracker.user([...alice, '123@lid']);
  tracker.requested(user, 0);
  tracker.expire(FIVE_MINUTES);
  tracker.requested(user, FIVE_MINUTES + 1);
  tracker = new CoffeeAccountability(JSON.parse(JSON.stringify(tracker.users)));
  const restored = tracker.user(['123@lid']);
  assert.equal(restored.strikes, 1);
  assert.equal(restored.reminderPending, true);
  assert.deepEqual(restored.ids, [...alice, '123@lid']);
  tracker.expire(FIVE_MINUTES * 2 + 1);
  assert.equal(tracker.banned(restored), true);
});

test('older usage files start without strikes; corrupt accountability data is rejected', () => {
  assert.deepEqual(new CoffeeAccountability(undefined).users, []);
  assert.throws(() => new CoffeeAccountability({}), /Invalid saved/);
  assert.throws(() => new CoffeeAccountability([{ ids: alice, strikes: -1, deadline: null, reminderPending: false }]), /Invalid saved/);
});
