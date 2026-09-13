import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(resolve(root, relative), 'utf8');
const packageJson = JSON.parse(await read('package.json'));
const version = packageJson.version;
assert.match(version, /^\d+\.\d+\.\d+$/, 'package.json version must be semver-like');

const [sw, readerSw, app, views, versionSource] = await Promise.all([
  read('sw.js'),
  read('reader/sw.js'),
  read('js/app.js'),
  read('js/views.js'),
  read('js/version.js'),
]);
const serviceWorkerVersion = `const VERSION = 'v${version}';`;
assert.ok(sw.includes(serviceWorkerVersion), `sw.js is not using ${serviceWorkerVersion}`);
assert.ok(readerSw.includes(serviceWorkerVersion), `reader/sw.js is not using ${serviceWorkerVersion}`);
assert.ok(versionSource.includes(`export const APP_VERSION = '${version}';`), `js/version.js is not using ${version}`);
assert.ok(app.includes('APP_VERSION'), 'js/app.js is not wired to the shared version');
assert.ok(views.includes('APP_VERSION'), 'js/views.js is not wired to the shared version');
console.log(`version ${version}: package, settings, app/reader service workers aligned`);
