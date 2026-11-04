import { readFile, writeFile, rename } from 'node:fs/promises';

// Change this word to rename all three commands.
export const STUPID_COMMAND = 'retard';

export function parseStupidCommand(text) {
  const [prefix] = text.split(/\s/, 1);
  if (prefix.toLowerCase() !== STUPID_COMMAND.toLowerCase()) return null;
  const name = text.slice(prefix.length).trim().replace(/\s+/g, ' ');
  return { name: 'stupid-counter', target: name, leaderboard: name.toLowerCase() === 'leaderboard' };
}

export async function createStupidCounter(path) {
  let state = { global: 0, people: [] };
  try {
    const saved = JSON.parse(await readFile(path, 'utf8'));
    if (!Number.isSafeInteger(saved.global) || saved.global < 0 || !Array.isArray(saved.people)
      || saved.people.some(person => typeof person.name !== 'string' || !person.name.trim()
        || !Number.isSafeInteger(person.count) || person.count < 0)) {
      throw new Error('Invalid counter data');
    }
    state = saved;
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Could not load stupid-counters.json; check the file before restarting.');
  }

  return async (command, reply) => {
    if (command.action === 'clear') {
      const target = command.target.trim().replace(/\s+/g, ' ');
      if (!target) {
        await reply('Usage: clear <name>');
        return;
      }
      const people = state.people.filter(person => person.name.toLowerCase() !== target.toLowerCase());
      if (people.length === state.people.length) {
        await reply(`No counter found for ${target}.`);
        return;
      }
      const next = { ...state, people };
      await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2));
      await rename(`${path}.tmp`, path);
      state = next;
      await reply(`Removed ${target} from the leaderboard.`);
      return;
    }
    if (command.leaderboard) {
      const people = [...state.people].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
      const total = state.global + people.reduce((sum, person) => sum + person.count, 0);
      await reply([
        `${STUPID_COMMAND} leaderboard`,
        `Total: ${total}`,
        `Global: ${state.global}`,
        '',
        ...people.map((person, index) => `${index + 1}. ${person.name}: ${person.count}`),
        ...(!people.length ? ['No named counters yet.'] : []),
      ].join('\n'));
      return;
    }
    if ([...command.target].length > 100) {
      await reply('Please keep the name to 100 characters or fewer.');
      return;
    }
    const next = { global: state.global, people: state.people.map(person => ({ ...person })) };
    let label = 'Global';
    let count;
    if (!command.target) {
      count = ++next.global;
    } else {
      let person = next.people.find(person => person.name.toLowerCase() === command.target.toLowerCase());
      if (!person) {
        person = { name: command.target, count: 0 };
        next.people.push(person);
      }
      label = person.name;
      count = ++person.count;
    }
    await writeFile(`${path}.tmp`, JSON.stringify(next, null, 2));
    await rename(`${path}.tmp`, path);
    state = next;
    await reply(`${label} ${STUPID_COMMAND} counter: ${count}`);
  };
}
