import test from 'node:test';
import assert from 'node:assert/strict';
import DWIM, { DWIM as namedDWIM, createDWIM, mergeSort, randomIntInRange } from '../index.js';

function fakeModel(respond, { availability = 'available', onCall } = {}) {
  const calls = {
    availability: 0,
    create: 0,
    clone: 0,
    prompts: [],
    cloneDestroyed: 0,
    baseDestroyed: 0,
  };

  const languageModel = {
    async availability() {
      calls.availability++;
      return availability;
    },
    async create() {
      calls.create++;
      return {
        async clone() {
          calls.clone++;
          return {
            async prompt(input, options) {
              calls.prompts.push({ input, options });
              return respond(input, calls.prompts.length, options);
            },
            destroy() {
              calls.cloneDestroyed++;
            },
          };
        },
        destroy() {
          calls.baseDestroyed++;
        },
      };
    },
  };

  return { dwim: createDWIM({ languageModel, onCall }), calls };
}

const functionResponse = code => JSON.stringify({ code });
const propertyResponse = value => JSON.stringify({ value });

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

test('exports the default proxy, its named alias, and example functions', () => {
  assert.equal(DWIM, namedDWIM);
  assert.equal(typeof DWIM, 'function');
  assert.equal(typeof mergeSort, 'function');
  assert.equal(typeof randomIntInRange, 'function');
});

test('construction is lazy and awaiting the root does not initialize a model', async () => {
  const { dwim, calls } = fakeModel(() => {
    throw new Error('No generation expected');
  });

  assert.equal(await dwim, dwim);
  assert.equal(dwim.then, undefined);
  assert.equal(calls.availability, 0);
  assert.equal(calls.create, 0);
  assert.equal(calls.prompts.length, 0);
});

test('$init shares initialization and $destroy releases the base session', async () => {
  const { dwim, calls } = fakeModel(() => {
    throw new Error('No generation expected');
  });

  await Promise.all([dwim.$init(), dwim.$init()]);
  assert.equal(calls.create, 1);
  assert.equal(calls.prompts.length, 0);
  await dwim.$destroy();
  assert.equal(calls.baseDestroyed, 1);
});

test('generates and executes mergeSort on the supplied arguments', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('(values) => [...values].sort((a, b) => a - b)'));
  const input = [3, 1, 4, 1, 5];

  assert.deepEqual(await dwim.mergeSort(input), [1, 1, 3, 4, 5]);
  assert.deepEqual(input, [3, 1, 4, 1, 5]);
  assert.match(calls.prompts[0].input, /mergeSort/);
  assert.match(calls.prompts[0].input, /sampleArgs/);
  assert.ok(calls.prompts[0].options?.responseConstraint);
  assert.equal(calls.cloneDestroyed, 1);
});

test('deduplicates concurrent function generation by full namespace path', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('(a, b) => a + b'));

  assert.deepEqual(await Promise.all([
    dwim.math.sum(2, 3),
    dwim.math.sum(5, 7),
    dwim.math.sum(11, 13),
  ]), [5, 12, 24]);
  assert.equal(calls.create, 1);
  assert.equal(calls.clone, 1);
  assert.equal(calls.prompts.length, 1);
  assert.match(calls.prompts[0].input, /math/);
  assert.match(calls.prompts[0].input, /sum/);
});

test('keeps functions at distinct namespace paths separate', async () => {
  const { dwim, calls } = fakeModel((_input, requestNumber) => functionResponse(`() => ${requestNumber}`));

  assert.equal(await dwim.first.value(), 1);
  assert.equal(await dwim.second.value(), 2);
  assert.equal(await dwim.first.value(), 1);
  assert.equal(calls.prompts.length, 2);
});

test('observes direct and destructured calls, including cache hits, before execution', async () => {
  const source = 'items => { items.push("executed"); return items.length; }';
  const events = [];
  const order = [];
  const { dwim, calls } = fakeModel(() => functionResponse(source), {
    onCall(event) {
      events.push(event);
      order.push('observed');
    },
  });
  const { record } = dwim.nested;

  assert.equal(await dwim.nested.record(order), 2);
  assert.equal(await record(order), 4);
  assert.deepEqual(order, ['observed', 'executed', 'observed', 'executed']);
  assert.deepEqual(events, [
    { path: ['nested', 'record'], source },
    { path: ['nested', 'record'], source },
  ]);
  assert.equal(calls.prompts.length, 1);
});

test('observer failures and event mutation cannot disrupt calls or their cache', async () => {
  let observations = 0;
  const { dwim, calls } = fakeModel(() => functionResponse('value => value'), {
    onCall(event) {
      event.path.push('changed');
      if (++observations === 1) throw new Error('Observer failed');
      return Promise.reject(new Error('Async observer failed'));
    },
  });
  const { identity } = dwim;

  assert.equal(await identity(1), 1);
  assert.equal(await identity(2), 2);
  assert.equal(observations, 2);
  assert.equal(calls.prompts.length, 1);
});

test('observes failed generation with its error and generated source when available', async () => {
  for (const source of [undefined, '( =>', '42', '(() => { throw new SyntaxError("Factory failed"); })()']) {
    const events = [];
    const { dwim, calls } = fakeModel(() => {
      if (source === undefined) throw new Error('Model failed');
      return functionResponse(source);
    }, { onCall: event => events.push(event) });

    let rejection;
    await assert.rejects(dwim.answer(), error => {
      rejection = error;
      return true;
    });
    assert.deepEqual(events, [{ path: ['answer'], source, error: rejection }]);
    assert.equal(calls.prompts.length, source === '( =>' ? 2 : 1);
  }
});

test('reuses generated code while executing it afresh for every call', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('(() => { let calls = 0; return () => ++calls; })()'));

  assert.equal(await dwim.nextNumber(), 1);
  assert.equal(await dwim.nextNumber(), 2);
  assert.equal(await dwim.nextNumber(), 3);
  assert.equal(calls.prompts.length, 1);
});

test('passes new arguments to a cached random-integer implementation', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('(min, max) => Math.floor(Math.random() * (max - min + 1)) + min'));

  for (const [min, max] of [[0, 10], [20, 30], [-10, -1], [8, 8]]) {
    const value = await dwim.randomIntInRange(min, max);
    assert.ok(Number.isInteger(value));
    assert.ok(value >= min && value <= max);
  }
  assert.equal(calls.prompts.length, 1);
});

test('supports asynchronous generated functions', async () => {
  const { dwim } = fakeModel(() => functionResponse('async value => value * 2'));
  assert.equal(await dwim.double(21), 42);
});

test('returns nested JSON property values', async () => {
  const expected = { enabled: true, retries: 3, labels: ['small', 'silly'], extra: null };
  const { dwim, calls } = fakeModel(() => propertyResponse(expected));

  assert.deepEqual(await dwim.settings.defaults, expected);
  assert.match(calls.prompts[0].input, /settings/);
  assert.match(calls.prompts[0].input, /defaults/);
  assert.ok(calls.prompts[0].options?.responseConstraint);
  assert.equal(calls.cloneDestroyed, 1);
});

test('deduplicates awaits of one property node and generates anew on a new read', async () => {
  const { dwim, calls } = fakeModel((_input, requestNumber) => propertyResponse(requestNumber));
  const property = dwim.current.value;

  assert.deepEqual(await Promise.all([property, property]), [1, 1]);
  assert.equal(await property, 1);
  assert.equal(await dwim.current.value, 2);
  assert.equal(calls.prompts.length, 2);
});

test('property names that overlap ordinary function metadata are generated', async () => {
  const { dwim, calls } = fakeModel((_input, requestNumber) => propertyResponse(requestNumber === 1 ? 'hallucinated' : 17));

  assert.equal(await dwim.example.name, 'hallucinated');
  assert.equal(await dwim.example.length, 17);
  assert.equal(calls.prompts.length, 2);
});

test('symbol reads do not generate values', () => {
  const { dwim, calls } = fakeModel(() => {
    throw new Error('No generation expected');
  });

  assert.equal(dwim[Symbol('unknown')], undefined);
  void dwim[Symbol.toStringTag];
  void dwim[Symbol.iterator];
  assert.equal(calls.create, 0);
  assert.equal(calls.prompts.length, 0);
});

test('rejects mutation that could break the proxy behavior', () => {
  const { dwim } = fakeModel(() => propertyResponse(null));

  assert.throws(() => { dwim.foo = 1; });
  assert.throws(() => Object.defineProperty(dwim, 'foo', { value: 1 }));
  assert.throws(() => { delete dwim.foo; });
  assert.throws(() => Object.preventExtensions(dwim));
});

test('retains source for inspection and clears it on destruction', async () => {
  const source = '(left, right) => left + right';
  const { dwim, calls } = fakeModel(() => functionResponse(source));

  assert.equal(await dwim.$source('math.add'), undefined);
  assert.equal(calls.create, 0);
  assert.equal(await dwim.math.add(2, 3), 5);
  assert.equal(await dwim.$source('math.add'), source);
  await dwim.$destroy();
  assert.equal(await dwim.$source('math.add'), undefined);
  assert.equal(await dwim.math.add(8, 13), 21);
  assert.equal(calls.create, 2);
  assert.equal(calls.prompts.length, 2);
});

test('retries failed function generation and destroys each generation session', async () => {
  const { dwim, calls } = fakeModel((_input, requestNumber) => {
    if (requestNumber === 1) throw new Error('Temporary model failure');
    return functionResponse('value => value');
  });

  await assert.rejects(dwim.identity('first'));
  assert.equal(calls.cloneDestroyed, 1);
  assert.equal(await dwim.identity('second'), 'second');
  assert.equal(calls.prompts.length, 2);
  assert.equal(calls.cloneDestroyed, 2);
});

test('rejects malformed model JSON and releases the generation session', async () => {
  const { dwim, calls } = fakeModel(() => 'not JSON');

  await assert.rejects(dwim.answer());
  assert.equal(calls.cloneDestroyed, 1);
});

test('rejects invalid function code and non-function generated expressions', async () => {
  for (const source of ['( =>', '42']) {
    const { dwim, calls } = fakeModel(() => functionResponse(source));
    await assert.rejects(dwim.answer(), error => {
      if (source === '( =>') assert.equal(error.generatedSource, source);
      return true;
    });
    const expectedAttempts = source === '( =>' ? 2 : 1;
    assert.equal(calls.cloneDestroyed, expectedAttempts);
    assert.equal(calls.prompts.length, expectedAttempts);
  }
});

test('repairs a malformed function expression once and caches the valid implementation', async () => {
  const { dwim, calls } = fakeModel((_input, requestNumber) => functionResponse(
    requestNumber === 1
      ? 'function increment(value) { return value + ; }'
      : 'value => value + 1',
  ));

  assert.equal(await dwim.increment(4), 5);
  assert.equal(await dwim.increment(10), 11);
  assert.equal(calls.prompts.length, 2);
  assert.equal(calls.cloneDestroyed, 2);
});

test('accepts a declaration program with helpers and selects the final path component', async () => {
  const source = 'function helper(value) { return value * 2; } function increment(value) { return helper(value) + 1; }';
  const { dwim, calls } = fakeModel(() => functionResponse(source));

  assert.equal(await dwim.math.increment(4), 9);
  assert.equal(await dwim.math.increment(10), 21);
  assert.equal(await dwim.$source('math.increment'), source);
  assert.equal(calls.prompts.length, 1);
  assert.equal(calls.cloneDestroyed, 1);
});

test('accepts expression functions for arbitrary names without interpolating names as source', async () => {
  const leaf = 'entry; //';
  const expression = fakeModel(() => functionResponse('value => value + 1'));
  assert.equal(await expression.dwim[leaf](4), 5);
  assert.equal(expression.calls.prompts.length, 1);

  // An unsafe `return ${leaf}` fallback would incorrectly select entry here.
  const declarations = fakeModel(() => functionResponse(
    'function entry() { return helper(); } function helper() { return 42; }',
  ));
  await assert.rejects(declarations.dwim[leaf]());
  assert.equal(declarations.calls.prompts.length, 2);
});

test('does not retry a SyntaxError thrown while evaluating a declaration program', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse(
    'throw new SyntaxError("Declaration execution must not retry"); function answer() { return 42; }',
  ));

  await assert.rejects(dwim.answer(), /Declaration execution must not retry/);
  assert.equal(calls.prompts.length, 1);
});

test('does not retry a SyntaxError thrown while evaluating valid generated source', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse(
    '(() => { throw new SyntaxError("Execution must not retry"); })()',
  ));

  await assert.rejects(dwim.answer(), /Execution must not retry/);
  assert.equal(calls.prompts.length, 1);
  assert.equal(calls.cloneDestroyed, 1);
});

test('surfaces generated function exceptions without regenerating the function', async () => {
  const source = '() => { throw new Error("That was intentional"); }';
  const events = [];
  const { dwim, calls } = fakeModel(() => functionResponse(source), {
    onCall: event => events.push(event),
  });

  await assert.rejects(dwim.fail(), /That was intentional/);
  await assert.rejects(dwim.fail(), /That was intentional/);
  assert.equal(calls.prompts.length, 1);
  assert.deepEqual(events, [
    { path: ['fail'], source },
    { path: ['fail'], source },
  ]);
});

test('fails clearly before creating a session when Nano is unavailable', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('() => 1'), { availability: 'unavailable' });

  await assert.rejects(dwim.answer());
  assert.equal(calls.create, 0);
  assert.equal(calls.prompts.length, 0);
});

test('destroying during initialization releases the late session and allows a fresh start', async () => {
  const creating = deferred();
  const created = deferred();
  let creates = 0;
  let destroyed = 0;
  const session = { destroy() { destroyed++; } };
  const dwim = createDWIM({ languageModel: {
    async availability() { return 'available'; },
    create() {
      creates++;
      if (creates === 1) {
        creating.resolve();
        return created.promise;
      }
      return Promise.resolve(session);
    },
  } });

  const initializationRejected = assert.rejects(dwim.$init());
  await creating.promise;
  const destruction = dwim.$destroy();
  created.resolve(session);
  await Promise.all([initializationRejected, destruction]);
  assert.equal(destroyed, 1);

  await dwim.$init();
  assert.equal(creates, 2);
  await dwim.$destroy();
  assert.equal(destroyed, 2);
});

test('destroying during generation rejects stale work without evicting its replacement', async () => {
  const started = deferred();
  const oldResponse = deferred();
  const { dwim, calls } = fakeModel((_input, requestNumber) => {
    if (requestNumber === 1) {
      started.resolve();
      return oldResponse.promise;
    }
    return functionResponse('() => "fresh"');
  });

  const oldCallRejected = assert.rejects(dwim.answer());
  await started.promise;
  await dwim.$destroy();
  assert.equal(await dwim.answer(), 'fresh');

  oldResponse.resolve(functionResponse('() => "stale"'));
  await oldCallRejected;
  assert.equal(await dwim.answer(), 'fresh');
  assert.equal(calls.create, 2);
  assert.equal(calls.prompts.length, 2);
});

test('destroying after a prompt resolves prevents the generated function from running', async () => {
  const started = deferred();
  const response = deferred();
  const destroyed = deferred();
  const dwim = createDWIM({ languageModel: {
    async availability() { return 'available'; },
    async create() {
      return {
        async clone() {
          return {
            prompt() {
              started.resolve();
              return response.promise;
            },
            destroy() {},
          };
        },
        destroy() {},
      };
    },
  } });

  const rejected = assert.rejects(dwim.answer());
  await started.promise;
  response.resolve(functionResponse('() => "should not execute"'));
  queueMicrotask(() => { destroyed.resolve(dwim.$destroy()); });
  await Promise.all([rejected, destroyed.promise]);
});

test('destroying immediately after a cached call prevents its execution', async () => {
  const { dwim } = fakeModel(() => functionResponse('() => 42'));
  assert.equal(await dwim.answer(), 42);

  const rejected = assert.rejects(dwim.answer());
  await dwim.$destroy();
  await rejected;
});

test('rejects unsupported arguments before initializing the model or invoking toJSON', async () => {
  let toJSONCalls = 0;
  class CustomValue {
    toJSON() {
      toJSONCalls++;
      return 'misleadingly compatible';
    }
  }
  const cyclic = {};
  cyclic.self = cyclic;
  const { dwim, calls } = fakeModel(() => functionResponse('value => value'));
  const unsupported = [
    undefined, () => {}, Symbol('value'), 1n, NaN, Infinity,
    { nested: undefined }, { nested: () => {} }, cyclic,
    new Date(), new Map([['a', 1]]), new Set([1]), new CustomValue(),
  ];

  for (const value of unsupported) await assert.rejects(dwim.identity(value));
  assert.equal(toJSONCalls, 0);
  assert.equal(calls.create, 0);
  assert.equal(calls.prompts.length, 0);
});

test('validates arguments even after a function is cached', async () => {
  const { dwim, calls } = fakeModel(() => functionResponse('value => value'));
  assert.equal(await dwim.identity(42), 42);

  await assert.rejects(dwim.identity(new Map()));
  assert.equal(calls.prompts.length, 1);
});
