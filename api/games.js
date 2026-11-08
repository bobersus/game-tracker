const FEED = 'https://raw.githubusercontent.com/bobersus/game-tracker/feed/feed.json';

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).end();
  }
  try {
    const upstream = await fetch(FEED, { signal: AbortSignal.timeout(8_000) });
    if (!upstream.ok) throw new Error(`GitHub HTTP ${upstream.status}`);
    const data = await upstream.json();
    if (!Array.isArray(data.games) || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid feed');
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    response.setHeader('Vercel-CDN-Cache-Control', 'public, s-maxage=45, stale-while-revalidate=30');
    return response.status(200).json(data);
  } catch (error) {
    console.error(error.message);
    response.setHeader('Cache-Control', 'no-store');
    return response.status(503).json({ error: 'Feed temporarily unavailable' });
  }
}
