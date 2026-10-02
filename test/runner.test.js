import test from 'node:test';
import assert from 'node:assert/strict';
import { runProgram } from '../demo/runner.js';

function fixture() {
  const imports = [];
  const logs = [];
  const api = {
    mergeSort: async values => [...values].sort((a, b) => a - b),
    reverse: async value => [...value].reverse().join(''),
    math: { double: async value => value * 2 },
    answer: Promise.resolve(42),
    $source: async () => 'value => value',
  };
  return { api, imports, logs, onImport: path => imports.push(path), onLog: (...args) => logs.push(args) };
}

test('runs direct destructuring and top-level await with the injected DWIM instance', async () => {
  const options = fixture();
  const result = await runProgram(`
    const { mergeSort } = DWIM;
    const sorted = await mergeSort([3, 1, 4, 1, 5]);
    console.log(sorted);
    return await DWIM.math.double(sorted.length);
  `, options);
  assert.equal(result, 10);
  assert.deepEqual(options.logs, [[[1, 1, 3, 4, 5]]]);
});

test('accepts multiline default and named imports with aliases, including unused names', async () => {
  const options = fixture();
  const result = await runProgram(`
    import DWIM, {
      mergeSort as sort,
      reverse as unused,
      DWIM as same,
      default as alsoSame
    } from 'dwim';
    console.log(DWIM === same, same === alsoSame);
    return await sort([2, 1]);
  `, options);
  assert.deepEqual(result, [1, 2]);
  assert.deepEqual(options.imports, [['mergeSort'], ['reverse']]);
  assert.deepEqual(options.logs, [[true, true]]);
});

test('hoists imports and provides namespace default, DWIM, and arbitrary functions', async () => {
  const options = fixture();
  const result = await runProgram(`
    const answer = await library.reverse('dwim');
    import * as library from 'dwim';
    console.log(library.default === DWIM, library.DWIM === DWIM);
    return answer;
  `, options);
  assert.equal(result, 'miwd');
  assert.deepEqual(options.imports, []);
  assert.deepEqual(options.logs, [[true, true]]);
});

test('preserves import-looking text in strings, templates, comments, and regular expressions', async () => {
  const options = fixture();
  const result = await runProgram(`
    // import broken from 'not-dwim';
    /* import { nope } from 'elsewhere'; */
    const text = "import hello from 'elsewhere'";
    const template = \`import { unknown } from 'elsewhere'\`;
    const pattern = /import something from 'elsewhere'/;
    return [text, template, pattern.source];
  `, options);
  assert.deepEqual(result, [
    "import hello from 'elsewhere'",
    "import { unknown } from 'elsewhere'",
    "import something from 'elsewhere'",
  ]);
  assert.deepEqual(options.imports, []);
});

test('supports side-effect imports and string-literal import names', async () => {
  const options = fixture();
  options.api['some-name'] = async () => 7;
  assert.equal(await runProgram(`
    import 'dwim';
    import { 'some-name' as answer } from 'dwim';
    return await answer();
  `, options), 7);
  assert.deepEqual(options.imports, [['some-name']]);
});

test('captures console methods locally without replacing or mutating the global console', async () => {
  const options = fixture();
  const original = globalThis.console;
  const originalLog = original.log;
  await runProgram(`
    console.log('one', { value: 1 });
    console.info('two');
    console.warn('three');
    console.error('four');
    console.log = () => {};
  `, options);
  assert.equal(globalThis.console, original);
  assert.equal(globalThis.console.log, originalLog);
  assert.deepEqual(options.logs, [['one', { value: 1 }], ['two'], ['three'], ['four']]);
});

test('preserves awaiting property values and control methods', async () => {
  const options = fixture();
  assert.deepEqual(await runProgram(`
    return [await DWIM.answer, await DWIM.$source('answer')];
  `, options), [42, 'value => value']);
});

test('rejects unsupported imports and module features clearly before running code', async () => {
  for (const [code, message] of [
    ["import other from 'elsewhere';", /only supports imports from 'dwim'/],
    ["import { createDWIM } from 'dwim';", /createDWIM is not available/],
    ["await import('dwim');", /dynamic imports are not supported/],
    ['export const value = 1;', /Exports are not supported/],
    ['console.log(import.meta.url);', /import.meta is not supported/],
  ]) {
    const options = fixture();
    await assert.rejects(runProgram(`console.log('must not run'); ${code}`, options), message);
    assert.deepEqual(options.logs, []);
  }
  await assert.rejects(runProgram(`
    import * as library from 'dwim';
    library.createDWIM();
  `, fixture()), /createDWIM is not available/);
});

test('surfaces parser errors and program failures', async () => {
  await assert.rejects(runProgram('const =;', fixture()), SyntaxError);
  await assert.rejects(runProgram("throw new Error('expected failure');", fixture()), /expected failure/);
  await assert.rejects(runProgram(null, fixture()), /JavaScript text/);
});

test('drains calls started without await and preserves caught rejection semantics', async () => {
  const options = fixture();
  let finish;
  options.api.delayed = () => new Promise(resolve => { finish = resolve; });
  let finished = false;
  const program = runProgram('DWIM.delayed(); return 9;', options).then(value => {
    finished = true;
    return value;
  });
  await Promise.resolve();
  assert.equal(finished, false);
  finish();
  assert.equal(await program, 9);
  assert.equal(finished, true);

  options.api.fail = async () => { throw new Error('expected failure'); };
  assert.equal(await runProgram(`
    try { await DWIM.fail(); }
    catch { return 'recovered'; }
  `, options), 'recovered');
  await assert.rejects(runProgram('await DWIM.fail();', options), /expected failure/);
});
