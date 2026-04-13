/**
 * Generates latest.yml for electron-updater (zip-based update)
 * Usage: node scripts/generate-latest-yml.cjs
 */
const fs = require('fs');
const crypto = require('crypto');
const path = require('path');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '../package.json'), 'utf8'));
const version = pkg.version;
const zipName = `Restoran-POS-${version}-win.zip`;
const zipPath = path.join(__dirname, '../dist-electron', zipName);

if (!fs.existsSync(zipPath)) {
  console.error(`Zip bulunamadi: ${zipPath}`);
  process.exit(1);
}

const fileBuffer = fs.readFileSync(zipPath);
const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
const size = fs.statSync(zipPath).size;
const releaseDate = new Date().toISOString();

const yml = `version: ${version}
files:
  - url: ${zipName}
    sha512: ${sha512}
    size: ${size}
path: ${zipName}
sha512: ${sha512}
releaseDate: '${releaseDate}'
`;

const outPath = path.join(__dirname, '../dist-electron/latest.yml');
fs.writeFileSync(outPath, yml, 'utf8');
console.log(`latest.yml yazildi: ${outPath}`);
console.log(`  version: ${version}`);
console.log(`  size: ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  sha512: ${sha512.substring(0, 20)}...`);
