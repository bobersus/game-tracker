import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { classify, details, discover, parallelMap, toCard } from '../lib/steam.mjs';

const directory = process.argv[2] ?? '.feed';
const stateFile = join(directory, 'state.json');
const feedFile = join(directory, 'feed.json');
const seedFile = new URL('../data/seed.json', import.meta.url);
const maxAge = 14 * 24 * 60 * 60 * 1000;
const now = new Date();
const checkedAt = now.toISOString();

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return fallback;
  }
}

const previous = await readJson(stateFile, null);
const seeds = await readJson(seedFile, []);
const candidates = await discover();
if (!candidates.size || (previous && candidates.size < previous.catalogueSize * 0.85)) {
  throw new Error('Steam returned an incomplete catalogue. The last successful feed was preserved.');
}

const known = new Set(previous?.known ?? candidates.keys());
const queue = new Map();
const fresh = date => Number.isFinite(Date.parse(date)) && now - Date.parse(date) < maxAge;

for (const item of previous?.tracked ?? seeds) {
  if (fresh(item.firstSeen)) queue.set(item.id, item);
}
for (const [id] of candidates) {
  if (!known.has(id)) queue.set(id, { id, firstSeen: checkedAt });
  known.add(id);
}

// Keep the queue bounded so a large catalogue change cannot hit Steam's app-details rate limit.
const pending = [...queue.values()].sort((a, b) => Number(Boolean(b.card)) - Number(Boolean(a.card)) ||
  a.firstSeen.localeCompare(b.firstSeen) || a.id - b.id);
const verified = await parallelMap(pending.slice(0, 80), 4, async item => {
  const data = await details(item.id);
  const fit = classify(data, candidates.get(item.id) ?? new Set(), item.curatedMechanic);
  if (!fit) return null;
  return { ...item, card: toCard(item.id, data, fit, item.firstSeen) };
});
const featured = verified.filter(Boolean)
  .sort((a, b) => b.firstSeen.localeCompare(a.firstSeen) || b.card.score - a.card.score || b.id - a.id)
  .slice(0, 60);
const tracked = featured.concat(pending.slice(80));
const games = featured.map(item => item.card);
const state = { catalogueSize: candidates.size, known: [...known].sort((a, b) => a - b), tracked };

await mkdir(directory, { recursive: true });
await writeFile(stateFile, JSON.stringify(state) + '\n');
await writeFile(feedFile, JSON.stringify({ checkedAt, games }, null, 2) + '\n');
console.log(`Checked ${candidates.size} Steam pages, verified ${games.length} feed cards.`);
