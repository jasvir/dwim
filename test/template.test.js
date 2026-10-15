import test from 'node:test';
import assert from 'node:assert/strict';
import DWIM, { dwim as namedTag, createDWIM } from '../index.js';

const response = code => JSON.stringify({ code });

function fakeModel(respond, onCall) {
  const calls = { requests: [], create: 0, destroyed: 0 };
  const languageModel = {
    async availability() { return 'available'; },
    async create() {
      calls.create++;
      return {
        async clone() {
          return {
            async prompt(input) {
              assert.ok(input.startsWith('Request: '));
              const request = JSON.parse(input.slice('Request: '.length));
              calls.requests.push(request);
              return respond(request, calls.requests.length);
            },
            destroy() {},
          };
        },
        destroy() { calls.destroyed++; },
      };
    },
  };
  return { dwim: createDWIM({ languageModel, onCall }), calls };
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('exports the tagged-template alias without replacing the default proxy', () => {
  assert.equal(namedTag, DWIM);
});

test('direct eval captures arguments, a callback, and an enclosing local binding', async () => {
  const { dwim, calls } = fakeModel(() => response(`
    count++;
    const nodes = [tree];
    while (nodes.length) {
      const node = nodes.shift();
      callback(node.value);
      if (depthFirst) nodes.unshift(...(node.children ?? []));
      else nodes.push(...(node.children ?? []));
    }
    return count;
  `));
  let count = 0;
  async function walk(tree, callback, depthFirst) {
    return eval(await dwim`Walk tree using callback and depthFirst; increment count.`);
  }
  const tree = { value: 'a', children: [
    { value: 'b', children: [{ value: 'd' }] },
    { value: 'c' },
  ] };
  // Runtime arguments never need JSON serialization or a copy for the model.
  tree.self = tree;
  const depth = [];
  const breadth = [];
  assert.equal(await walk(tree, value => depth.push(value), true), 1);
  assert.equal(await walk(tree, value => breadth.push(value), false), 2);
  assert.deepEqual(depth, ['a', 'b', 'd', 'c']);
  assert.deepEqual(breadth, ['a', 'b', 'c', 'd']);
  assert.equal(count, 2);
  assert.deepEqual(calls.requests, [{
    operation: 'body', description: 'Walk tree using callback and depthFirst; increment count.',
  }]);
});

test('cached source captures each invocation rather than retaining the first closure', async () => {
  const { dwim, calls } = fakeModel(() => response('return value + offset;'));
  async function add(value, offset) {
    return eval(await dwim`Add value and offset.`);
  }
  assert.deepEqual(await Promise.all([add(2, 3), add(20, 7), add(-5, 1)]), [5, 27, -4]);
  assert.equal(calls.requests.length, 1);
});

test('generated code preserves caller this and arguments and supports return and await', async () => {
  const { dwim } = fakeModel(() => response(`
    await Promise.resolve();
    return [this.label, arguments[0], value];
  `));
  async function inspect(value) {
    return eval(await dwim`Read this.label, arguments[0], and value after awaiting.`);
  }
  assert.deepEqual(await inspect.call({ label: 'caller' }, 42), ['caller', 42, 42]);
});

test('generating source does not execute it and reports the source on every call', async () => {
  const events = [];
  const { dwim, calls } = fakeModel(() => response('effects++; return effects;'), event => events.push(event));
  let effects = 0;
  const source = await dwim`Increment effects.`;
  assert.equal(typeof source, 'string');
  assert.equal(effects, 0);
  assert.deepEqual(events, [{
    path: [], source, kind: 'template', description: 'Increment effects.',
  }]);
  assert.equal(await eval(source), 1);
  assert.equal(await dwim`Increment effects.`, source);
  assert.equal(effects, 1);
  assert.equal(events.length, 2);
  assert.equal(calls.requests.length, 1);
});

test('cooks template text and keys the source cache by the full interpolated description', async () => {
  const { dwim, calls } = fakeModel((request, number) => response(`return ${number};`));
  async function sourceFor(value) {
    return dwim`Return ${value}.\nDone.`;
  }
  const first = await sourceFor('one');
  const second = await sourceFor('two');
  assert.equal(await sourceFor({ toString() { return 'one'; } }), first);
  // A distinct tag site with the same final prompt reuses generated source.
  assert.equal(await dwim`Return one.\nDone.`, first);
  assert.equal(await eval(first), 1);
  assert.equal(await eval(second), 2);
  assert.deepEqual(calls.requests.map(request => request.description), ['Return one.\nDone.', 'Return two.\nDone.']);
});

test('failed generation is evicted so a later call can succeed', async () => {
  const failure = new Error('Model failed');
  const events = [];
  const { dwim, calls } = fakeModel((_request, number) => {
    if (number === 1) throw failure;
    return response('return 42;');
  }, event => events.push(event));
  await assert.rejects(dwim`Answer.`, error => error === failure);
  const source = await dwim`Answer.`;
  assert.equal(await eval(source), 42);
  assert.equal(calls.requests.length, 2);
  assert.equal(events[0].kind, 'template');
  assert.equal(events[0].description, 'Answer.');
  assert.equal(events[0].error, failure);
});

test('repairs syntax once and caches the repaired source', async () => {
  const { dwim, calls } = fakeModel((_request, number) => response(number === 1 ? 'return value + ;' : 'return value + 1;'));
  const value = 4;
  const source = await dwim`Increment value.`;
  assert.equal(await eval(source), 5);
  assert.equal(await dwim`Increment value.`, source);
  assert.equal(calls.requests.length, 2);
  assert.equal(calls.requests[1].operation, 'body');
  assert.ok(calls.requests[1].repair);
});

test('a second syntax error rejects instead of retrying indefinitely', async () => {
  const { dwim, calls } = fakeModel(() => response('return value + ;'));
  await assert.rejects(dwim`Broken body.`, SyntaxError);
  assert.equal(calls.requests.length, 2);
});

test('runtime errors never trigger generation retries or duplicated execution', async () => {
  const { dwim, calls } = fakeModel(() => response('effects++; throw new SyntaxError("Runtime failure");'));
  let effects = 0;
  const source = await dwim`Throw after incrementing effects.`;
  await assert.rejects(eval(source), /Runtime failure/);
  assert.equal(effects, 1);
  assert.equal(calls.requests.length, 1);
  assert.equal(await dwim`Throw after incrementing effects.`, source);
  assert.equal(effects, 1);
  assert.equal(calls.requests.length, 1);
});

test('destroy clears generated template source and allows a fresh model session', async () => {
  const { dwim, calls } = fakeModel((_request, number) => response(`return ${number};`));
  assert.equal(await eval(await dwim`Answer.`), 1);
  await dwim.$destroy();
  assert.equal(calls.destroyed, 1);
  assert.equal(await eval(await dwim`Answer.`), 2);
  assert.equal(calls.create, 2);
});

test('destroy rejects stale template generation without erasing a newer cached result', async () => {
  const started = deferred();
  const oldResponse = deferred();
  const { dwim, calls } = fakeModel((_request, number) => {
    if (number === 1) {
      started.resolve();
      return oldResponse.promise;
    }
    return response('return 2;');
  });
  const stale = dwim`Answer.`;
  const rejection = assert.rejects(stale, /destroyed/i);
  await started.promise;
  await dwim.$destroy();
  const fresh = await dwim`Answer.`;
  oldResponse.resolve(response('return 1;'));
  await rejection;
  assert.equal(await eval(fresh), 2);
  assert.equal(await dwim`Answer.`, fresh);
  assert.equal(calls.requests.length, 2);
});
