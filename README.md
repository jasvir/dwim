# DWIM

Library that implements every API you need hallucinated.

**[Try the playground →](https://jasvir.github.io/dwim/)**

Do what I mean. Ask for a function and Gemini Nano writes it on your device.
The next call reuses the implementation. No server, API key, or runtime dependencies.

## Use it

```sh
npm install dwim
```

```js
import DWIM, { randomIntInRange } from 'dwim';

const { mergeSort } = DWIM;
console.log(await mergeSort([3, 1, 4, 1, 5]));
console.log(await randomIntInRange(0, 10));
console.log(await DWIM.math.PI);
```

Run this in a browser app with [Chrome's Prompt API](https://developer.chrome.com/docs/ai/prompt-api),
on HTTPS or localhost. Nano doesn't run in Node. If the model download needs a
click, call `await DWIM.$init()` from a click handler.

Calls and property values need `await`; arguments must be JSON data.
Invented names work through `DWIM.anything` or destructuring. The playground also
accepts arbitrary named imports; the npm module's named exports are fixed.

Curious what it wrote? `await DWIM.$source('mergeSort')` shows the code.
`await DWIM.$destroy()` clears the cache and releases the model.

This is a joke that runs real, unsandboxed JavaScript. It can be wrong.
If your app sets a Content Security Policy, it must allow `unsafe-eval`.
Please definitely do not do that - this is a joke library!

## Run the demo locally

With Node.js 20+:

```sh
git clone https://github.com/jasvir/dwim.git
cd dwim
npm ci
npm run demo
```

Open the printed URL in Chrome. Pick an example or write your own code;
the second tab shows the functions DWIM came up with.

MIT licensed. [Publishing and Pages setup](https://github.com/jasvir/dwim/blob/main/RELEASING.md).
