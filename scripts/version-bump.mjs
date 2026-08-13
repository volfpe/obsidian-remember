import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const version = process.env.npm_package_version;
const manifest = readJson('manifest.json');
const versions = readJson('versions.json');

manifest.version = version;
versions[version] = manifest.minAppVersion;

writeJson('manifest.json', manifest);
writeJson('versions.json', versions);

function readJson(path) {
	return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, '\t')}\n`);
}
