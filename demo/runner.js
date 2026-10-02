import { parse } from 'acorn';

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

// This runs the editor's code on the demo origin. It is a playground, not a sandbox.
export async function runProgram(code, { api, onImport = () => {}, onLog = () => {} }) {
  if (typeof code !== 'string') throw new TypeError('The program must be JavaScript text.');
  if (api == null) throw new TypeError('A DWIM instance is required.');
  const tree = parse(code, {
    ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true,
  });
  const imports = tree.body.filter(node => node.type === 'ImportDeclaration');
  visit(tree, node => {
    if (node.type === 'ImportExpression') {
      throw new SyntaxError("Use a static import from '@jnagra/dwim'; dynamic imports are not supported in this playground.");
    }
    if (node.type.startsWith('Export')) {
      throw new SyntaxError('Exports are not supported in this playground. Use console.log or return a value.');
    }
    if (node.type === 'MetaProperty' && node.meta.name === 'import') {
      throw new SyntaxError('import.meta is not supported in this playground.');
    }
  });

  // Keep generated bindings out of the user's identifier space, including comments.
  let context;
  do { context = `__dwim_${Math.random().toString(36).slice(2)}`; } while (code.includes(context));
  const declarations = [];
  const importedPaths = [];
  for (const statement of imports) {
    // Keep the original demo spelling working for saved playground programs.
    if (!['@jnagra/dwim', 'dwim'].includes(statement.source.value)) {
      throw new SyntaxError("This playground only supports imports from '@jnagra/dwim'.");
    }
    for (const specifier of statement.specifiers) {
      let value = `${context}.api`;
      if (specifier.type === 'ImportNamespaceSpecifier') value = `${context}.namespace`;
      if (specifier.type === 'ImportSpecifier') {
        const name = specifier.imported.name ?? specifier.imported.value;
        if (name === 'createDWIM') {
          throw new SyntaxError('createDWIM is not available in the playground. Use its existing DWIM instance.');
        }
        if (name !== 'default' && name !== 'DWIM') {
          value += `[${JSON.stringify(name)}]`;
          importedPaths.push([name]);
        }
      }
      declarations.push(`const ${specifier.local.name} = ${value};`);
    }
  }
  // Imports are hoisted, and only parser-identified import ranges are replaced.
  let body = code;
  for (const statement of [...imports].reverse()) {
    const blank = [...code.slice(statement.start, statement.end)]
      .map(char => char === '\n' || char === '\r' ? char : ' ').join('');
    body = body.slice(0, statement.start) + blank + body.slice(statement.end);
  }

  const pending = new Set();
  const wrapped = new WeakMap();
  function track(value) {
    if (value === null || (typeof value !== 'object' && typeof value !== 'function')) return value;
    if (wrapped.has(value)) return wrapped.get(value);
    const proxy = new Proxy(value, {
      get(target, key) {
        const child = Reflect.get(target, key);
        if (key === 'then') return typeof child === 'function' ? child.bind(target) : child;
        if (typeof key === 'symbol' || key.startsWith('$')) return child;
        return track(child);
      },
      apply(target, thisArg, args) {
        const result = Reflect.apply(target, thisArg, args);
        const promise = Promise.resolve(result);
        pending.add(promise);
        // Attach rejection handling now, before the editor program has finished.
        promise.then(
          () => pending.delete(promise),
          () => pending.delete(promise),
        );
        return result;
      },
    });
    wrapped.set(value, proxy);
    return proxy;
  }
  const trackedAPI = track(api);
  const namespace = new Proxy(Object.create(null), {
    get(_target, name) {
      if (name === Symbol.toStringTag) return 'Module';
      if (typeof name === 'symbol') return undefined;
      if (name === 'default' || name === 'DWIM') return trackedAPI;
      if (name === 'createDWIM') {
        throw new TypeError('createDWIM is not available in the playground. Use its existing DWIM instance.');
      }
      return trackedAPI[name];
    },
  });
  const capturedConsole = Object.create(globalThis.console);
  for (const name of ['log', 'info', 'warn', 'error']) {
    Object.defineProperty(capturedConsole, name, {
      value: (...args) => onLog(...args), writable: true, configurable: true,
    });
  }
  const execute = new AsyncFunction('DWIM', context, 'console', `
    "use strict";
    return (async function () {
      ${declarations.join('\n')}
      ${body}
    })();
  `);
  for (const path of importedPaths) onImport(path);
  let result;
  let failed = false;
  let programError;
  try { result = await execute(trackedAPI, { api: trackedAPI, namespace }, capturedConsole); }
  catch (error) { failed = true; programError = error; }
  while (pending.size) await Promise.allSettled([...pending]);
  if (failed) throw programError;
  return result;
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') callback(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach(child => visit(child, callback));
    else if (value && typeof value === 'object') visit(value, callback);
  }
}
