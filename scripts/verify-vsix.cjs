const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const vsce = path.join(root, 'node_modules', '@vscode', 'vsce', 'vsce');
const files = execFileSync(process.execPath, [vsce, 'ls'], { cwd: root, encoding: 'utf8' })
	.trim().split(/\r?\n/).map(file => file.replaceAll('\\', '/')).sort();
const expected = ['CHANGELOG.md', 'LICENSE', 'README.md', 'SECURITY.md', 'dist/extension.js', 'images/icon.png', 'package.json'].sort();
assert.deepEqual(files, expected, 'VSIX must contain only the approved release files');
assert.equal(manifest.publisher, 'jcallaghan');
assert.equal(manifest.repository.url, 'https://github.com/jcallaghan/vscode-cli-context-az.git');
assert.equal(manifest.dependencies, undefined, 'The runtime should remain dependency-free');
assert.ok(!/your-publisher|your-username|Your Name/.test(JSON.stringify(manifest)));
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md']) {
	assert.ok(!/your-publisher|your-username|Your Name/.test(fs.readFileSync(path.join(root, file), 'utf8')));
}
const icon = fs.readFileSync(path.join(root, 'images', 'icon.png'));
assert.equal(icon.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.ok(icon.readUInt32BE(16) >= 128 && icon.readUInt32BE(20) >= 128);
console.log('Release identity, package allowlist, runtime dependency boundary and icon verified.');
