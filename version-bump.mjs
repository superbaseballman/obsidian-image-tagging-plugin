import fs from 'fs';

const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const version = manifest.version.split('.');
version[2] = parseInt(version[2]) + 1;
manifest.version = version.join('.');

fs.writeFileSync('manifest.json', JSON.stringify(manifest, null, 2));

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
pkg.version = manifest.version;

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2));

// Also create versions.json if it doesn't exist
const versions = {};
versions[manifest.version] = 'version-bump-script';
fs.writeFileSync('versions.json', JSON.stringify(versions, null, 2));