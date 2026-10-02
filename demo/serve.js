import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const policy = "default-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export function createDemoServer({ built = false, directory = built ? join(root, 'dist') : root } = {}) {
  const mount = built ? '/dwim/' : '/';
  const files = new Map([
    ['', [built ? 'index.html' : 'demo/index.html', 'text/html']],
    ['index.html', [built ? 'index.html' : 'demo/index.html', 'text/html']],
    ['index.js', ['index.js', 'text/javascript']],
    ['demo/app.js', ['demo/app.js', 'text/javascript']],
    ['demo/runner.js', ['demo/runner.js', 'text/javascript']],
    ['vendor/acorn.mjs', [built ? 'vendor/acorn.mjs' : 'node_modules/acorn/dist/acorn.mjs', 'text/javascript']],
  ]);
  return createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    if (built && (pathname === '/' || pathname === '/dwim')) {
      response.writeHead(302, { Location: mount }).end();
      return;
    }
    const entry = pathname.startsWith(mount) && files.get(pathname.slice(mount.length));
    if (!entry) { response.writeHead(404).end('Not found'); return; }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    try {
      const content = await readFile(join(directory, entry[0]));
      response.writeHead(200, {
        'Content-Type': `${entry[1]}; charset=utf-8`,
        'Cache-Control': 'no-store',
        'Content-Security-Policy': policy,
      });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch {
      response.writeHead(500).end(built ? 'Could not load demo. Run npm run build:demo first.' : 'Could not load demo.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const built = process.argv.includes('--built');
  const server = createDemoServer({ built });
  server.on('error', error => {
    console.error(`Could not start DWIM: ${error.message}. Try a different DWIM_PORT.`);
    process.exitCode = 1;
  });
  server.listen(Number(process.env.DWIM_PORT ?? 4173), '127.0.0.1', () => {
    console.log(`DWIM demo: http://localhost:${server.address().port}${built ? '/dwim/' : '/'}`);
  });
}
