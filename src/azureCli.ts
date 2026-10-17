import { spawn, execFile } from 'node:child_process';
import { access, constants } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export interface AzureAccount {
	id: string;
	name: string;
	user: { name: string; type: string };
	tenantId: string;
	isDefault: boolean;
	state: string;
}

type ErrorKind = 'missing' | 'signedOut' | 'timeout' | 'cancelled' | 'invalidData' | 'failed';

export class AzureCliError extends Error {
	constructor(public readonly kind: ErrorKind, message: string) {
		super(message);
		this.name = 'AzureCliError';
	}
}

export function isGuid(value: unknown): value is string {
	return typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

export function parseAccount(value: unknown): AzureAccount {
	if (!isRecord(value) || !isGuid(value.id) || !isGuid(value.tenantId) ||
		!isText(value.name) || !isText(value.state) || typeof value.isDefault !== 'boolean' ||
		!isRecord(value.user) || !isText(value.user.name) || !isText(value.user.type)) {
		throw new AzureCliError('invalidData', 'Azure CLI returned an invalid account. Update Azure CLI and retry.');
	}
	return {
		id: value.id,
		name: value.name,
		user: { name: value.user.name, type: value.user.type },
		tenantId: value.tenantId,
		isDefault: value.isDefault,
		state: value.state
	};
}

function parseJson(output: string): unknown {
	try {
		return JSON.parse(output);
	} catch {
		throw new AzureCliError('invalidData', 'Azure CLI returned invalid JSON. Update Azure CLI and retry.');
	}
}

export function getAzureConfigPath(env: NodeJS.ProcessEnv = process.env): string {
	return path.resolve(os.homedir(), env.AZURE_CONFIG_DIR || '.azure');
}

export async function resolveAzureExecutable(): Promise<string> {
	const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path');
	const directories = (process.env[pathKey || 'PATH'] || '').split(path.delimiter);
	const names = process.platform === 'win32' ? ['az.exe', 'az.cmd', 'az.bat'] : ['az'];
	for (const directory of directories) {
		const absoluteDirectory = directory.replace(/^"(.*)"$/, '$1');
		// Never search the workspace or a relative PATH entry for executable code.
		if (!path.isAbsolute(absoluteDirectory)) {
			continue;
		}
		for (const name of names) {
			const executable = path.join(absoluteDirectory, name);
			try {
				await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
				return executable;
			} catch (error) {
				if (!(error instanceof Error) || !('code' in error) ||
					!['ENOENT', 'ENOTDIR', 'EACCES'].includes(String(error.code))) {
					throw error;
				}
			}
		}
	}
	throw new AzureCliError('missing', 'Azure CLI was not found on PATH. Install it, then restart VS Code.');
}

export interface ProcessInvocation {
	file: string;
	args: string[];
	windowsVerbatimArguments?: boolean;
}

export function createInvocation(
	executable: string,
	args: readonly string[],
	platform: NodeJS.Platform = process.platform
): ProcessInvocation {
	if (args.some(arg => !/^[a-zA-Z0-9-]+$/.test(arg))) {
		throw new AzureCliError('invalidData', 'An unsafe Azure CLI argument was rejected.');
	}
	if (platform === 'win32' && /\.(cmd|bat)$/i.test(executable)) {
		if (/["%\r\n]/.test(executable)) {
			throw new AzureCliError('invalidData', 'The Azure CLI installation path cannot be safely executed.');
		}
		// Windows cannot execute .cmd files directly. Only fixed tokens and validated GUIDs reach cmd.exe.
		return {
			file: path.win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe'),
			args: ['/d', '/v:off', '/s', '/c', `""${executable}" ${args.join(' ')}"`],
			windowsVerbatimArguments: true
		};
	}
	return { file: executable, args: [...args] };
}

export function runProcess(
	invocation: ProcessInvocation,
	signal: AbortSignal,
	timeoutMs = 15_000
): Promise<string> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new AzureCliError('cancelled', 'Azure CLI operation was cancelled.'));
			return;
		}
		const child = spawn(invocation.file, invocation.args, {
			cwd: os.homedir(),
			env: { ...process.env, AZURE_CONFIG_DIR: getAzureConfigPath(), AZURE_CORE_NO_COLOR: 'true' },
			shell: false,
			windowsHide: true,
			windowsVerbatimArguments: invocation.windowsVerbatimArguments,
			detached: process.platform !== 'win32',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		const stdout: Buffer[] = [];
		const stderr: Buffer[] = [];
		let bytes = 0;
		let settled = false;
		let termination: AzureCliError | undefined;
		const finish = (error?: AzureCliError) => {
			if (settled) {
				return;
			}
			settled = true;
			clearTimeout(timer);
			signal.removeEventListener('abort', abort);
			if (error) {
				reject(error);
			} else {
				resolve(Buffer.concat(stdout).toString('utf8'));
			}
		};
		const terminate = (error: AzureCliError) => {
			if (termination || settled) {
				return;
			}
			termination = error;
			if (!child.pid) {
				finish(error);
				return;
			}
			if (process.platform === 'win32') {
				execFile(
					path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
					['/PID', String(child.pid), '/T', '/F'],
					{ windowsHide: true, timeout: 5_000 },
					killError => {
						if (killError && !settled) {
							child.kill();
							finish(new AzureCliError('failed', 'Azure CLI could not be stopped cleanly. Check running CLI processes.'));
						}
					}
				);
			} else {
				try {
					process.kill(-child.pid, 'SIGKILL');
				} catch (killError) {
					if (isRecord(killError) && killError.code === 'ESRCH') {
						finish(error);
					} else {
						finish(new AzureCliError('failed', 'Azure CLI could not be stopped cleanly. Check running CLI processes.'));
					}
				}
			}
		};
		const abort = () => terminate(new AzureCliError('cancelled', 'Azure CLI operation was cancelled.'));
		const timer = setTimeout(() => terminate(
			new AzureCliError('timeout', 'Azure CLI timed out. Check that it works in a terminal, then retry.')
		), timeoutMs);
		signal.addEventListener('abort', abort, { once: true });
		if (signal.aborted) {
			abort();
		}
		const collect = (buffers: Buffer[]) => (chunk: Buffer) => {
			bytes += chunk.length;
			if (bytes > 4 * 1024 * 1024) {
				terminate(new AzureCliError('failed', 'Azure CLI output exceeded the safe size limit.'));
			} else {
				buffers.push(chunk);
			}
		};
		child.stdout.on('data', collect(stdout));
		child.stderr.on('data', collect(stderr));
		child.on('error', error => {
			const missing = 'code' in error && error.code === 'ENOENT';
			finish(termination || new AzureCliError(
				missing ? 'missing' : 'failed',
				missing ? 'Azure CLI could not be started. Check PATH and restart VS Code.' :
					'Azure CLI could not be started. Check the installation and permissions.'
			));
		});
		child.on('close', code => {
			if (termination) {
				finish(termination);
			} else if (code === 0) {
				finish();
			} else {
				const signedOut = /please run ['"]?az login['"]? to (?:setup|set up) account/i.test(
					Buffer.concat(stderr).toString('utf8')
				);
				finish(new AzureCliError(
					signedOut ? 'signedOut' : 'failed',
					signedOut ? 'Sign in to Azure CLI to select a subscription.' :
						`Azure CLI failed (exit ${code ?? 'unknown'}). Run the command in a terminal for details.`
				));
			}
		});
	});
}

type Executor = (args: readonly string[], signal: AbortSignal) => Promise<string>;

async function execute(args: readonly string[], signal: AbortSignal): Promise<string> {
	const executable = await resolveAzureExecutable();
	return runProcess(createInvocation(executable, args), signal);
}

export class AzureCli {
	private readonly operations = new Set<AbortController>();
	private disposed = false;

	constructor(private readonly executor: Executor = execute) {}

	private async run(args: readonly string[]): Promise<string> {
		if (this.disposed) {
			throw new AzureCliError('cancelled', 'Azure CLI operation was cancelled.');
		}
		const controller = new AbortController();
		this.operations.add(controller);
		try {
			return await this.executor(args, controller.signal);
		} finally {
			this.operations.delete(controller);
		}
	}

	async getCurrentAccount(): Promise<AzureAccount | null> {
		try {
			return parseAccount(parseJson(await this.run(['account', 'show', '--output', 'json', '--only-show-errors'])));
		} catch (error) {
			if (error instanceof AzureCliError && error.kind === 'signedOut') {
				return null;
			}
			throw error;
		}
	}

	async getAllAccounts(): Promise<AzureAccount[]> {
		const value = parseJson(await this.run(['account', 'list', '--output', 'json', '--only-show-errors']));
		if (!Array.isArray(value)) {
			throw new AzureCliError('invalidData', 'Azure CLI did not return a subscription list.');
		}
		return value.map(parseAccount);
	}

	async setSubscription(id: string): Promise<void> {
		if (!isGuid(id)) {
			throw new AzureCliError('invalidData', 'An invalid subscription ID was rejected.');
		}
		await this.run(['account', 'set', '--subscription', id, '--only-show-errors']);
	}

	async logout(): Promise<void> {
		await this.run(['logout', '--only-show-errors']);
	}

	dispose(): void {
		this.disposed = true;
		for (const controller of this.operations) {
			controller.abort();
		}
		this.operations.clear();
	}
}
