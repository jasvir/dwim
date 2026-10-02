import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'acorn';
import { buildDemo } from '../demo/build.js';
import { createDemoServer } from '../demo/serve.js';

test('builds a self-contained Pages demo whose module graph works under /dwim/', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'dwim-demo-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(join(directory, 'stale.txt'), 'old build');
  await buildDemo(directory);
  assert.deepEqual((await readdir(directory)).sort(), ['LICENSE', 'THIRD_PARTY_NOTICES.txt', 'demo', 'index.html', 'index.js', 'vendor']);
  assert.equal(
    await readFile(join(directory, 'vendor/ACORN-LICENSE'), 'utf8'),
    await readFile(new URL('../node_modules/acorn/LICENSE', import.meta.url), 'utf8'),
  );

  const server = createDemoServer({ built: true, directory });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const page = new URL('/dwim/', origin);
  const response = await fetch(page);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  const imports = JSON.parse(html.match(/<script type="importmap">([^<]+)<\/script>/)[1]).imports;
  const entry = html.match(/<script type="module" src="([^"]+)"/)[1];
  const visited = new Set();
  async function checkModule(url) {
    if (visited.has(url.href)) return;
    visited.add(url.href);
    assert.equal(url.origin, page.origin);
    assert.ok(url.pathname.startsWith('/dwim/'), url.href);
    const asset = await fetch(url);
    assert.equal(asset.status, 200, url.href);
    assert.match(asset.headers.get('content-type'), /text\/javascript/);
    const tree = parse(await asset.text(), { sourceType: 'module', ecmaVersion: 'latest' });
    for (const node of tree.body.filter(node => node.type === 'ImportDeclaration')) {
      const specifier = node.source.value;
      const dependency = imports[specifier]
        ? new URL(imports[specifier], page)
        : new URL(specifier, url);
      await checkModule(dependency);
    }
  }
  await checkModule(new URL(entry, page));
  assert.equal(visited.size, 4);
  assert.equal((await fetch(new URL('/dwim', origin))).url, page.href);
  for (const path of ['/dwim/package.json', '/dwim/.git/config', '/index.js', '/dwim/node_modules/acorn/package.json']) {
    assert.equal((await fetch(new URL(path, origin))).status, 404, path);
  }
});
