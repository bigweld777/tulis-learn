'use strict';
const fs = require('node:fs');
const path = require('node:path');
// Publish a closed list, never the repository root or an embedded database.
const files = ['index.html', 'app.js', 'api-contract.js', 'local-api.js', 'review-store.js', 'vendor/ts-fsrs.js', 'vendor/LICENSE.ts-fsrs', 'favicon.svg', 'icon-192.png', 'icon-512.png', 'manifest.json', 'sw.js', '404.html', 'robots.txt', 'sitemap.xml', '_headers'];
const output = path.join(__dirname, 'dist');
fs.mkdirSync(output, { recursive: true });
// Refuse to publish unexpected stale files left in a pre-existing staging directory.
function inspect(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Symlink in static output: ' + entry.name);
    if (entry.isDirectory()) inspect(absolute);
    else if (!files.includes(path.relative(output, absolute).split(path.sep).join('/'))) throw new Error('Unexpected static output file: ' + absolute);
  }
}
inspect(output);
for (const file of files) {
  const target = path.join(output, file);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(__dirname, file), target);
}
console.log(`Prepared ${files.length} public assets in dist/.`);
