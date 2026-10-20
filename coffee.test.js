import assert from 'node:assert/strict';
import { test } from 'node:test';
import { coffeeImage, coffeePayload, handleCoffee, isCoffeeCommand } from './coffee.js';

const env = { PRET_PUBLIC_ID: 'test-wallet-123', PRET_QR_SIGNING_KEY: 'test-signing-key' };

test('exact coffee command, case insensitive, without matching ordinary phrases', () => {
  for (const text of ['coffee', 'COFFEE', 'Coffee \n']) assert.equal(isCoffeeCommand(text), true);
  for (const text of ['coffeehouse', 'coffee please', 'a coffee', 'gif coffee']) {
    assert.equal(isCoffeeCommand(text), false);
  }
});

test('payload matches independent Python HMAC/Base64 fixture', () => {
  assert.equal(coffeePayload(env, 1700000000),
    'PR_dGVzdC13YWxsZXQtMTIzOjE3MDAwMDAwMDA6YjlkM2RkNjdhNzY3YmYzMzcxNmQ2OTI4ZWJjNWVmOTNiNzQzM2E0M2VlOGI3OGUxNGY0NDMyZmJhMTg1NzFjMw==');
  assert.notEqual(coffeePayload(env, 1700000000), coffeePayload(env, 1700000001));
});

test('missing/invalid credentials fail without including their values', () => {
  assert.throws(() => coffeePayload({}), /not configured/);
  assert.throws(() => coffeePayload({ ...env, PRET_PUBLIC_ID: 'secret:invalid' }),
    { message: 'Invalid coffee configuration.' });
});

test('image is a PNG and default timestamp is current', async () => {
  const before = Math.floor(Date.now() / 1000);
  const decoded = Buffer.from(coffeePayload(env).slice(3), 'base64').toString();
  const timestamp = Number(decoded.split(':')[1]);
  assert.ok(timestamp >= before && timestamp <= Math.floor(Date.now() / 1000));
  const image = await coffeeImage(env);
  assert.deepEqual(image.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
});

test('handler sends an image or an actionable unconfigured reply', async () => {
  const replies = [];
  await handleCoffee(async message => { replies.push(message); }, env);
  assert.ok(Buffer.isBuffer(replies[0].image));
  assert.match(replies[0].caption, /Fresh coffee/);
  await handleCoffee(async message => { replies.push(message); }, {});
  assert.match(replies[1].text, /not configured/);
  assert.equal(replies[1].image, undefined);
});

test('send failure produces a generic retry reply without credentials', async t => {
  t.mock.method(console, 'error', () => {});
  const replies = [];
  await handleCoffee(async message => {
    if (message.image) throw new Error('simulated upload error with private content');
    replies.push(message);
  }, env);
  assert.deepEqual(replies, [{ text: 'Could not send a coffee QR. Please try again.' }]);
});
