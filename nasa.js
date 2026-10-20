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

export async function nasaMessage(date, { apiKey, fetchImpl = fetch } = {}) {
  if (!apiKey?.trim()) throw new Error('Set NASA_API_KEY in .env to enable NASA posts.');
  const endpoint = new URL('https://api.nasa.gov/planetary/apod');
  endpoint.searchParams.set('api_key', apiKey);
  endpoint.searchParams.set('date', date);
  const response = await fetchImpl(endpoint, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`NASA API returned HTTP ${response.status}.`);
  const apod = await response.json();
  if (apod.date !== date || !apod.title || !apod.explanation) {
    throw new Error('NASA has not returned a complete APOD for today.');
  }
  const link = httpUrl(apod.permalink) || httpUrl(apod.url);
  const caption = [
    `NASA Astronomy Picture of the Day — ${date}`, apod.title, apod.explanation,
    apod.copyright ? `Credit: ${apod.copyright}` : null, link,
  ].filter(Boolean).join('\n\n');
  if (apod.media_type !== 'image') {
    if (!link) throw new Error('NASA returned no usable media link.');
    return { text: caption };
  }
  // New responses use url for the article; older responses use it for the image.
  const imageUrl = httpUrl(apod.hdurl) || (!apod.permalink && httpUrl(apod.url));
  if (!imageUrl) throw new Error('NASA returned no image URL.');
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
  return { image: Buffer.concat(chunks), caption };
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
