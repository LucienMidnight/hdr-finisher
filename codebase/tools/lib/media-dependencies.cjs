// Read literal private-photo paths without confusing apostrophes or code strings.
const fs = require('node:fs');
const path = require('node:path');
const { CODEBASE } = require('./machine-settings.cjs');
const { babelParse, traverse } = require(path.join(CODEBASE, 'node_modules/playwright/lib/transform/babelBundle.js'));
const found = new Set();
function visit(folder) {
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const file = path.join(folder, entry.name);
    if (entry.isDirectory() && !['lib', 'node_modules', '__pycache__'].includes(entry.name)) visit(file);
    if (!entry.isFile() || !/\.(c?js)$/.test(file) || entry.name.endsWith('.test.js')) continue;
    const source = fs.readFileSync(file, 'utf8');
    if (!/D:[\\/]+Photos/.test(source)) continue;
    const tree = babelParse(source, file);
    traverse(tree, { StringLiteral(p) {
      if (/^D:[\\/]+Photos(?:[\\/]|$)/i.test(p.node.value)) found.add(p.node.value.replace(/\\+/g, '/'));
    } });
  }
}
visit(path.join(CODEBASE, 'tests'));
visit(path.join(CODEBASE, 'tools'));
process.stdout.write(JSON.stringify([...found]));
