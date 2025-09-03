
# Dimdam's

Dimdam's is a Node.js module (mainly for Discord.js) that provides:
- A simple, robust, cached translator.
- A command loader with ESM support, glob filters, and watch mode.

## Installation
```bash
npm i dimdams
```

## Translator

Basic usage (async):
```js
const { translator } = require('dimdams');

(async () => {
	const res = await translator('Bonjour tout le monde', { from: 'auto', to: 'en' });
	console.log(res.text); // "Hello everyone"
})();
```

Key points:
- No preloading is required: just call `translator(text, { from?, to? })` directly.
- Defaults: `from: 'auto'`, `to: 'fr'`.
- Long texts: automatic splitting/merging (chunking). Tunable via `maxChunkChars` (default ~4500).
- Built-in cache (24h TTL) based on normalized `from/to/text`.
- `raw: true` returns the raw response (array of chunks when chunking).

Quick API:
- `translator(text: string, options?: { from?: string; to?: string; raw?: boolean; maxChunkChars?: number }) => Promise<{ text, from, raw }>`
- Normalized errors:
	- 400: invalid parameters (unsupported language, wrong types)
	- 502: unexpected response format
	- 503: network or token generation failure

Optional preloading (cache warm-up):
```js
const { translator } = require('dimdams');

(async () => {
	const map = await translator.loadLanguages(['en','fr'], ['hello','world']);
	// map.fr.hello => "Bonjour"
})();
```

## Loader

Async loading with glob filters and watch:
```js
const { loader } = require('dimdams');
const path = require('node:path');

(async () => {
	const client = { commands: new Map() };
	const resultOrWatcher = await loader(client, path.join(process.cwd(), 'commands'), false, {
		include: ['**/*.js', '**/*.mjs'],
		exclude: ['**/*.test.js'],
		watch: true
	});
	// If watch: true => returns an fs.watch watcher. Otherwise => { loaded, total }
})();
```

Features:
- Supports CJS (.js/.cjs via require) and ESM (.mjs via dynamic import()).
- Glob filters `include`/`exclude` (requires minimatch).
- Watch mode: hot-reload on file changes.
- Skips modules without a valid `name`, with a warning.
- The provided path must exist, otherwise an explicit error is thrown.

## Types and exports

- TypeScript types via `index.d.ts` (translator, loader, options, and results).
- Exports:
	- `require('dimdams')`
	- `require('dimdams/translator')`
	- `require('dimdams/loader')`

## Quick examples (terminal)

- Test translator:
```bash
node -e "const t=require('./src/translator'); (async()=>{const r=await t('bonjour',{to:'en'}); console.log('translation:', r.text,'from:', r.from.language.iso)})()"
```

- Test loader (replace `./commands` with your folder):
```bash
node -e "const l=require('./src/loader'); const path=require('node:path'); (async()=>{const client={commands:new Map()}; const r=await l(client, path.join(process.cwd(),'./commands'), false, {include:['**/*.*js']}); console.log('loaded', r.loaded, '/', r.total)})()"
```

## Screenshots

![loader](https://i.imgur.com/ndS9GK4.png)


## 🚀 About Me
I'm a full stack developer...


## Authors

- [@dimdam](https://github.com/benladamm)


## 🔗 Links
[![discord](https://img.shields.io/discord/934849076342689872)](https://discord.gg/daGHcxN5YH)
