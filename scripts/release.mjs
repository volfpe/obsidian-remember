import { execFileSync } from 'node:child_process';
import process from 'node:process';

const version = process.argv[2];

if (!version) {
	console.error('Usage: npm run release -- <version>');
	process.exit(1);
}

if (exec('git', ['status', '--porcelain'], true)) {
	console.error('Release aborted: working tree is not clean.');
	process.exit(1);
}

exec('npm', ['version', version, '--no-git-tag-version']);
exec('npm', ['run', 'build']);
exec('npm', ['test']);
exec('git', ['add', 'package.json', 'package-lock.json', 'manifest.json', 'versions.json']);
exec('git', ['commit', '-m', `Release ${version}`]);
exec('git', ['tag', '-a', version, '-m', version]);
exec('git', ['push', '--atomic', 'origin', 'HEAD', version]);
exec('gh', [
	'release',
	'create',
	version,
	'main.js',
	'manifest.json',
	'styles.css',
	'--title',
	version,
	'--draft',
	'--generate-notes',
]);

function exec(command, args, capture = false) {
	return execFileSync(command, args, {
		encoding: 'utf8',
		stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
	})?.trim();
}
