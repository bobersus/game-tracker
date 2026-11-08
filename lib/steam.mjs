const STORE = 'https://store.steampowered.com';
const PAGE_SIZE = 100;
const SEARCHES = [
  [16689],       // Incremental
  [3964, 597],  // Physics + Casual
  [7178],        // Party Game
  [1685, 4136], // Co-op + Funny
  [599, 597]    // Simulation + Casual
];

const highScope = new Set([
  122, 1695, 3810, 1755, 4175, 1091588, 15045, 1659, 1702, 12095, 4325
]);
const adultTags = new Set([6650, 9130, 24904]);
const simpleLoop = /\b(click|tap|collect|earn|upgrade|clean|wash|serve|sort|dig|dodge|stack|juggle|drive|refuel|shred|catch|throw|push|race|park|deliver|flip|shoot|destroy|smash|repair|pack|bounce|harvest|sell|grow|balance)\b/i;
const oversized = /\b(mmorpg|open[- ]world survival|hundreds of quests|massively multiplayer|grand strategy|fully voiced|branching narrative|soulslike)\b/i;
const adult = /\b(hentai|pornographic|explicit sexual|sex simulator|sexual content|nsfw)\b/i;
const pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

export async function fetchJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(15_000)
      });
      if (response.status === 429 && attempt < 2) {
        const seconds = Number(response.headers.get('retry-after')) || 15 * (attempt + 1);
        await pause(Math.min(45, seconds) * 1000);
        continue;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 2) throw new Error(`${url}: ${error.message}`, { cause: error });
      await pause(800 * (attempt + 1));
    }
  }
}

export function parseSearch(html) {
  const apps = new Map();
  for (const row of html.matchAll(/<a\b[^>]*\bdata-ds-appid="(\d+)"[^>]*>/g)) {
    const tags = row[0].match(/\bdata-ds-tagids="\[([\d, ]*)\]"/)?.[1];
    apps.set(Number(row[1]), tags ? tags.split(',').filter(Boolean).map(Number) : []);
  }
  return apps;
}

export async function parallelMap(items, concurrency, run) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  }));
  return results;
}

async function searchPage(tags, start) {
  // Store search is more aggressively rate-limited than the app-details endpoint.
  await pause(1800);
  const url = new URL('/search/results/', STORE);
  url.search = new URLSearchParams({
    filter: 'comingsoon', category1: '998', tags: tags.join(','),
    infinite: '1', start: String(start), count: String(PAGE_SIZE), cc: 'us', l: 'english'
  });
  const result = await fetchJson(url);
  if (!result.success || !Number.isInteger(result.total_count) || typeof result.results_html !== 'string') {
    throw new Error(`Unexpected Steam search response for tags ${tags}`);
  }
  const apps = parseSearch(result.results_html);
  if (result.total_count > start && apps.size === 0) {
    throw new Error(`Steam search did not return app IDs for tags ${tags} at ${start}`);
  }
  return { total: result.total_count, apps };
}

export async function discover() {
  const first = await parallelMap(SEARCHES, 1, tags => searchPage(tags, 0));
  const pages = SEARCHES.flatMap((tags, index) =>
    Array.from({ length: Math.max(0, Math.ceil(first[index].total / PAGE_SIZE) - 1) }, (_, page) =>
      ({ tags, start: (page + 1) * PAGE_SIZE })));
  const remaining = await parallelMap(pages, 1, async ({ tags, start }) =>
    ({ tags, ...await searchPage(tags, start) }));
  const results = first.map((page, index) => ({ ...page, tags: SEARCHES[index] })).concat(remaining);
  const candidates = new Map();
  for (const { apps, tags } of results) {
    for (const [id, appTags] of apps) {
      candidates.set(id, new Set([...(candidates.get(id) ?? []), ...appTags, ...tags]));
    }
  }
  return candidates;
}

export async function details(id) {
  const url = new URL('/api/appdetails', STORE);
  url.search = new URLSearchParams({ appids: String(id), cc: 'us', l: 'english' });
  const result = (await fetchJson(url))?.[id];
  if (typeof result?.success !== 'boolean' || (result.success && !result.data)) {
    throw new Error(`Unexpected Steam details response for ${id}`);
  }
  return result.success ? result.data : null;
}

export function classify(data, tags, curatedMechanic) {
  if (data?.type !== 'game' || data.release_date?.coming_soon !== true) return null;
  if (!data.name || !data.short_description || data.required_age >= 18) return null;
  const words = `${data.name} ${data.short_description}`;
  if (oversized.test(words) || adult.test(words) || [...tags].some(tag => adultTags.has(tag))) return null;
  if ([...tags].filter(tag => highScope.has(tag)).length >= 2) return null;

  const casual = tags.has(597) || data.genres?.some(genre => genre.id === '4');
  const smallLoop = simpleLoop.test(words);
  const incremental = tags.has(16689) || /\b(incremental|clicker|idler)\b/i.test(words);
  const physics = tags.has(3964) || /\b(physics|ragdoll|refuel|drifting)\b/i.test(words);
  const party = tags.has(7178) || (tags.has(1685) && tags.has(4136)) ||
    /\b(party game|party brawler|mini[- ]games|arena brawler)\b/i.test(words);
  const simulator = (tags.has(599) || /\bsimulator\b/i.test(words)) && casual && smallLoop;
  const mechanic = curatedMechanic ?? (incremental ? 'incremental' : physics && (smallLoop || casual) ? 'physics'
    : party && (smallLoop || casual || tags.has(7178)) ? 'party' : simulator ? 'simulator' : null);
  if (!mechanic) return null;
  const score = 5 + Number(casual) + Number(smallLoop) * 2 + Number(tags.has(4136)) + Number(tags.has(1685));
  return { mechanic, score };
}

export function toCard(id, data, fit, firstSeen) {
  const image = [data.screenshots?.[0]?.path_full, data.header_image].find(src =>
    /^https:\/\/(?:shared\.[a-z]+\.steamstatic\.com|cdn\.[a-z]+\.steamstatic\.com|cdn\.akamai\.steamstatic\.com)\//i.test(src ?? ''));
  return {
    id, name: data.name, description: data.short_description, image: image ?? null,
    firstSeen, ...fit
  };
}
