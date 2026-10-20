const london = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', hourCycle: 'h23',
});
const parts = date => Object.fromEntries(london.formatToParts(date).map(p => [p.type, p.value]));
export const londonDate = date => {
  const p = parts(date);
  return `${p.year}-${p.month}-${p.day}`;
};

// At 09:00 UTC London is either 09:00 GMT or 10:00 BST, including transition days.
export function nextNasaPost(now = Date.now()) {
  const p = parts(now);
  for (let day = 0; day < 2; day++) {
    const nineUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day) + day, 9);
    const candidate = nineUtc - (Number(parts(nineUtc).hour) - 9) * 3_600_000;
    if (candidate > now) return candidate;
  }
}

function httpUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function plainText(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
  return String(value ?? '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '')
    .replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (match, entity) => {
      if (!entity.startsWith('#')) return entities[entity.toLowerCase()];
      const code = entity[1].toLowerCase() === 'x'
        ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
    }).replace(/\u00a0/g, ' ').trim();
}

function isGenericNasaImage(apod) {
  return /^NASA(?: Science)?$/i.test(plainText(apod.title)) ||
    [apod.hdurl, apod.url].some(url => typeof url === 'string' &&
      /(?:nasa[-_]logo|\/wp-content\/themes\/)/i.test(url));
}

export async function nasaMessage(date, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey?.trim()) throw new Error('Set NASA_API_KEY in .env to enable NASA posts.');
  const endpoint = new URL('https://api.nasa.gov/planetary/apod');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('date', date);
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`NASA API returned HTTP ${response.status}.`);
  let apod = await response.json();
  // The legacy API sometimes scrapes the site's header logo instead of APOD.
  // Recover the same date from NASA's canonical WordPress APOD feed.
  if (isGenericNasaImage(apod)) {
    const source = await fetchImpl(
      `https://science.nasa.gov/wp-json/wp/v2/apod-basic/${date.replaceAll('-', '').slice(2)}`,
      { signal: AbortSignal.timeout(30_000) },
    );
    if (!source.ok) throw new Error(`NASA APOD source returned HTTP ${source.status}.`);
    apod = await source.json();
    if (isGenericNasaImage(apod)) throw new Error('NASA returned a logo instead of the daily picture.');
  }
  if (apod.date !== date || !apod.title || !apod.explanation) {
    throw new Error('NASA has not returned a complete APOD for today.');
  }
  const link = httpUrl(apod.permalink) || httpUrl(apod.url);
  const caption = [
    `NASA Astronomy Picture of the Day — ${date}`, plainText(apod.title), plainText(apod.explanation),
    apod.copyright ? `Credit: ${plainText(apod.copyright)}` : null, link,
  ].filter(Boolean).join('\n\n');
  if (apod.media_type !== 'image') {
    if (!link) throw new Error('NASA returned no usable media link.');
    return { text: caption };
  }
  // New responses use url for the article; older responses use it for the image.
  const imageUrl = httpUrl(apod.hdurl) || (!apod.permalink && httpUrl(apod.url));
  if (!imageUrl) throw new Error('NASA returned no image URL.');
  return { image: await downloadNasaImage(imageUrl, fetchImpl), caption };
}

async function downloadNasaImage(imageUrl, fetchImpl) {
  const media = await fetchImpl(imageUrl, { signal: AbortSignal.timeout(30_000) });
  if (!media.ok || !media.headers.get('content-type')?.startsWith('image/')) {
    throw new Error('Could not download the NASA image.');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of media.body) {
    size += chunk.length;
    if (size > 16 * 1024 * 1024) throw new Error('NASA image exceeds the 16 MiB download limit.');
    chunks.push(chunk);
  }
  if (!size) throw new Error('NASA returned an empty image.');
  return Buffer.concat(chunks);
}

const TOPICS = [
  'nebula', 'galaxy', 'jupiter', 'saturn', 'moon', 'earth', 'astronaut',
  'artemis', 'hubble', 'james webb', 'rocket launch',
];
const random = items => items[Math.floor(Math.random() * items.length)];

export async function randomNasaMessage(query = '', { fetchImpl = fetch } = {}) {
  const topic = query.trim() || random(TOPICS);
  const endpoint = new URL('https://images-api.nasa.gov/search');
  endpoint.search = new URLSearchParams({ q: topic, media_type: 'image', page_size: '100', page: '1' });
  const search = async page => {
    endpoint.searchParams.set('page', String(page));
    const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`NASA image search returned HTTP ${response.status}.`);
    return (await response.json()).collection;
  };
  // Check the result count first so narrow queries never select a nonexistent page.
  let collection = await search(1);
  const pages = Math.min(5, Math.max(1, Math.ceil((Number(collection?.metadata?.total_hits) || 0) / 100)));
  const page = Math.floor(Math.random() * pages) + 1;
  if (page > 1) collection = await search(page);
  const items = Array.isArray(collection?.items) ? collection.items : [];
  const valid = items.filter(item => item.data?.[0]?.title &&
    item.links?.some(link => link.render === 'image' && httpUrl(link.href)));
  if (!valid.length) return { text: 'No NASA images found. Try another search, such as nasa galaxy.' };
  const item = random(valid);
  const meta = item.data[0];
  const imageUrl = item.links.find(link => link.render === 'image' && httpUrl(link.href)).href;
  const caption = [
    plainText(meta.title), plainText(meta.description || meta.description_508),
    meta.photographer ? `Credit: ${plainText(meta.photographer)}` : null,
    meta.nasa_id ? `https://images.nasa.gov/details/${encodeURIComponent(meta.nasa_id)}` : imageUrl,
  ].filter(Boolean).join('\n\n');
  return { image: await downloadNasaImage(imageUrl, fetchImpl), caption };
}

export function createNasaScheduler(post, {
  now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  onError = () => console.error('Daily NASA post failed; next attempt is tomorrow at 09:00 UK time.'),
} = {}) {
  let timer;
  let stopped = true;
  let running;
  const schedule = () => {
    if (stopped) return;
    const due = nextNasaPost(now());
    timer = setTimer(async () => {
      if (stopped) return;
      // A suspended machine should not replay an old morning's post on waking.
      if (now() >= due && now() < due + 60_000) {
        running = Promise.resolve().then(() => post(londonDate(due))).catch(onError);
        await running;
      }
      schedule();
    }, due - now());
  };
  return {
    start() {
      if (!stopped) return;
      stopped = false;
      schedule();
    },
    async stop() {
      stopped = true;
      clearTimer(timer);
      await running;
    },
  };
}
