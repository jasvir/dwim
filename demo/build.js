import { copyFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

export async function buildDemo(output = join(root, 'dist')) {
  const files = [
    ['demo/index.html', 'index.html'],
    ['demo/app.js', 'demo/app.js'],
    ['demo/runner.js', 'demo/runner.js'],
    ['index.js', 'index.js'],
    ['LICENSE', 'LICENSE'],
    ['THIRD_PARTY_NOTICES.txt', 'THIRD_PARTY_NOTICES.txt'],
    ['node_modules/acorn/dist/acorn.mjs', 'vendor/acorn.mjs'],
    ['node_modules/acorn/LICENSE', 'vendor/ACORN-LICENSE'],
  ];
  await rm(output, { recursive: true, force: true });
  for (const [source, destination] of files) {
    const target = join(output, destination);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(join(root, source), target);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await buildDemo();
  console.log('Built the DWIM demo in dist/');
}
