import { createDWIM } from '../index.js';
import { runProgram } from './runner.js';

const $ = id => document.getElementById(id);
const examples = {
  mergeSort: `import DWIM from 'dwim';

const { mergeSort } = DWIM;
console.log(await mergeSort([3, 1, 4, 1, 5]));`,
  randomIntInRange: `import { randomIntInRange } from 'dwim';

console.log(await randomIntInRange(0, 10));`,
  reverse: `import { reverse } from 'dwim';

console.log(await reverse('hello world'));`,
  saySomethingSilly: `import DWIM from 'dwim';

await DWIM.saySomethingSilly();`,
  markdownToHtml: `import DWIM from 'dwim';

document.getElementById('markdown-preview')?.remove();
let d = document.createElement('div');
d.id = 'markdown-preview';
document.body.appendChild(d);

let result = await DWIM.markdownToHtml(\`
## Emphasis

**This is bold text**

__This is bold text__
\`);

console.log(result);
d.innerHTML = result;`,
};
const entries = new Map();
let ready = false;
let supported = false;
let busy = false;
let initialization;
let runId = 0;

function status(message, state = 'ready') {
  $('status').textContent = message;
  $('status').dataset.state = state;
}
function controls() {
  $('run').disabled = !supported || busy || Boolean(initialization);
  $('run').textContent = busy ? 'Running…' : 'Run';
  $('example').disabled = busy;
  $('editor').readOnly = busy;
}
function showTab(name, focus = false) {
  for (const id of ['code', 'implementations']) {
    const selected = id === name;
    $(`${id}-tab`).setAttribute('aria-selected', String(selected));
    $(`${id}-tab`).tabIndex = selected ? 0 : -1;
    $(`${id}-panel`).hidden = !selected;
  }
  if (focus) $(`${name}-tab`).focus();
}
for (const name of ['code', 'implementations']) {
  $(`${name}-tab`).onclick = () => showTab(name);
  $(`${name}-tab`).onkeydown = event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    showTab(event.key === 'Home' ? 'code' : event.key === 'End' ? 'implementations'
      : name === 'code' ? 'implementations' : 'code', true);
  };
}
function renderImplementations() {
  $('count').textContent = entries.size;
  const panel = $('implementations-panel');
  panel.replaceChildren();
  if (!entries.size) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Run your code to see the functions DWIM made up.';
    panel.append(empty);
  }
  for (const entry of entries.values()) {
    const section = document.createElement('section');
    section.className = 'implementation';
    const heading = document.createElement('h2');
    heading.textContent = `DWIM.${entry.path.join('.')}`;
    section.append(heading);
    if (entry.source) {
      const source = document.createElement('pre');
      source.textContent = entry.source;
      section.append(source);
    }
    if ('error' in entry || !entry.source) {
      const note = document.createElement('p');
      note.textContent = 'error' in entry ? `Could not generate this function: ${entry.error?.message ?? format(entry.error)}`
        : 'Imported, not called yet. Its implementation is generated on the first call.';
      section.append(note);
    }
    panel.append(section);
  }
}
function record(entry) {
  const key = JSON.stringify(entry.path);
  const next = { ...entries.get(key), ...entry };
  if ('source' in entry && !('error' in entry)) delete next.error;
  entries.set(key, next);
  renderImplementations();
}
const api = createDWIM({
  onDownloadProgress: fraction => status(`Loading Gemini Nano… ${Math.round(fraction * 100)}%`, 'loading'),
  onCall: event => record(event),
});

function initialize() {
  if (ready) return Promise.resolve();
  if (!initialization) {
    status('Loading Gemini Nano…', 'loading');
    initialization = api.$init().then(() => {
      ready = true;
      status('Gemini Nano is ready.');
    }).finally(() => { initialization = undefined; controls(); });
    controls();
  }
  return initialization;
}
function unsupported() {
  supported = false;
  status('Gemini Nano is not supported in this browser or on this device. Try a supported desktop Chrome.', 'unsupported');
  controls();
}
async function start() {
  if (!globalThis.LanguageModel?.availability || !globalThis.LanguageModel?.create) {
    unsupported();
    return;
  }
  try {
    const availability = await LanguageModel.availability({
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
    });
    if (availability === 'unavailable') { unsupported(); return; }
    supported = true;
    try { await initialize(); }
    catch (error) {
      if (error.name === 'NotAllowedError') {
        status('Chrome needs a click to finish loading Gemini Nano. Click Run to start.', 'loading');
      } else if (error.name === 'NotSupportedError') unsupported();
      else status(`Could not load Gemini Nano: ${error.message}. Click Run to retry.`, 'error');
    }
  } catch (error) {
    status(`Could not check Gemini Nano support: ${error.message}`, 'error');
  }
  controls();
}
function format(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2) ?? String(value); }
  catch { try { return String(value); } catch { return '[Unprintable value]'; } }
}
function chooseExample() {
  $('markdown-preview')?.remove();
  $('editor').value = examples[$('example').value];
  entries.clear();
  renderImplementations();
  $('result').textContent = 'Ready when you are.';
  $('result').dataset.error = 'false';
  $('timing').textContent = '';
  showTab('code');
}
$('example').onchange = chooseExample;
$('run').onclick = async () => {
  if (busy || !supported) return;
  const current = ++runId;
  const code = $('editor').value;
  const output = [];
  busy = true;
  controls();
  entries.clear();
  renderImplementations();
  $('result').textContent = 'Running…';
  $('result').dataset.error = 'false';
  $('timing').textContent = '';
  const started = performance.now();
  const log = (...values) => {
    if (current !== runId) return;
    output.push(values.map(format).join(' '));
    $('result').textContent = output.join('\n');
  };
  try {
    await initialize();
    const result = await runProgram(code, {
      api,
      onImport: path => record({ path }),
      onLog: log,
    });
    if (result !== undefined) log(result);
    if (!output.length) $('result').textContent = 'Finished. Your program did not log a result.';
  } catch (error) {
    log(`${error?.name ?? 'Error'}: ${error?.message ?? format(error)}`);
    $('result').dataset.error = 'true';
    if (!ready) status(`Could not load Gemini Nano: ${error.message}. Click Run to retry.`, 'error');
  } finally {
    for (const entry of entries.values()) {
      if (!entry.source && !entry.error) entry.source = await api.$source(entry.path);
    }
    renderImplementations();
    $('timing').textContent = `${Math.round(performance.now() - started)} ms`;
    busy = false;
    controls();
  }
};
$('editor').onkeydown = event => {
  if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
    event.preventDefault();
    if (!$('run').disabled) $('run').click();
  }
};
chooseExample();
void start();
