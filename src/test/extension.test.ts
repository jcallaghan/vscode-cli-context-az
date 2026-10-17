import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Packaged extension integration', () => {
	test('the production extension is installed and activates', async () => {
		const extension = vscode.extensions.getExtension('jcallaghan.azure-cli-context');
		assert.ok(extension, 'The development extension must be available');
		assert.equal(extension.packageJSON.main, './dist/extension.js');
		await extension.activate();
		assert.equal(extension.isActive, true);
	});

	test('all contributed commands are registered', async () => {
		const extension = vscode.extensions.getExtension('jcallaghan.azure-cli-context');
		assert.ok(extension);
		await extension.activate();
		const commands = await vscode.commands.getCommands(true);
		for (const name of [
			'showAccountMenu', 'refresh', 'login', 'logout', 'switchSubscription',
			'copySubscriptionId', 'copyTenantId'
		]) {
			assert.ok(commands.includes(`azure-cli-context.${name}`), `Missing command: ${name}`);
		}
	});

	test('detail visibility settings preserve the useful default context', () => {
		const configuration = vscode.workspace.getConfiguration('azure-cli-context');
		for (const name of ['showUser', 'showSubscriptionName', 'showSubscriptionId', 'showTenantId']) {
			assert.equal(configuration.get(name), true, `${name} must be visible by default`);
		}
	});
});
