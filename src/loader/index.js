const { readdirSync, lstatSync, existsSync, watch } = require('node:fs');
const path = require('node:path');
const pathJoin = path.join;
const { pathToFileURL } = require('node:url');
let minimatchFn;
try { minimatchFn = require('minimatch').minimatch; } catch { minimatchFn = null; }

/**
 * Log as a directory tree
 * @param {(string|object)[]} array
 * @param {number} [dept=0]
 * @param {string} [padding='│   ']
 */
function logDirectoryTree(array, dept=0, padding='│   ') {
    if (dept === 0) console.log('/');
    for (let i = 0; i < array.length; i++) {
        const elt = array[i];
        const isLast = i === array.length - 1;
        process.stdout.write(padding.repeat(dept) + (isLast ? '└── ' : '├── '));
        switch (typeof elt) {
            case "object":
                console.log(`${elt.name} (${elt.sub.length})`);
                logDirectoryTree(elt.sub, dept + 1, isLast ? '    ' : '│   ');
                break;
            case "string":
                console.log(elt);
                break;
            default:
                throw new Error('Invalid element type');
        }
    }
}

/**
 * Build a directory tree from a path
 * @param {string} path
 * @returns {(string|object)[]}
 */
function buildDirectoryTree(pathInput) {
    const dirPath = path.isAbsolute(pathInput) ? pathInput : pathJoin(process.cwd(), pathInput);
    const result = [];
    for (const elt of readdirSync(dirPath)) {
        const eltPath = pathJoin(dirPath, elt);
        if (lstatSync(eltPath).isDirectory()) {
            result.push({ name: elt, sub: buildDirectoryTree(eltPath) });
        } else  {
            result.push(elt);
        }
    }
    return result;
}

/**
 * Build paths from a directory tree
 * @param {string} basePath
 * @param {(string|object)[]} directoryTree
 * @returns {string[]}
 */
function buildPaths(basePath, directoryTree) {
    const paths = [];
    for (const elt of directoryTree) {
        switch (typeof elt) {
            case "object":
                paths.push(...buildPaths(pathJoin(basePath, elt.name), elt.sub));
                break;
            case "string":
                paths.push(pathJoin(basePath, elt));
                break;
            default:
                throw new Error('Invalid element type');
        }
    }
    return paths;
}

/**
 * Load commands from the provided commands folder
 * @param client
 * @param {string} basePath
 * @param {boolean} [silent=false] - Whether to log the directory tree or not
 */
async function loadModule(p) {
    // Support ESM for .mjs
    if (/\.mjs$/.test(p)) {
        const mod = await import(pathToFileURL(p).href);
        return mod.default || mod;
    }
    return require(p);
}

function matchesGlob(p, patterns){
    if (!patterns || patterns.length === 0 || !minimatchFn) return true;
    return patterns.some(glob => minimatchFn(p, glob));
}

async function loader(client, basePath, silent = false, options = {}) {
    const absoluteBase = path.isAbsolute(basePath) ? basePath : pathJoin(process.cwd(), basePath);
    if (!existsSync(absoluteBase)) {
        throw new Error(`Commands folder not found: ${absoluteBase}`);
    }
    const directoryTree = buildDirectoryTree(absoluteBase);
    let paths = buildPaths(absoluteBase, directoryTree)
        .filter(p => /\.(cjs|mjs|js)$/.test(p));
    if (options.include && Array.isArray(options.include)) {
        paths = paths.filter(p => matchesGlob(p, options.include));
    }
    if (options.exclude && Array.isArray(options.exclude)) {
        paths = paths.filter(p => !matchesGlob(p, options.exclude));
    }

    let loaded = 0;
    for (const p of paths) {
        try {
            const command = await loadModule(p);
            if (!command || typeof command.name !== 'string' || command.name.length === 0) {
                console.warn(`Skipping module without valid 'name': ${p}`);
            } else if (client && client.commands && typeof client.commands.set === 'function') {
                client.commands.set(command.name, command);
            }
            loaded++;
        } catch (e) {
            console.error('Invalid command at', p, '\n', e);
        }
    }

    if (!silent) {
        logDirectoryTree(directoryTree);
        console.log(`Loaded ${loaded}/${paths.length} modules from ${absoluteBase}`);
    }

    // Watch mode
    if (options.watch) {
    const watcher = watch(absoluteBase, { recursive: (process.platform === 'win32' || process.platform === 'darwin') }, async (eventType, filename) => {
            if (!filename) return;
            const full = pathJoin(absoluteBase, filename);
            if (!/\.(cjs|mjs|js)$/.test(full)) return;
            if (options.include && !matchesGlob(full, options.include)) return;
            if (options.exclude && matchesGlob(full, options.exclude)) return;
            try {
                // clear require cache for CJS
                if (require.cache[full]) delete require.cache[full];
                const cmd = await loadModule(full);
                if (cmd && cmd.name && client && client.commands && typeof client.commands.set === 'function') {
                    client.commands.set(cmd.name, cmd);
                    if (!silent) console.log(`Reloaded: ${filename}`);
                } else if (!silent) {
                    console.warn(`Changed but no valid command export: ${filename}`);
                }
            } catch (e) {
                console.error('Failed to reload', filename, e);
            }
        });
        if (!silent) console.log('Watch mode enabled');
        return watcher;
    }
    return { loaded, total: paths.length };
}

module.exports = loader;