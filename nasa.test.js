import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNasaScheduler, nasaMessage, nextNasaPost } from './nasa.js';

test('09:00 London handles GMT, BST, clock changes, midnight and restarts', () => {
  for (const [now, next] of [
    ['2026-01-01T08:00:00Z', '2026-01-01T09:00:00Z'],
    ['2026-07-01T07:00:00Z', '2026-07-01T08:00:00Z'],
    ['2026-03-28T10:00:00Z', '2026-03-29T08:00:00Z'],
    ['2026-10-24T10:00:00Z', '2026-10-25T09:00:00Z'],
    ['2026-07-01T08:00:00Z', '2026-07-02T08:00:00Z'],
    ['2026-12-31T23:30:00Z', '2027-01-01T09:00:00Z'],
    ['2026-06-30T23:30:00Z', '2026-07-01T08:00:00Z'],
  ]) assert.equal(nextNasaPost(Date.parse(now)), Date.parse(next));
});

test('one sleeping timer posts once, skips suspension, and stops', async () => {
  let time = Date.parse('2026-07-01T07:00:00Z');
  let callback, delay, cleared;
  let timers = 0;
  const posts = [];
  const scheduler = createNasaScheduler(date => posts.push(date), {
    now: () => time,
    setTimer: (fn, ms) => { callback = fn; delay = ms; return ++timers; },
    clearTimer: id => { cleared = id; },
  });
  scheduler.start();
  scheduler.start();
  assert.equal(timers, 1);
  assert.equal(delay, 3_600_000);
  time += delay;
  await callback();
  assert.deepEqual(posts, ['2026-07-01']);
  assert.equal(delay, 86_400_000);
  time += delay + 120_000;
  await callback();
  assert.equal(posts.length, 1);
  await scheduler.stop();
  assert.equal(cleared, timers);
  await callback();
  assert.equal(posts.length, 1);
});

test('failed post logs once and schedules tomorrow', async () => {
  let time = Date.parse('2026-01-01T08:00:00Z');
  let callback;
  let errors = 0, timers = 0;
  const scheduler = createNasaScheduler(() => { throw new Error('offline'); }, {
    now: () => time, setTimer: fn => { callback = fn; timers++; }, clearTimer: () => {},
    onError: () => { errors++; },
  });
  scheduler.start();
  time += 3_600_000;
  await callback();
  assert.equal(errors, 1);
  assert.equal(timers, 2);
  await scheduler.stop();
});

const apod = {
  date: '2026-10-20', title: 'A nebula', explanation: 'The full NASA description.',
  media_type: 'image', permalink: 'https://science.nasa.gov/example/',
  url: 'https://science.nasa.gov/example/', hdurl: 'https://example.com/image.jpg',
};

test('current and legacy images include full description', async () => {
  for (const data of [apod, { ...apod, permalink: undefined, hdurl: undefined, url: apod.hdurl }]) {
    const calls = [];
    const message = await nasaMessage(apod.date, { apiKey: 'test-key', fetchImpl: async url => {
      calls.push(String(url));
      return calls.length === 1 ? Response.json(data) : new Response(new Uint8Array([1, 2, 3]), {
        headers: { 'content-type': 'image/jpeg' },
      });
    } });
    assert.equal(new URL(calls[0]).searchParams.get('date'), apod.date);
    assert.equal(calls[1], apod.hdurl);
    assert.ok(Buffer.isBuffer(message.image));
    assert.ok(message.caption.includes(apod.explanation));
  }
});

test('video and iframe days send link and description without downloading', async () => {
  for (const media_type of ['video', 'iframe']) {
    let calls = 0;
    const message = await nasaMessage(apod.date, { apiKey: 'test-key', fetchImpl: async () => {
      calls++;
      return Response.json({ ...apod, media_type });
    } });
    assert.equal(calls, 1);
    assert.ok(message.text.includes(apod.permalink));
    assert.ok(message.text.includes(apod.explanation));
    assert.equal(message.image, undefined);
  }
});

test('unavailable or stale APOD and invalid media fail before sending', async () => {
  await assert.rejects(nasaMessage(apod.date, { apiKey: 'test-key', fetchImpl: async () => new Response('', { status: 503 }) }), /HTTP 503/);
  await assert.rejects(nasaMessage(apod.date, { apiKey: 'test-key', fetchImpl: async () => Response.json({ ...apod, date: '2026-10-19' }) }), /complete APOD/);
  let calls = 0;
  await assert.rejects(nasaMessage(apod.date, { apiKey: 'test-key', fetchImpl: async () => ++calls === 1
    ? Response.json(apod) : new Response('<html>error</html>', { headers: { 'content-type': 'text/html' } }),
  }), /download/);
});

test('NASA requires an explicit API key before fetching', async () => {
  await assert.rejects(nasaMessage(apod.date, { fetchImpl: () => { assert.fail('must not fetch'); } }), /Set NASA_API_KEY/);
});
