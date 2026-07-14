const fs = require('fs');
const path = require('path');

let cached;

function routeFileKey(filePath) {
  return path.basename(filePath).replace(/\.routes?(\.js)?$/, '').replace(/\.js$/, '');
}

function readMounts() {
  const indexPath = path.join(__dirname, '../index.js');
  if (!fs.existsSync(indexPath)) return new Map();
  const source = fs.readFileSync(indexPath, 'utf8');
  const requires = new Map();
  const mounts = new Map();

  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*require\(['"]\.\/routes\/([^'"]+)['"]\)/g)) {
    requires.set(match[1], routeFileKey(match[2]));
  }

  for (const match of source.matchAll(/app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\(prisma\)/g)) {
    const key = requires.get(match[2]);
    if (!key) continue;
    if (!mounts.has(key)) mounts.set(key, []);
    mounts.get(key).push(match[1]);
  }

  for (const match of source.matchAll(/app\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*require\(['"]\.\/routes\/([^'"]+)['"]\)\(prisma\)/g)) {
    const key = routeFileKey(match[2]);
    if (!mounts.has(key)) mounts.set(key, []);
    mounts.get(key).push(match[1]);
  }

  return mounts;
}

function joinPath(prefix, routePath) {
  const left = String(prefix || '').replace(/\/+$/, '');
  const right = String(routePath || '').replace(/^\/+/, '');
  return right ? `${left}/${right}` : left || '/';
}

function getCapabilityCatalog() {
  if (cached) return cached;
  const dir = path.join(__dirname, '../routes');
  const mounts = readMounts();
  const capabilities = [];

  for (const file of fs.readdirSync(dir).filter(item => item.endsWith('.js'))) {
    const module = routeFileKey(file);
    const source = fs.readFileSync(path.join(dir, file), 'utf8');
    const regex = /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
    const prefixes = mounts.get(module) || [`/${module}`];
    let match;
    while ((match = regex.exec(source))) {
      for (const prefix of prefixes) {
        capabilities.push({
          module,
          method: match[1].toUpperCase(),
          path: joinPath(prefix, match[2]),
          mutation: match[1].toLowerCase() !== 'get'
        });
      }
    }
  }

  cached = capabilities;
  return cached;
}

function compactCapabilityCatalog(limit = 220) {
  return getCapabilityCatalog()
    .slice(0, limit)
    .map(item => `${item.method} ${item.path} (${item.module})`)
    .join('\n');
}

module.exports = { getCapabilityCatalog, compactCapabilityCatalog };
