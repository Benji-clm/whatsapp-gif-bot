const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const HELP = [
  'Launch commands:',
  'launch — next launch worldwide',
  'launch <agency> — next launch involving that agency (e.g. spacex, nasa, ula)',
  'launch live [agency] — launches currently in flight',
  'launch status [agency] — latest launch at or before now, with its current status',
  'Times are UK time. Schedules can change; live data may be delayed.',
].join('\n');

const normalize = value => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dateMs = value => value ? Date.parse(value) : NaN;
const ukTime = value => new Date(value).toLocaleString('en-GB', {
  timeZone: 'Europe/London', timeZoneName: 'short',
});

function duration(ms) {
  let seconds = Math.floor(Math.abs(ms) / 1000);
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  return `${days ? `${days}d ` : ''}${hours}h ${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function formatLaunch(launch, now) {
  const net = dateMs(launch.net);
  const precision = launch.net_precision;
  const precise = [0, 1].includes(precision?.id);
  const flown = [3, 4, 6, 7, 9].includes(launch.status?.id);
  let timing = 'Launch time: TBC';
  let countdown = 'T−: unavailable until the launch time is confirmed';
  if (Number.isFinite(net)) {
    if (precise) {
      timing = `${flown ? 'Launch time' : 'Expected launch (NET)'}: ${ukTime(net)}`;
      if (flown && net <= now) countdown = `T+ ${duration(now - net)}`;
      else if (launch.status?.id === 5) countdown = 'T−: on hold';
      else if (net > now) countdown = `T− ${duration(net - now)}${launch.status?.id === 1 ? '' : ' (provisional)'}`;
      else countdown = 'Scheduled time has passed; awaiting an updated time or liftoff confirmation.';
    } else {
      // Do not present a month/year placeholder as an exact launch time.
      const iso = new Date(net).toISOString();
      const estimate = precision?.id === 7 ? iso.slice(0, 7)
        : precision?.id >= 8 ? `${precision.name}, ${iso.slice(0, 4)}` : iso.slice(0, 10);
      timing = `Launch estimate: ${estimate} UTC (precision: ${precision?.name || 'unknown'}; exact time TBC)`;
    }
  }
  const stream = launch.vid_urls?.find(video => /^https?:\/\//i.test(video.url ?? ''))?.url;
  return [
    launch.name || launch.mission?.name || 'Unnamed launch',
    launch.mission?.name && launch.mission.name !== launch.name ? `Mission: ${launch.mission.name}` : null,
    launch.launch_service_provider?.name ? `Provider: ${launch.launch_service_provider.name}` : null,
    timing, countdown,
    `Status: ${launch.status?.name || 'Unknown'}`,
    launch.failreason ? `Details: ${launch.failreason}` : null,
    stream ? `Watch${launch.webcast_live ? ' (webcast live)' : ''}: ${stream}` : null,
  ].filter(Boolean).join('\n');
}

export function createLaunchHandler({
  baseUrl = process.env.LAUNCH_API_BASE_URL || 'https://ll.thespacedevs.com/2.3.0/',
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const cache = new Map();
  const pending = new Map();
  let calls = [];
  let blockedUntil = 0;

  async function cached(key, ttl, load) {
    const hit = cache.get(key);
    if (hit && now() - hit.time < ttl) return hit;
    if (pending.has(key)) return pending.get(key);
    const request = (async () => {
      const value = await load();
      const entry = { value, time: now() };
      if (cache.size >= 200) cache.delete(cache.keys().next().value);
      cache.set(key, entry);
      return entry;
    })();
    pending.set(key, request);
    try { return await request; }
    finally { pending.delete(key); }
  }

  async function api(path, params) {
    const time = now();
    calls = calls.filter(call => time - call < HOUR);
    if (time < blockedUntil || calls.length >= 14) {
      throw new Error('Launch API request allowance reached. Please try again later.');
    }
    calls.push(time);
    const url = new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`);
    url.search = new URLSearchParams({ format: 'json', ...params });
    let response;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(20_000) });
    } catch {
      blockedUntil = now() + MINUTE;
      throw new Error('Could not reach Launch Library. Please try again later.');
    }
    if (response.status === 429) {
      const retry = response.headers.get('retry-after');
      const delay = /^\d+$/.test(retry ?? '') ? Number(retry) * 1000 : Date.parse(retry) - now();
      blockedUntil = now() + (Number.isFinite(delay) && delay > 0 ? delay : HOUR);
      throw new Error('Launch Library is rate limited. Please try again later.');
    }
    if (!response.ok) {
      blockedUntil = now() + MINUTE;
      throw new Error('Launch Library is unavailable. Please try again later.');
    }
    const data = await response.json();
    if (!Array.isArray(data.results)) throw new Error('Launch Library returned an invalid response. Please try again later.');
    return data.results;
  }

  async function resolveAgency(input) {
    const search = normalize(input) === 'spacex' ? 'SpaceX' : input;
    const { value: agencies } = await cached(`agency:${normalize(search)}`, 24 * HOUR,
      () => api('agencies/', { search, limit: '100', mode: 'list' }));
    const exact = agencies.filter(agency => [agency.name, agency.abbrev].some(value => normalize(value) === normalize(search)));
    const matches = exact.length ? exact : agencies;
    if (!matches.length) throw new Error(`No agency found for “${input}”. Try launch spacex, launch nasa, or launch ula.`);
    if (matches.length !== 1) throw new Error(`Which agency? Try its full name: ${matches.slice(0, 5).map(agency => agency.name).join('; ')}.`);
    return matches[0];
  }

  return async function handleLaunch(input, reply) {
    input = input.trim().replace(/\s+/g, ' ');
    if (/^help$/i.test(input)) { await reply(HELP); return; }
    if (input.length > 100) { await reply('Please keep the agency name to 100 characters or fewer.'); return; }
    const match = input.match(/^(live|status)(?:\s+(.*))?$/i);
    const mode = match ? match[1].toLowerCase() : 'next';
    const agencyInput = match ? match[2] || '' : input;
    let text;
    try {
      const agency = agencyInput ? await resolveAgency(agencyInput) : null;
      const entry = await cached(`${mode}:${agency?.id || 'global'}`, mode === 'live' ? MINUTE : 10 * MINUTE, async () => {
        const time = new Date(now()).toISOString();
        const params = { limit: mode === 'live' ? '3' : '1', mode: 'detailed', ordering: mode === 'status' ? '-net' : 'net' };
        if (mode === 'next') Object.assign(params, { hide_recent_previous: 'true', net__gte: time });
        if (mode === 'status') params.net__lte = time;
        if (mode === 'live') params.status__ids = '6'; // Launch in Flight, not merely a live webcast.
        const path = mode === 'next' ? 'launches/upcoming/' : 'launches/';
        if (!agency) return api(path, params);
        // Provider and mission agency are different roles. Union both queries so
        // NASA missions launched on commercial rockets are included.
        const results = await Promise.all([
          api(path, { ...params, lsp__id: String(agency.id) }),
          api(path, { ...params, mission__agency__ids: String(agency.id) }),
        ]);
        return [...new Map(results.flat().map(launch => [launch.id, launch])).values()]
          .sort((a, b) => (dateMs(a.net) - dateMs(b.net)) * (mode === 'status' ? -1 : 1))
          .slice(0, mode === 'live' ? 3 : 1);
      });
      const scope = agency ? ` involving ${agency.name}` : ' worldwide';
      // A cached upcoming launch can cross T-0. Never call that a liftoff.
      const launches = entry.value;
      text = launches.length
        ? launches.map(launch => formatLaunch(launch, now())).join('\n\n')
        : `No ${mode === 'live' ? 'launches currently reported in flight' : mode === 'status' ? 'recent launches found' : 'upcoming launches found'}${scope}.`;
    } catch (error) {
      console.error('Launch request failed:', error.message);
      text = error instanceof SyntaxError ? 'Launch Library returned an invalid response. Please try again later.' : error.message;
    }
    await reply(text);
  };
}
