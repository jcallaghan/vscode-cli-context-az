const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
	AzureCli, AzureCliError, parseAccount, isGuid, createInvocation,
	getAzureConfigPath, resolveAzureExecutable, runProcess
} = require('../out/azureCli.js');

const id = '11111111-1111-1111-1111-111111111111';
const tenantId = '22222222-2222-2222-2222-222222222222';
const account = () => ({
	id, tenantId, name: 'Test subscription', user: { name: 'user@example.test', type: 'user' },
	isDefault: true, state: 'Enabled'
});
const errorKind = kind => error => error instanceof AzureCliError && error.kind === kind;

test('validates and copies account data without retaining unneeded fields', () => {
	const input = { ...account(), accessToken: 'not-a-real-token' };
	assert.deepEqual(parseAccount(input), account());
	assert.notEqual(parseAccount(input).user, input.user);
	assert.equal('accessToken' in parseAccount(input), false);
});

test('rejects malformed account data, including shell input in IDs', () => {
	for (const invalid of [
		null, [], {}, { ...account(), id: `${id}" & echo unsafe` },
		{ ...account(), tenantId: 'tenant' }, { ...account(), name: '' },
		{ ...account(), user: null }, { ...account(), user: { name: 'user', type: 42 } },
		{ ...account(), isDefault: 'true' }, { ...account(), state: null }
	]) {
		assert.throws(() => parseAccount(invalid), errorKind('invalidData'));
	}
	assert.equal(isGuid(id), true);
	assert.equal(isGuid(`${id}\n`), false);
});

test('uses the custom Azure configuration directory and defaults to the home directory', () => {
	const custom = path.join(os.tmpdir(), 'azure-context-test');
	assert.equal(getAzureConfigPath({ AZURE_CONFIG_DIR: custom }), custom);
	assert.equal(getAzureConfigPath({}), path.join(os.homedir(), '.azure'));
	assert.equal(getAzureConfigPath({ AZURE_CONFIG_DIR: 'relative-config' }), path.join(os.homedir(), 'relative-config'));
});

test('uses direct executable arguments on Unix and for native Windows executables', () => {
	assert.deepEqual(createInvocation('/usr/bin/az', ['account', 'show'], 'linux'), {
		file: '/usr/bin/az', args: ['account', 'show']
	});
	assert.deepEqual(createInvocation('C:\\Azure\\az.exe', ['logout'], 'win32'), {
		file: 'C:\\Azure\\az.exe', args: ['logout']
	});
});

test('quotes a Windows batch launcher and disables startup commands and delayed expansion', () => {
	const invocation = createInvocation('C:\\Program Files (x86)\\Azure CLI\\az.cmd', [
		'account', 'set', '--subscription', id
	], 'win32');
	assert.equal(invocation.windowsVerbatimArguments, true);
	assert.deepEqual(invocation.args.slice(0, 4), ['/d', '/v:off', '/s', '/c']);
	assert.equal(invocation.args[4],
		`""C:\\Program Files (x86)\\Azure CLI\\az.cmd" account set --subscription ${id}"`);
});

test('rejects shell metacharacters before process creation', () => {
	for (const arg of ['a&b', 'x|y', '"quoted"', '%PATH%', '!VAR!', 'x y', 'x\ny', 'x>file', 'x;y']) {
		assert.throws(() => createInvocation('az', [arg]), errorKind('invalidData'));
	}
	for (const executable of ['C:\\%UNSAFE%\\az.cmd', 'C:\\unsafe"\n\\az.cmd']) {
		assert.throws(() => createInvocation(executable, ['logout'], 'win32'), errorKind('invalidData'));
	}
});

test('only recognized signed-out errors become a null account', async () => {
	const cli = new AzureCli(async () => { throw new AzureCliError('signedOut', 'Sign in'); });
	assert.equal(await cli.getCurrentAccount(), null);
	for (const kind of ['missing', 'failed', 'timeout', 'invalidData']) {
		const broken = new AzureCli(async () => { throw new AzureCliError(kind, 'Failure'); });
		await assert.rejects(broken.getCurrentAccount(), errorKind(kind));
	}
});

test('rejects invalid JSON and non-array subscription lists', async () => {
	await assert.rejects(new AzureCli(async () => '{').getCurrentAccount(), errorKind('invalidData'));
	await assert.rejects(new AzureCli(async () => '{}').getAllAccounts(), errorKind('invalidData'));
	await assert.rejects(new AzureCli(async () => '[{}]').getAllAccounts(), errorKind('invalidData'));
	assert.deepEqual(await new AzureCli(async () => '[]').getAllAccounts(), []);
	assert.deepEqual(await new AzureCli(async () => JSON.stringify([account()])).getAllAccounts(), [account()]);
});

test('emits fixed command arguments and rejects invalid subscription IDs before execution', async () => {
	const calls = [];
	const cli = new AzureCli(async args => {
		calls.push(args);
		return args[1] === 'show' ? JSON.stringify(account()) : '';
	});
	assert.deepEqual(await cli.getCurrentAccount(), account());
	await cli.setSubscription(id);
	await cli.logout();
	assert.deepEqual(calls, [
		['account', 'show', '--output', 'json', '--only-show-errors'],
		['account', 'set', '--subscription', id, '--only-show-errors'],
		['logout', '--only-show-errors']
	]);
	await assert.rejects(cli.setSubscription(`${id}" & echo unsafe`), errorKind('invalidData'));
	assert.equal(calls.length, 3);
});

test('disposal cancels active work and prevents new operations', async () => {
	let operationSignal;
	const cli = new AzureCli(async (_args, signal) => {
		operationSignal = signal;
		return new Promise((_resolve, reject) => signal.addEventListener('abort',
			() => reject(new AzureCliError('cancelled', 'Cancelled')), { once: true }));
	});
	const pending = cli.getCurrentAccount();
	cli.dispose();
	assert.equal(operationSignal.aborted, true);
	await assert.rejects(pending, errorKind('cancelled'));
	await assert.rejects(cli.logout(), errorKind('cancelled'));
});

test('captures stdout and does not expose raw stderr in errors', async () => {
	const controller = new AbortController();
	const result = await runProcess({
		file: process.execPath, args: ['-e', 'process.stdout.write("ok")']
	}, controller.signal);
	assert.equal(result, 'ok');
	await assert.rejects(runProcess({
		file: process.execPath,
		args: ['-e', 'process.stderr.write("sensitive-placeholder"); process.exit(7)']
	}, controller.signal), error => {
		assert.equal(error.kind, 'failed');
		assert.match(error.message, /exit 7/);
		assert.doesNotMatch(error.message, /sensitive-placeholder/);
		return true;
	});
});

test('recognizes the Azure CLI signed-out diagnostic without swallowing other errors', async () => {
	await assert.rejects(runProcess({
		file: process.execPath,
		args: ['-e', `process.stderr.write("Please run 'az login' to setup account."); process.exit(1)`]
	}, new AbortController().signal), errorKind('signedOut'));
});

test('reports missing executables distinctly', async () => {
	await assert.rejects(runProcess({
		file: path.join(os.tmpdir(), 'nonexistent-azure-context-executable'), args: []
	}, new AbortController().signal), errorKind('missing'));
});

test('terminates a timed-out process', async () => {
	await assert.rejects(runProcess({
		file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)']
	}, new AbortController().signal, 150), errorKind('timeout'));
});

test('terminates an explicitly cancelled process', async () => {
	const controller = new AbortController();
	const pending = runProcess({
		file: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)']
	}, controller.signal);
	setTimeout(() => controller.abort(), 150);
	await assert.rejects(pending, errorKind('cancelled'));
});

test('does not start a process with an already-cancelled signal', async () => {
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(runProcess({ file: process.execPath, args: [] }, controller.signal), errorKind('cancelled'));
});

test('enforces the output size limit', async () => {
	await assert.rejects(runProcess({
		file: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(5 * 1024 * 1024)); setInterval(() => {}, 1000)']
	}, new AbortController().signal), error => error.kind === 'failed' && /size limit/.test(error.message));
});

test('accepts exactly 4 MiB and enforces the combined stdout/stderr threshold', async () => {
	const result = await runProcess({
		file: process.execPath, args: ['-e', 'process.stdout.write("x".repeat(4 * 1024 * 1024))']
	}, new AbortController().signal);
	assert.equal(Buffer.byteLength(result), 4 * 1024 * 1024);
	await assert.rejects(runProcess({
		file: process.execPath,
		args: ['-e', 'process.stdout.write("x".repeat(3 * 1024 * 1024)); process.stderr.write("y".repeat(2 * 1024 * 1024)); setInterval(() => {}, 1000)']
	}, new AbortController().signal), error => error.kind === 'failed' && /size limit/.test(error.message));
});

test('resolves only absolute PATH entries, not the current directory', async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'context-path-'));
	const name = process.platform === 'win32' ? 'az.cmd' : 'az';
	await fs.writeFile(path.join(directory, name), '', { mode: 0o755 });
	const key = Object.keys(process.env).find(name => name.toLowerCase() === 'path') || 'PATH';
	const original = process.env[key];
	t.after(async () => {
		if (original === undefined) {
			delete process.env[key];
		} else {
			process.env[key] = original;
		}
		await fs.rm(directory, { recursive: true, force: true });
	});
	process.env[key] = `.${path.delimiter}${directory}`;
	assert.equal(await resolveAzureExecutable(), path.join(directory, name));
	process.env[key] = '.';
	await assert.rejects(resolveAzureExecutable(), errorKind('missing'));
});

test('executes a Windows .cmd installation under a path with spaces and parentheses', {
	skip: process.platform !== 'win32'
}, async t => {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cli context (fixture)-'));
	t.after(() => fs.rm(directory, { recursive: true, force: true }));
	const script = path.join(directory, 'fixture.cjs');
	const wrapper = path.join(directory, 'az.cmd');
	await fs.writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));');
	await fs.writeFile(wrapper, `@"${process.execPath}" "${script}" %*\r\n`);
	const result = await runProcess(createInvocation(wrapper, [
		'account', 'set', '--subscription', id
	]), new AbortController().signal);
	assert.deepEqual(JSON.parse(result), ['account', 'set', '--subscription', id]);
});
