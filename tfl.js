// TfL commands, station lookup, live departures, and journey formatting.
export function createTflHandler(tflApiKey) {
  const TFL_RAIL_MODES = ['tube', 'elizabeth-line', 'overground', 'dlr'];
  const TFL_RAIL_MODE_SET = new Set(TFL_RAIL_MODES);
  const TFL_EASTER_EGG_STATION = 'seven sisters';
  const TFL_HELP = [
    'TfL commands:',
    'tfl <station>',
    'tfl <station> line <line>',
    'tfl <from> to <station>',
    'tfl line',
    'tfl status <station>',
    'tfl crowd <station>',
    'tfl boat <station>',
  ].join('\n');
  const TUBE_LINE_ALIASES = new Map([
    ['bakerloo', 'bakerloo'],
    ['central', 'central'],
    ['circle', 'circle'],
    ['district', 'district'],
    ['dlr', 'dlr'],
    ['elizabeth', 'elizabeth'],
    ['elizabeth-line', 'elizabeth'],
    ['hammersmith-city', 'hammersmith-city'],
    ['hammersmith-and-city', 'hammersmith-city'],
    ['hammersmith-&-city', 'hammersmith-city'],
    ['h&c', 'hammersmith-city'],
    ['h-and-c', 'hammersmith-city'],
    ['hc', 'hammersmith-city'],
    ['jubilee', 'jubilee'],
    ['metropolitan', 'metropolitan'],
    ['northern', 'northern'],
    ['piccadilly', 'piccadilly'],
    ['picadilly', 'piccadilly'],
    ['victoria', 'victoria'],
    ['waterloo-city', 'waterloo-city'],
    ['waterloo-&-city', 'waterloo-city'],
    ['liberty', 'liberty'],
    ['lioness', 'lioness'],
    ['mildmay', 'mildmay'],
    ['suffragette', 'suffragette'],
    ['weaver', 'weaver'],
    ['windrush', 'windrush'],
  ]);

  function normalizeWords(value) {
    return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  }

  function normalizeLine(value) {
    return TUBE_LINE_ALIASES.get(normalizeWords(value).replaceAll(' ', '-'));
  }

  function easterEggStation(value) {
    return normalizeWords(value) === 'shit' ? TFL_EASTER_EGG_STATION : value;
  }

  function parseTflRequest(input) {
    if (!input) return { type: 'missing' };
    if (/^help$/i.test(input)) return { type: 'help' };
    if (/^home$/i.test(input)) return { type: 'home' };
    if (/^bus$/i.test(input)) return { type: 'bus' };
    const boat = input.match(/^boat(?:\s+(.*))?$/i);
    if (boat) return boat[1]?.trim() ? { type: 'boat', pier: boat[1].trim() } : { type: 'missing-boat' };
    const lineStatus = input.match(/^line(?:\s+(.*))?$/i);
    if (lineStatus) {
      if (!lineStatus[1]?.trim()) return { type: 'line-status' };
      const lineId = normalizeLine(lineStatus[1]);
      return lineId ? { type: 'line-status', lineId } : { type: 'invalid-status-line' };
    }
    const status = input.match(/^status(?:\s+(.*))?$/i);
    if (status) return status[1]?.trim() ? { type: 'status', station: status[1].trim() } : { type: 'missing-status' };
    const crowd = input.match(/^crowd(?:\s+(.*))?$/i);
    if (crowd) return crowd[1]?.trim() ? { type: 'crowd', station: crowd[1].trim() } : { type: 'missing-crowd' };
    const journey = input.match(/^(.+?)\s+to\s+(.+)$/i);
    if (journey) return { type: 'journey', from: journey[1].trim(), to: easterEggStation(journey[2].trim()) };
    const line = input.match(/^(.+?)\s+line\s+(.+)$/i);
    if (!line) return { type: 'board', station: easterEggStation(input) };
    const station = easterEggStation(line[1].trim());
    const lineId = normalizeLine(line[2]);
    if (!station || !lineId) return { type: 'invalid-line' };
    return { type: 'board', station, lineId };
  }

  async function fetchTfl(path, params = {}) {
    const url = new URL(path, 'https://api.tfl.gov.uk');
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    if (tflApiKey) url.searchParams.set('app_key', tflApiKey);
    let response;
    try {
      response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    } catch {
      throw new Error('🚂 Could not reach TfL. Please try again shortly. 🚂');
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('🚂 TfL rejected TFL_APP_KEY. Check it in .env, or remove it to use the public API. 🚂');
    }
    if (response.status === 429) throw new Error('🚂 TfL rate limit reached. Please try again later. 🚂');
    if (!response.ok) throw new Error('🚂 TfL could not provide live departures. Please try again shortly. 🚂');
    try {
      return await response.json();
    } catch {
      throw new Error('🚂 TfL returned an unexpected response. Please try again shortly. 🚂');
    }
  }

  function displayStationName(name) {
    return name.replace(/\s+(Underground|Rail) Station$/i, '').replace(/\s+\([^)]*\)$/i, '');
  }

  function isExactStationMatch(query, match) {
    const queryName = normalizeWords(query);
    const matchName = normalizeWords(match.name).replace(/ underground station$/, '');
    return queryName === matchName;
  }

  async function resolveRailStations(query) {
    const search = await fetchTfl(`/StopPoint/Search/${encodeURIComponent(query)}`, {
      modes: TFL_RAIL_MODES.join(','), maxResults: '10',
    });
    const matches = Array.isArray(search.matches) ? search.matches : [];
    if (!matches.length) throw new Error(`🚂 No TfL rail station found for “${query}”. Try a fuller station name. 🚂`);
    const exact = matches.filter(match => isExactStationMatch(query, match));
    const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
    if (!selected) {
      const names = [...new Set(matches.slice(0, 5).map(match => displayStationName(match.name)))];
      throw new Error(`More than one TfL rail station matches “${query}”: ${names.join(', ')}. Try a fuller name.`);
    }
    const stopPoint = await fetchTfl(`/StopPoint/${selected.id}`);
    // A non-hub search result is already a station. Its children are normally
    // individual platforms, whose arrival endpoints do not provide a full board.
    if (!/^HUB/i.test(selected.id)) {
      return {
        name: displayStationName(selected.name),
        stations: [{
          id: selected.id,
          commonName: stopPoint.commonName,
          lines: stopPoint.lines,
          lineModeGroups: stopPoint.lineModeGroups,
        }],
      };
    }
    const children = Array.isArray(stopPoint.children) ? stopPoint.children : [];
    // A hub (for example Hammersmith) contains one or more physical stations.
    const railStations = children.filter(child => (
      child.modes?.length
        ? child.modes.some(mode => TFL_RAIL_MODE_SET.has(mode))
        : /^(940GZZLU|940GZZDL|910G)/i.test(child.id)
    ));
    if (!railStations.length) {
      // A few TfL hubs, including Chalfont & Latimer, omit their Underground
      // child from children even though the hub's line metadata lists it.
      const lineIds = railLineIds(stopPoint);
      const stopLists = await Promise.all(lineIds.map(lineId => (
        fetchTfl(`/Line/${encodeURIComponent(lineId)}/StopPoints`)
      )));
      const stationsFromLines = stopLists.flat().filter(stop => (
        stop.hubNaptanCode === stopPoint.id
        && stop.modes?.some(mode => TFL_RAIL_MODE_SET.has(mode))
      ));
      if (stationsFromLines.length) {
        return {
          name: displayStationName(selected.name),
          stations: [...new Map(stationsFromLines.map(stop => [stop.id, stop])).values()],
        };
      }
    }
    return {
      name: displayStationName(selected.name),
      stations: railStations.length ? railStations : [{ id: stopPoint.id, lines: stopPoint.lines }],
    };
  }

  async function resolveRiverBusPier(query) {
    const search = await fetchTfl(`/StopPoint/Search/${encodeURIComponent(query)}`, {
      modes: 'river-bus', maxResults: '10',
    });
    const matches = Array.isArray(search.matches) ? search.matches : [];
    if (!matches.length) throw new Error(`No TfL river-bus pier found for “${query}”. Try a fuller pier name.`);
    const exact = matches.filter(match => isExactStationMatch(query, match));
    const selected = exact.length === 1 ? exact[0] : matches.length === 1 ? matches[0] : null;
    if (!selected) {
      const names = [...new Set(matches.slice(0, 5).map(match => match.name))];
      throw new Error(`More than one TfL river-bus pier matches “${query}”: ${names.join(', ')}. Try a fuller name.`);
    }
    return { id: selected.id, name: selected.name };
  }

  function railLineIds(stop) {
    const groupedIds = stop.lineModeGroups
      ?.filter(group => TFL_RAIL_MODE_SET.has(group.modeName))
      .flatMap(group => group.lineIdentifier ?? []) ?? [];
    return groupedIds.length ? groupedIds : stop.lines?.map(line => line.id) ?? [];
  }

  function shortStatusReason(reason, maximumLength = 220) {
    if (!reason) return '';
    const summary = reason.replace(/\s+/g, ' ').trim();
    return summary.length > maximumLength ? `${summary.slice(0, maximumLength - 3)}…` : summary;
  }

  function formatStationStatus(name, lines) {
    const affected = lines.flatMap(line => (line.lineStatuses ?? [])
      .filter(status => status.statusSeverityDescription !== 'Good Service')
      .map(status => ({ line, status })));
    if (!affected.length) return `${name} status\n\nNo reported problems on TfL rail lines serving this station.`;
    return `${name} status\n\n${affected.map(({ line, status }) => {
      const reason = shortStatusReason(status.reason);
      return `* ${line.name} — ${status.statusSeverityDescription}${reason ? `\n  ${reason}` : ''}`;
    }).join('\n')}`;
  }

  async function getStationStatus(query) {
    const station = await resolveRailStations(query);
    const lineIds = [...new Set(station.stations.flatMap(railLineIds))];
    if (!lineIds.length) return { name: station.name, lines: [] };
    const statuses = await fetchTfl(`/Line/${lineIds.map(encodeURIComponent).join(',')}/Status`);
    return {
      name: station.name,
      lines: Array.isArray(statuses) ? statuses.filter(line => TFL_RAIL_MODE_SET.has(line.modeName)) : [],
    };
  }

  function formatRailLineStatus(lines) {
    const sortedLines = [...lines].sort((a, b) => a.name.localeCompare(b.name));
    if (!sortedLines.length) return 'TfL rail line status\n\nNo rail line status is currently available.';
    return `TfL rail line status\n\n${sortedLines.map(line => {
      const statuses = [...new Set((line.lineStatuses ?? [])
        .map(status => status.statusSeverityDescription)
        .filter(Boolean))];
      return `* ${line.name} — ${statuses.join(', ') || 'Status unavailable'}`;
    }).join('\n')}`;
  }

  function formatDetailedRailLineStatus(lines) {
    if (!lines.length) return 'TfL rail line status\n\nNo rail line status is currently available.';
    return lines.map(line => {
      const statuses = line.lineStatuses ?? [];
      if (!statuses.length) return `TfL ${line.name} status\n\nStatus unavailable.`;
      return `TfL ${line.name} status\n\n${statuses.map(status => {
        const reason = shortStatusReason(status.reason, 700);
        return `* ${status.statusSeverityDescription ?? 'Status unavailable'}${reason ? `\n  ${reason}` : ''}`;
      }).join('\n')}`;
    }).join('\n\n');
  }

  async function getRailLineStatus(lineId) {
    const path = lineId
      ? `/Line/${encodeURIComponent(lineId)}/Status`
      : `/Line/Mode/${TFL_RAIL_MODES.map(encodeURIComponent).join(',')}/Status`;
    const lines = await fetchTfl(path);
    return Array.isArray(lines) ? lines.filter(line => TFL_RAIL_MODE_SET.has(line.modeName)) : [];
  }

  function lineName(lineId) {
    if (lineId === 'hammersmith-city') return 'H&C';
    if (lineId === 'elizabeth') return 'Elizabeth line';
    if (lineId === 'dlr') return 'DLR';
    return lineId.replace(/-/g, ' ').replace(/\b\w/g, letter => letter.toUpperCase());
  }

  function arrivalTime(seconds) {
    if (seconds < 60) return 'due';
    return `${Math.ceil(seconds / 60)} min`;
  }

  function formatBoard(name, arrivals, lineId) {
    const uniqueArrivals = [...new Map(arrivals.map(arrival => [
      `${arrival.lineId}|${arrival.towards}|${arrival.platformName}|${arrival.timeToStation}`,
      arrival,
    ])).values()];
    const filtered = lineId ? uniqueArrivals.filter(arrival => arrival.lineId === lineId) : uniqueArrivals;
    const shown = filtered.sort((a, b) => a.timeToStation - b.timeToStation).slice(0, 8);
    const heading = `${name}${lineId ? ` — ${lineName(lineId)}` : ''} departures`;
    if (!shown.length) return `${heading}\n\nNo live TfL rail departures are currently shown.`;
    return `${heading}\n\n${shown.map(arrival => {
      const platform = arrival.platformName?.replace(/\s+-\s+/, ', ') || 'Platform unknown';
      const service = `${arrival.lineName || lineName(arrival.lineId)}${arrival.towards ? ` ➤ ${arrival.towards}` : ''}`;
      return `${service} — ${arrivalTime(arrival.timeToStation)} (${platform})`;
    }).join('\n')}`;
  }

  function formatBoatBoard(name, arrivals) {
    const uniqueArrivals = [...new Map(arrivals.map(arrival => [
      `${arrival.lineId}|${arrival.destinationName}|${arrival.platformName}|${arrival.timeToStation}`,
      arrival,
    ])).values()];
    const shown = uniqueArrivals
      .filter(arrival => arrival.modeName === 'river-bus')
      .sort((a, b) => a.timeToStation - b.timeToStation)
      .slice(0, 8);
    const heading = `${name} river-bus departures`;
    if (!shown.length) return `${heading}\n\nNo live river-bus departures are currently shown.`;
    return `${heading}\n\n${shown.map(arrival => {
      const platform = arrival.platformName || 'Pier berth unknown';
      const service = `${arrival.lineName || lineName(arrival.lineId)}${arrival.destinationName ? ` → ${arrival.destinationName}` : ''}`;
      return `${service} — ${arrivalTime(arrival.timeToStation)} (${platform})`;
    }).join('\n')}`;
  }

  function timeFromTfl(dateTime) {
    return dateTime?.match(/T(\d{2}:\d{2})/)?.[1] ?? 'unknown time';
  }

  function removeStationSuffix(name = '') {
    return name.replace(/\s+(Underground|Rail|Bus) Station$/i, '');
  }

  function journeyRouteName(leg) {
    return leg.routeOptions?.[0]?.name ?? leg.mode?.name ?? leg.mode?.id;
  }

  function isRailJourneyLeg(leg) {
    return TFL_RAIL_MODE_SET.has(leg.mode?.id) && Boolean(leg.routeOptions?.length);
  }

  function formatJourneyLeg(leg) {
    const route = leg.routeOptions?.[0];
    if (isRailJourneyLeg(leg) && route) {
      const direction = removeStationSuffix(route.directions?.[0] ?? leg.arrivalPoint?.commonName);
      return `${route.name}${direction ? ` ➤ ${direction}` : ''}`;
    }
    const summary = leg.instruction?.summary?.replace(/<[^>]*>/g, '') || `Travel by ${leg.mode?.name ?? 'public transport'}`;
    return `${summary} — ${leg.duration ?? '?'} min`;
  }

  function formatJourney(from, to, journey) {
    const railLegs = journey.legs?.filter(isRailJourneyLeg) ?? [];
    const lines = railLegs.flatMap((leg, index) => {
      const output = [`* ${formatJourneyLeg(leg)}`];
      const nextLeg = railLegs[index + 1];
      if (nextLeg && journeyRouteName(nextLeg) !== journeyRouteName(leg)) {
        const changeAt = removeStationSuffix(leg.arrivalPoint?.commonName);
        if (changeAt) output.push(`* Change at ${changeAt}`);
      }
      return output;
    });
    const times = `Leave ${timeFromTfl(journey.startDateTime)} · arrive ${timeFromTfl(journey.arrivalDateTime)}`;
    return `${from} ➤ ${to}\n\n${journey.duration} min · ${times}${lines.length ? `\n${lines.join('\n')}` : ''}`;
  }

  function crowdDescription(ratio) {
    if (ratio <= 0.5) return 'Quieter than usual';
    if (ratio <= 0.8) return 'Below usual';
    if (ratio <= 1.2) return 'About usual';
    return 'Busier than usual';
  }

  function crowdTime(time) {
    return time?.match(/(\d{2}:\d{2})(?::\d{2})?$/)?.[1];
  }

  function formatCrowding(name, readings) {
    const available = readings.filter(reading => reading.data?.dataAvailable && Number.isFinite(reading.ratio));
    if (!available.length) return `TfL does not currently publish live crowding data for ${name}.`;
    const formatReading = ({ station, data, ratio }) => {
      const percentage = Math.round(ratio * 100);
      const updated = crowdTime(data.timeLocal ?? data.timeUtc);
      return `${crowdDescription(ratio)} — ${percentage}% of usual level${updated ? ` (updated ${updated})` : ''}`;
    };
    if (available.length === 1) return `${name} crowding\n\n${formatReading(available[0])}`;
    return `${name} crowding\n\n${available.map(reading => `${reading.station}: ${formatReading(reading)}`).join('\n')}`;
  }

  async function getLiveCrowding(query) {
    const station = await resolveRailStations(query);
    const readings = await Promise.all(station.stations.map(async stop => {
      const data = await fetchTfl(`/Crowding/${stop.id}/Live`);
      const ratio = Number(data.percentageOfBaseline ?? data.percentageOfBaseLine);
      const stopName = stop.commonName?.replace(/\s+(Underground|Rail) Station$/i, '') || station.name;
      return { station: stopName, data, ratio };
    }));
    return { name: station.name, readings };
  }

  async function planRailJourney(fromQuery, toQuery) {
    const [from, to] = await Promise.all([resolveRailStations(fromQuery), resolveRailStations(toQuery)]);
    const options = await Promise.all(from.stations.flatMap(fromStop => to.stations.map(async toStop => {
      const result = await fetchTfl(
        `/Journey/JourneyResults/${encodeURIComponent(fromStop.id)}/to/${encodeURIComponent(toStop.id)}`,
        { mode: TFL_RAIL_MODES.join(','), journeyPreference: 'LeastTime' },
      );
      const journey = result.journeys?.reduce((quickest, candidate) => (
        !quickest || candidate.duration < quickest.duration ? candidate : quickest
      ), null);
      return journey;
    })));
    const quickest = options.filter(Boolean).reduce((best, candidate) => (
      !best || candidate.duration < best.duration ? candidate : best
    ), null);
    if (!quickest) throw new Error(`No TfL rail journey found from “${fromQuery}” to “${toQuery}”.`);
    return { from: from.name, to: to.name, journey: quickest };
  }

  async function handleTfl(input, reply) {
    const tflReply = text => {
      const [firstLine, ...remainingLines] = String(text).split('\n');
      const startsWithTrain = firstLine.trimStart().startsWith('🚂');
      const endsWithTrain = firstLine.trimEnd().endsWith('🚂');
      const decoratedFirstLine = `${startsWithTrain ? firstLine : `🚂 ${firstLine}`}${endsWithTrain ? '' : ' 🚂'}`;
      return reply([decoratedFirstLine, ...remainingLines].join('\n'));
    };
    const request = parseTflRequest(input);
    if (request.type === 'help') {
      await tflReply(TFL_HELP);
      return;
    }
    if (request.type === 'home') {
      await reply('Sadly, TfL does not offer any direct connection to Tel Aviv for the moment, Bibi is working on it.');
      return;
    }
    if (request.type === 'bus') {
      await reply('Go fuck yourself.');
      return;
    }
    if (request.type === 'line-status') {
      console.log(`TfL rail line status request received${request.lineId ? ` for ${request.lineId}` : ''}.`);
      try {
        const lines = await getRailLineStatus(request.lineId);
        await tflReply(request.lineId ? formatDetailedRailLineStatus(lines) : formatRailLineStatus(lines));
        console.log('TfL rail line status sent.');
      } catch (error) {
        console.error('TfL rail line status request failed:', error.message);
        await tflReply(error.message);
      }
      return;
    }
    if (request.type === 'invalid-status-line') {
      await tflReply('Use a supported line name, for example: tfl line district');
      return;
    }
    if (request.type === 'missing') {
      await tflReply('Usage: tfl <station> [line <line>]\nJourney: tfl <from> to <destination>\nLine status: tfl line [line]\nCrowding: tfl crowd <station>\nStatus: tfl status <station>\nBoat: tfl boat <station>');
      return;
    }
    if (request.type === 'missing-status') {
      await tflReply('Usage: tfl status <station>');
      return;
    }
    if (request.type === 'status') {
      console.log(`TfL status request received for: ${request.station}`);
      try {
        const status = await getStationStatus(request.station);
        await tflReply(formatStationStatus(status.name, status.lines));
        console.log('TfL status sent.');
      } catch (error) {
        console.error('TfL status request failed:', error.message);
        await tflReply(error.message);
      }
      return;
    }
    if (request.type === 'missing-crowd') {
      await tflReply('Usage: tfl crowd <station>');
      return;
    }
    if (request.type === 'missing-boat') {
      await tflReply('Usage: tfl boat <station>');
      return;
    }
    if (request.type === 'boat') {
      console.log(`TfL river-bus request received for: ${request.pier}`);
      try {
        const pier = await resolveRiverBusPier(request.pier);
        const arrivals = await fetchTfl(`/StopPoint/${pier.id}/arrivals`);
        await tflReply(formatBoatBoard(pier.name, Array.isArray(arrivals) ? arrivals : []));
        console.log('TfL river-bus departures sent.');
      } catch (error) {
        console.error('TfL river-bus request failed:', error.message);
        await tflReply(error.message);
      }
      return;
    }
    if (request.type === 'crowd') {
      console.log(`TfL crowding request received for: ${request.station}`);
      try {
        const crowding = await getLiveCrowding(request.station);
        await tflReply(formatCrowding(crowding.name, crowding.readings));
        console.log('TfL crowding sent.');
      } catch (error) {
        console.error('TfL crowding request failed:', error.message);
        await tflReply(error.message);
      }
      return;
    }
    if (request.type === 'journey') {
      console.log(`TfL journey request received: ${request.from} to ${request.to}`);
      try {
        const plan = await planRailJourney(request.from, request.to);
        await tflReply(formatJourney(plan.from, plan.to, plan.journey));
        console.log('TfL journey sent.');
      } catch (error) {
        console.error('TfL journey request failed:', error.message);
        await tflReply(error.message);
      }
      return;
    }
    if (request.type === 'invalid-line') {
      await tflReply('Use a supported line name, for example: tfl hammersmith line district');
      return;
    }
    console.log(`TfL departure request received for: ${request.station}`);
    try {
      const station = await resolveRailStations(request.station);
      const departureLists = await Promise.all(station.stations.map(stop => fetchTfl(`/StopPoint/${stop.id}/arrivals`)));
      const arrivals = departureLists.flat();
      await tflReply(formatBoard(station.name, arrivals, request.lineId));
      console.log('TfL departures sent.');
    } catch (error) {
      console.error('TfL departure request failed:', error.message);
      await tflReply(error.message);
    }
  }

  return handleTfl;
}
