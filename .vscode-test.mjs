import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
	version: process.env.VSCODE_TEST_VERSION || 'stable',
	files: 'out/test/**/*.test.js',
	launchArgs: ['--disable-extensions', '--skip-welcome', '--skip-release-notes'],
	mocha: { timeout: 15000 },
});
