const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');
const realCli = require('../out/azureCli.js');

const source = fs.readFileSync(require.resolve('../out/extension.js'), 'utf8');
const id = '11111111-1111-1111-1111-111111111111';
const otherId = '33333333-3333-3333-3333-333333333333';
const account = (name = 'Current', subscriptionId = id) => ({
	id: subscriptionId, name, tenantId: '22222222-2222-2222-2222-222222222222',
	user: { name: 'user@example.test', type: 'user' }, isDefault: true, state: 'Enabled'
});
const tick = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
	return { promise, resolve, reject };
}
function event() {
	const listeners = new Set();
	return {
		subscribe: callback => {
			listeners.add(callback);
			return { dispose: () => listeners.delete(callback) };
		},
		fire: value => { for (const callback of [...listeners]) { callback(value); } },
		get size() { return listeners.size; }
	};
}

function setup(t, options = {}) {
	const commands = new Map();
	const calls = [];
	const errors = [];
	const information = [];
	const logs = [];
	const outputNames = [];
	const clipboard = [];
	const menus = [];
	const terminals = [];
	const timers = new Map();
	const configuration = { ...options.configuration };
	const focus = event();
	const config = event();
	const terminalEnd = event();
	const terminalClose = event();
	const watcherChange = event();
	const watcherCreate = event();
	const watcherDelete = event();
	const reads = [...(options.reads || [account()])];
	const lists = [...(options.lists || [[account(), account('Other', otherId)]])];
	let active = account();
	let cliDisposed = false;
	let warningAnswer = options.warningAnswer;
	let pattern;
	const read = queue => {
		const value = queue.length ? queue.shift() : active;
		if (value instanceof Error) {
			return Promise.reject(value);
		}
		return Promise.resolve(value);
	};
	class FakeCli {
		getCurrentAccount() { calls.push('show'); return read(reads); }
		getAllAccounts() { calls.push('list'); return read(lists); }
		async setSubscription(value) {
			calls.push(['set', value]);
			if (options.setError) {
				throw options.setError;
			}
			active = account('Other', value);
		}
		async logout() { calls.push('logout'); active = null; }
		dispose() { cliDisposed = true; }
	}
	const status = { text: '', tooltip: '', show() {}, dispose() {} };
	const output = { appendLine: value => logs.push(value), dispose() {} };
	const api = {
		StatusBarAlignment: { Left: 1 },
		QuickPickItemKind: { Separator: -1 },
		ProgressLocation: { Notification: 15 },
		ThemeColor: class { constructor(id) { this.id = id; } },
		RelativePattern: class { constructor(base, glob) { this.base = base; this.pattern = glob; } },
		commands: {
			registerCommand(name, callback) {
				commands.set(name, callback);
				return { dispose: () => commands.delete(name) };
			}
		},
		env: { clipboard: { async writeText(value) {
			if (options.clipboardError) {
				throw options.clipboardError;
			}
			clipboard.push(value);
		} } },
		workspace: {
			getConfiguration: () => ({ get: (name, fallback) => configuration[name] ?? fallback }),
			onDidChangeConfiguration: config.subscribe,
			createFileSystemWatcher(value) {
				if (options.watcherError) {
					throw options.watcherError;
				}
				pattern = value;
				return {
					onDidChange: watcherChange.subscribe,
					onDidCreate: watcherCreate.subscribe,
					onDidDelete: watcherDelete.subscribe,
					dispose() {}
				};
			}
		},
		window: {
			createStatusBarItem: () => status,
			createOutputChannel: name => { outputNames.push(name); return output; },
			onDidChangeWindowState: focus.subscribe,
			onDidEndTerminalShellExecution: terminalEnd.subscribe,
			onDidCloseTerminal: terminalClose.subscribe,
			showErrorMessage: async value => { errors.push(value); },
			showInformationMessage: async value => { information.push(value); },
			showWarningMessage: async () => warningAnswer,
			withProgress: async (_options, callback) => callback(),
			createTerminal(value) {
				const terminal = { options: value, sent: [], show() {}, dispose() {},
					sendText(text) { this.sent.push(text); } };
				terminals.push(terminal);
				return terminal;
			},
			createQuickPick() {
				const accept = event();
				const hide = event();
				let items = [];
				const menu = {
					busy: false, disposed: false, selectedItems: [],
					onDidAccept: accept.subscribe, onDidHide: hide.subscribe,
					accept: () => accept.fire(),
					show() {}, hide: () => hide.fire(),
					dispose() { menu.disposed = true; },
					get items() { return items; },
					set items(value) {
						assert.equal(menu.disposed, false, 'Cannot update a disposed menu');
						items = value;
					}
				};
				menus.push(menu);
				return menu;
			}
		}
	};
	const exports = {};
	const sandbox = {
		exports,
		require: name => name === 'vscode' ? api : name === './azureCli' ?
			{
				...realCli, AzureCli: FakeCli,
				resolveAzureExecutable: async () => options.executable ||
					(process.platform === 'win32' ? 'C:\\Azure\\az.exe' : '/usr/bin/az')
			} : require(name),
		console, setTimeout: callback => { const key = {}; timers.set(key, callback); return key; },
		clearTimeout: key => timers.delete(key)
	};
	vm.runInNewContext(source, sandbox, { filename: 'extension.js' });
	const subscriptions = [];
	exports.activate({ subscriptions });
	t.after(() => exports.deactivate());
	return {
		status, commands, calls, errors, information, logs, outputNames, clipboard, menus, terminals,
		configuration, focus, config, terminalEnd, terminalClose, watcherChange, watcherCreate, watcherDelete,
		dispose: exports.deactivate,
		command: name => commands.get(`azure-cli-context.${name}`)(),
		flushTimers() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
		get pattern() { return pattern; },
		get cliDisposed() { return cliDisposed; },
		get timerCount() { return timers.size; },
		set warningAnswer(value) { warningAnswer = value; }
	};
}

test('renders verified account details and registers all seven commands', async t => {
	const h = setup(t);
	await tick();
	assert.equal(h.commands.size, 7);
	assert.match(h.status.text, /Current/);
	assert.match(h.status.tooltip, /user@example.test/);
	assert.match(h.status.tooltip, new RegExp(id));
});

test('uses CLI Context branding while retaining the Azure glyph and existing command IDs', async t => {
	const h = setup(t);
	await tick();
	assert.equal(h.status.name, 'CLI Context: Azure');
	assert.deepEqual(h.outputNames, ['CLI Context: Azure']);
	assert.match(h.status.tooltip, /^CLI Context: Azure\n/);
	assert.match(h.status.text, /^\$\(azure\) /);
	assert.match(h.status.accessibilityInformation.label, /^CLI Context: Azure\./);
	assert.deepEqual([...h.commands.keys()].sort(), [
		'copySubscriptionId', 'copyTenantId', 'login', 'logout', 'refresh',
		'showAccountMenu', 'switchSubscription'
	].map(name => `azure-cli-context.${name}`).sort());
	await h.command('showAccountMenu');
	assert.equal(h.menus[0].title, 'CLI Context: Azure');
	await h.command('login');
	assert.equal(h.terminals[0].options.name, 'CLI Context: Azure Login');
});

test('distinguishes a missing CLI from a signed-out account and reports manual failures', async t => {
	const failure = new realCli.AzureCliError('missing', 'Azure CLI was not found on PATH.');
	const h = setup(t, { reads: [failure, failure] });
	await tick();
	assert.match(h.status.text, /Azure CLI Error/);
	assert.doesNotMatch(h.status.text, /Not logged in/);
	await h.command('refresh');
	assert.equal(h.errors.length, 1);
	assert.match(h.logs[0], /missing/);
	const signedOut = setup(t, { reads: [null] });
	await tick();
	assert.match(signedOut.status.text, /Not logged in/);
	assert.equal(signedOut.errors.length, 0);
});

test('an older refresh cannot overwrite a newer subscription', async t => {
	const old = deferred();
	const h = setup(t, { reads: [old.promise, account('New')] });
	await h.command('refresh');
	old.resolve(account('Old'));
	await tick();
	assert.match(h.status.text, /New/);
	assert.doesNotMatch(h.status.text, /Old/);
});

test('an older refresh failure cannot replace newer success', async t => {
	const old = deferred();
	const h = setup(t, { reads: [old.promise, account('New')] });
	await h.command('refresh');
	old.reject(new realCli.AzureCliError('timeout', 'Timed out'));
	await tick();
	assert.match(h.status.text, /New/);
	assert.equal(h.errors.length, 0);
});

test('configuration changes do not turn CLI failures into signed-out state', async t => {
	const h = setup(t, { reads: [new realCli.AzureCliError('missing', 'Missing CLI')] });
	await tick();
	h.config.fire({ affectsConfiguration: () => true });
	assert.match(h.status.text, /Azure CLI Error/);
});

test('visibility settings hide selected details without changing copied values or leaking notifications', async t => {
	const h = setup(t, { configuration: {
		showUser: false, showSubscriptionName: false, showSubscriptionId: false, showTenantId: false
	} });
	await tick();
	assert.equal(h.status.text, '$(azure) Azure');
	assert.doesNotMatch(h.status.tooltip, /Current|user@example.test|11111111|22222222/);
	await h.command('showAccountMenu');
	assert.doesNotMatch(JSON.stringify(h.menus[0].items.map(({ account, ...item }) => item)),
		/Current"|Other|user@example.test|11111111|22222222|33333333/);
	await h.command('copySubscriptionId');
	await h.command('copyTenantId');
	assert.deepEqual(h.clipboard, [id, account().tenantId]);
	assert.doesNotMatch(h.information.join('\n'), /11111111|22222222/);
});

test('privacy changes immediately dismiss already-open detail menus', async t => {
	const h = setup(t);
	await tick();
	await h.command('showAccountMenu');
	h.configuration.showUser = false;
	h.config.fire({ affectsConfiguration: () => true });
	assert.equal(h.menus[0].disposed, true);
	assert.doesNotMatch(h.status.tooltip, /user@example.test/);
});

test('all watcher events share a disposable debounce and only account files are watched', async t => {
	const h = setup(t);
	await tick();
	assert.equal(h.pattern.pattern, '{azureProfile.json,config}');
	assert.equal(h.pattern.base, realCli.getAzureConfigPath());
	h.watcherChange.fire();
	h.watcherCreate.fire();
	h.watcherDelete.fire();
	assert.equal(h.timerCount, 1);
	const before = h.calls.length;
	h.flushTimers();
	await tick();
	assert.equal(h.calls.length, before + 1);
	h.watcherChange.fire();
	h.dispose();
	assert.equal(h.timerCount, 0);
	assert.equal(h.focus.size, 0);
	assert.equal(h.cliDisposed, true);
});

test('window focus refreshes context but losing focus does not', async t => {
	const h = setup(t);
	await tick();
	h.focus.fire({ focused: false });
	assert.equal(h.calls.length, 1);
	h.focus.fire({ focused: true });
	await tick();
	assert.equal(h.calls.length, 2);
});

test('a menu dismissed while loading is not updated after disposal', async t => {
	const pending = deferred();
	const h = setup(t, { lists: [pending.promise] });
	await tick();
	const opening = h.command('showAccountMenu');
	h.menus[0].hide();
	pending.resolve([]);
	await opening;
	assert.equal(h.menus[0].disposed, true);
	assert.equal(h.errors.length, 0);
});

test('a failed account list is surfaced explicitly while retaining recovery actions', async t => {
	const h = setup(t, { lists: [new realCli.AzureCliError('failed', 'Account list failed.')] });
	await tick();
	await h.command('showAccountMenu');
	assert.match(h.menus[0].placeholder, /Unable to load/);
	assert.ok(h.menus[0].items.some(item => item.action === 'login'));
	assert.equal(h.errors.length, 1);
});

test('switches by account ID even when an old isDefault flag is stale, then verifies the result', async t => {
	const h = setup(t);
	await tick();
	await h.command('switchSubscription');
	const menu = h.menus[0];
	const selected = menu.items.find(item => item.account?.id === otherId);
	assert.ok(selected, 'A stale isDefault flag must not hide another subscription');
	menu.selectedItems = [selected];
	menu.accept();
	await tick();
	assert.ok(h.calls.some(call => Array.isArray(call) && call[0] === 'set' && call[1] === otherId));
	assert.match(h.status.text, /Other/);
	assert.ok(h.information.includes('Azure CLI subscription switched.'));
});

test('does not announce successful switching if the CLI retains the wrong context', async t => {
	const h = setup(t, { reads: [account(), account()] });
	await tick();
	await h.command('switchSubscription');
	const menu = h.menus[0];
	menu.selectedItems = [menu.items.find(item => item.account?.id === otherId)];
	menu.accept();
	await tick();
	assert.equal(h.information.includes('Azure CLI subscription switched.'), false);
	assert.match(h.errors[0], /did not confirm/);
});

test('failed switching is reported and never announced as a success', async t => {
	const h = setup(t, { setError: new realCli.AzureCliError('failed', 'Switch failed.') });
	await tick();
	await h.command('switchSubscription');
	const menu = h.menus[0];
	menu.selectedItems = [menu.items.find(item => item.account?.id === otherId)];
	menu.accept();
	await tick();
	assert.match(h.errors[0], /Switch failed/);
	assert.equal(h.information.includes('Azure CLI subscription switched.'), false);
});

test('account mutations remain serialized until the new context is verified', async t => {
	const confirmation = deferred();
	const h = setup(t, { reads: [account(), confirmation.promise], warningAnswer: 'Sign Out' });
	await tick();
	await h.command('switchSubscription');
	const menu = h.menus[0];
	menu.selectedItems = [menu.items.find(item => item.account?.id === otherId)];
	menu.accept();
	await tick();
	const before = h.calls.length;
	h.focus.fire({ focused: true });
	assert.equal(h.calls.length, before);
	await h.command('logout');
	assert.equal(h.calls.includes('logout'), false);
	assert.match(h.errors[0], /Another Azure account change/);
	confirmation.resolve(account('Other', otherId));
	await tick();
	assert.ok(h.information.includes('Azure CLI subscription switched.'));
});

test('does not switch disabled subscriptions', async t => {
	const disabled = { ...account('Disabled', otherId), state: 'Disabled' };
	const h = setup(t, { lists: [[disabled]] });
	await tick();
	await h.command('switchSubscription');
	const menu = h.menus[0];
	menu.selectedItems = [menu.items.find(item => item.account?.id === otherId)];
	menu.accept();
	await tick();
	assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'set'), false);
	assert.match(h.errors[0], /not enabled/);
});

test('logout requires explicit confirmation and refreshes to signed-out state', async t => {
	const h = setup(t);
	await tick();
	await h.command('logout');
	assert.equal(h.calls.includes('logout'), false);
	h.warningAnswer = 'Sign Out';
	await h.command('logout');
	assert.equal(h.calls.includes('logout'), true);
	assert.match(h.status.text, /Not logged in/);
	assert.ok(h.information.includes('Signed out of Azure CLI.'));
});

test('login runs the trusted CLI as the terminal process and refreshes when it completes', async t => {
	const h = setup(t);
	await tick();
	await h.command('login');
	assert.equal(h.terminals.length, 1);
	assert.equal(h.timerCount, 0);
	assert.deepEqual(Array.from(h.terminals[0].options.shellArgs), ['login', '--output', 'none', '--only-show-errors']);
	assert.match(h.terminals[0].options.shellPath, /az(?:\.exe)?$/);
	assert.equal(h.terminals[0].options.isTransient, true);
	assert.deepEqual(h.terminals[0].sent, []);
	await h.command('login');
	assert.equal(h.terminals.length, 1);
	const before = h.calls.length;
	h.terminals[0].exitStatus = { code: 0 };
	h.terminalClose.fire(h.terminals[0]);
	await tick();
	assert.equal(h.calls.length, before + 1);
});

test('login terminal cancellation refreshes context without requiring shell integration', async t => {
	const h = setup(t);
	await tick();
	await h.command('login');
	const before = h.calls.length;
	h.terminalClose.fire(h.terminals[0]);
	await tick();
	assert.equal(h.calls.length, before + 1);
});

test('Windows login uses the same safely quoted batch launcher as background commands', {
	skip: process.platform !== 'win32'
}, async t => {
	const executable = 'C:\\Program Files (x86)\\Azure CLI\\az.cmd';
	const h = setup(t, { executable });
	await tick();
	await h.command('login');
	const terminal = h.terminals[0];
	assert.match(terminal.options.shellPath, /cmd\.exe$/i);
	assert.equal(terminal.options.shellArgs,
		`/d /v:off /s /c ""${executable}" login --output none --only-show-errors"`);
});

test('login failures are surfaced, and logout cannot overlap an active login', async t => {
	const h = setup(t, { warningAnswer: 'Sign Out' });
	await tick();
	await h.command('login');
	await h.command('logout');
	assert.equal(h.calls.includes('logout'), false);
	assert.match(h.errors[0], /Another Azure account change/);
	h.terminals[0].exitStatus = { code: 1 };
	h.terminalClose.fire(h.terminals[0]);
	await tick();
	assert.ok(h.errors.some(message => /sign-in failed/.test(message)));
	await h.command('logout');
	assert.equal(h.calls.includes('logout'), true);
});

test('clipboard failures and attempts without a verified account are surfaced', async t => {
	const h = setup(t, { clipboardError: new Error('Clipboard unavailable') });
	await tick();
	await h.command('copySubscriptionId');
	assert.equal(h.errors.length, 1);
	assert.equal(h.information.length, 0);
	const signedOut = setup(t, { reads: [null] });
	await tick();
	await signedOut.command('copyTenantId');
	assert.match(signedOut.errors[0], /No verified account/);
});

test('deactivation prevents pending work from updating disposed UI', async t => {
	const pending = deferred();
	const h = setup(t, { reads: [pending.promise] });
	h.dispose();
	const before = h.status.text;
	pending.resolve(account('Late'));
	await tick();
	assert.equal(h.status.text, before);
	assert.equal(h.commands.size, 0);
});
