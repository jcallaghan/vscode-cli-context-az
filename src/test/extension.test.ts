import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Packaged extension integration', () => {
	test('the production extension is installed and activates', async () => {
		const extension = vscode.extensions.getExtension('jcallaghan.azure-cli-context');
		assert.ok(extension, 'The development extension must be available');
		assert.equal(extension.packageJSON.main, './dist/extension.js');
		assert.equal(extension.packageJSON.displayName, 'CLI Context: Azure');
		await extension.activate();
		assert.equal(extension.isActive, true);
	});

	test('contributed UI uses CLI Context branding without changing command IDs', () => {
		const extension = vscode.extensions.getExtension('jcallaghan.azure-cli-context');
		assert.ok(extension);
		const contributions = extension.packageJSON.contributes;
		assert.equal(contributions.configuration.title, 'CLI Context: Azure');
		for (const command of contributions.commands) {
			assert.equal(command.category, 'CLI Context: Azure');
			assert.ok(command.command.startsWith('azure-cli-context.'));
			if (command.command === 'azure-cli-context.showAccountMenu') {
				assert.equal(command.icon, '$(azure)');
			}
		}
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
