import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const root = new URL('../', import.meta.url);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const paths = new Set(['/index.html', '/styles.css', '/tracker.js', '/theme.js',
  '/assets/logo-duck-places.png', '/assets/favicon.png', '/assets/game-placeholder.svg']);

const port = Number(process.env.PORT ?? 4173);
createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = pathname === '/' ? '/index.html' : pathname === '/api/games' ? '/.feed/feed.json' : pathname;
  try {
    if (!paths.has(file) && file !== '/.feed/feed.json') throw new Error('Not found');
    const content = await readFile(new URL(file.slice(1), root));
    response.writeHead(200, { 'Content-Type': types[extname(file)] + '; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(content);
  } catch {
    response.writeHead(pathname === '/api/games' ? 503 : 404);
    response.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`Game Tracker: http://127.0.0.1:${port}`));
