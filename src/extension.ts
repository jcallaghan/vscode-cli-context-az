import * as vscode from 'vscode';
import * as os from 'node:os';
import {
	AzureAccount, AzureCli, AzureCliError, createInvocation, getAzureConfigPath, resolveAzureExecutable
} from './azureCli';

type Action = 'refresh' | 'login' | 'logout' | 'copySubscriptionId' | 'copyTenantId' | 'copyUser';

interface AccountItem extends vscode.QuickPickItem {
	account?: AzureAccount;
	action?: Action;
}

const displayName = 'CLI Context: Azure';
let extension: AzureContext | undefined;

class AzureContext implements vscode.Disposable {
	private readonly cli = new AzureCli();
	private readonly output = vscode.window.createOutputChannel(displayName);
	private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	private readonly subscriptions: vscode.Disposable[] = [this.output, this.status];
	private currentAccount: AzureAccount | null = null;
	private viewState: 'loading' | 'ready' | 'error' = 'loading';
	private refreshVersion = 0;
	private disposed = false;
	private changingAccount = false;
	private refreshTimer: ReturnType<typeof setTimeout> | undefined;
	private menu: vscode.QuickPick<AccountItem> | undefined;
	private loginTerminal: vscode.Terminal | undefined;
	private startingLogin = false;

	constructor() {
		this.status.name = displayName;
		this.status.command = 'azure-cli-context.showAccountMenu';
		const actions: Record<string, () => Promise<unknown>> = {
			showAccountMenu: () => this.showAccountMenu(),
			refresh: () => this.refresh(true),
			login: () => this.login(),
			logout: () => this.logout(),
			switchSubscription: () => this.showAccountMenu(),
			copySubscriptionId: () => this.copy('id'),
			copyTenantId: () => this.copy('tenantId')
		};
		for (const [name, action] of Object.entries(actions)) {
			this.subscriptions.push(vscode.commands.registerCommand(
				`azure-cli-context.${name}`, () => this.run(action)
			));
		}
		this.subscriptions.push(
			vscode.window.onDidChangeWindowState(state => {
				if (state.focused) {
					void this.refresh();
				}
			}),
			vscode.workspace.onDidChangeConfiguration(event => {
				if (event.affectsConfiguration('azure-cli-context')) {
					this.menu?.hide();
					this.render();
				}
			}),
			vscode.window.onDidCloseTerminal(terminal => {
				if (terminal === this.loginTerminal) {
					this.loginTerminal = undefined;
					if (terminal.exitStatus?.code !== undefined && terminal.exitStatus.code !== 0) {
						this.report(new AzureCliError(
							'failed', 'Azure CLI sign-in failed. Run az login in a terminal for details.'
						), true);
					}
					void this.refresh();
				}
			})
		);
		this.setupWatcher();
		void this.refresh();
	}

	private visible(key: string): boolean {
		return vscode.workspace.getConfiguration('azure-cli-context').get<boolean>(key, true);
	}

	private report(error: unknown, notify: boolean): void {
		if (this.disposed) {
			return;
		}
		const message = error instanceof AzureCliError ? error.message :
			'An unexpected error occurred. Retry, or report the steps to reproduce this problem.';
		const kind = error instanceof AzureCliError ? error.kind : 'unexpected';
		// Never log raw CLI output, command arguments, account identifiers or credentials.
		this.output.appendLine(`[${kind}] ${message}`);
		if (notify && kind !== 'cancelled') {
			void vscode.window.showErrorMessage(`${displayName}: ${message}`);
		}
	}

	private async run(action: () => Promise<unknown>): Promise<void> {
		try {
			await action();
		} catch (error) {
			this.report(error, true);
		}
	}

	private setupWatcher(): void {
		try {
			const watcher = vscode.workspace.createFileSystemWatcher(
				new vscode.RelativePattern(getAzureConfigPath(), '{azureProfile.json,config}')
			);
			const schedule = () => {
				clearTimeout(this.refreshTimer);
				this.refreshTimer = setTimeout(() => {
					this.refreshTimer = undefined;
					void this.refresh();
				}, 500);
			};
			this.subscriptions.push(
				watcher, watcher.onDidChange(schedule), watcher.onDidCreate(schedule), watcher.onDidDelete(schedule)
			);
		} catch (error) {
			this.report(error, false);
			void vscode.window.showWarningMessage(
				`${displayName}: automatic file refresh is unavailable. Use Refresh Azure Account or refocus the window.`
			);
		}
	}

	private async refresh(notify = false, duringAccountChange = false): Promise<boolean> {
		if (this.disposed) {
			return false;
		}
		if (this.changingAccount && !duringAccountChange) {
			if (notify) {
				void vscode.window.showInformationMessage('An Azure account change is in progress. Context refreshes when it finishes.');
			}
			return false;
		}
		const version = ++this.refreshVersion;
		this.viewState = 'loading';
		this.status.backgroundColor = undefined;
		this.status.text = '$(sync~spin) Azure...';
		this.status.tooltip = 'Refreshing Azure CLI context';
		this.status.show();
		try {
			const account = await this.cli.getCurrentAccount();
			if (this.disposed || version !== this.refreshVersion) {
				return false;
			}
			this.currentAccount = account;
			this.viewState = 'ready';
			this.render();
			return true;
		} catch (error) {
			if (!this.disposed && version === this.refreshVersion) {
				this.currentAccount = null;
				this.viewState = 'error';
				this.status.text = '$(warning) Azure CLI Error';
				this.status.tooltip = error instanceof AzureCliError ? error.message :
					'Unable to read Azure CLI context. Use Refresh Azure Account to retry.';
				this.status.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
				this.report(error, notify);
			}
			return false;
		}
	}

	private render(): void {
		if (this.disposed || this.viewState !== 'ready') {
			return;
		}
		this.status.backgroundColor = undefined;
		if (!this.currentAccount) {
			this.status.text = '$(azure) Not logged in';
			this.status.tooltip = 'Sign in to Azure CLI to select a subscription. Click for account actions.';
		} else {
			const account = this.currentAccount;
			const name = this.visible('showSubscriptionName') ? account.name : 'Azure';
			this.status.text = `$(azure) ${name.length > 30 ? `${name.slice(0, 27)}...` : name}`;
			const lines = [displayName];
			if (this.visible('showUser')) {
				lines.push(`User: ${account.user.name}`);
			}
			if (this.visible('showSubscriptionName')) {
				lines.push(`Subscription: ${account.name}`);
			}
			if (this.visible('showSubscriptionId')) {
				lines.push(`Subscription ID: ${account.id}`);
			}
			if (this.visible('showTenantId')) {
				lines.push(`Tenant ID: ${account.tenantId}`);
			}
			lines.push('Click to view details or switch subscription');
			this.status.tooltip = lines.join('\n\n');
		}
		const context = this.currentAccount && this.visible('showSubscriptionName') ?
			this.currentAccount.name : this.currentAccount ? 'Signed in' : 'Not logged in';
		this.status.accessibilityInformation = { label: `${displayName}. ${context}. Open account actions.` };
		this.status.show();
	}

	private accountItem(account: AzureAccount, index: number, selected: boolean): AccountItem {
		const details: string[] = [];
		if (this.visible('showSubscriptionId')) {
			details.push(`Subscription ID: ${account.id}`);
		}
		if (this.visible('showTenantId')) {
			details.push(`Tenant ID: ${account.tenantId}`);
		}
		const enabled = account.state.toLowerCase() === 'enabled';
		if (!enabled) {
			details.push(`State: ${account.state} (cannot switch)`);
		}
		return {
			label: `${selected ? '$(check)' : '$(circle-outline)'} ${
				this.visible('showSubscriptionName') ? account.name : `Subscription ${index + 1}`}`,
			description: this.visible('showUser') ? account.user.name : undefined,
			detail: details.length ? details.join(' | ') : undefined,
			account
		};
	}

	private menuItems(accounts: AzureAccount[]): AccountItem[] {
		const items: AccountItem[] = [];
		if (this.currentAccount) {
			items.push({ label: 'Current Account', kind: vscode.QuickPickItemKind.Separator });
			items.push(this.accountItem(this.currentAccount, 0, true));
		}
		const others = accounts.filter(account => account.id !== this.currentAccount?.id);
		if (others.length) {
			items.push({ label: 'Switch Subscription', kind: vscode.QuickPickItemKind.Separator });
			others.forEach((account, index) => items.push(this.accountItem(account, index, false)));
		}
		if (this.currentAccount) {
			items.push(
				{ label: 'Copy to Clipboard', kind: vscode.QuickPickItemKind.Separator },
				{ label: '$(copy) Subscription ID', action: 'copySubscriptionId' },
				{ label: '$(copy) Tenant ID', action: 'copyTenantId' },
				{ label: '$(copy) User', action: 'copyUser' }
			);
		}
		items.push(
			{ label: 'Actions', kind: vscode.QuickPickItemKind.Separator },
			{ label: '$(refresh) Refresh', action: 'refresh' },
			{ label: '$(sign-in) Login', action: 'login' }
		);
		if (this.currentAccount) {
			items.push({ label: '$(sign-out) Logout', action: 'logout' });
		}
		return items;
	}

	private async showAccountMenu(): Promise<void> {
		this.menu?.hide();
		const menu = vscode.window.createQuickPick<AccountItem>();
		this.menu = menu;
		menu.title = displayName;
		menu.placeholder = 'Loading Azure subscriptions...';
		menu.busy = true;
		const accept = menu.onDidAccept(() => {
			const selected = menu.selectedItems[0];
			if (!selected || menu.busy) {
				return;
			}
			menu.hide();
			void this.run(() => this.select(selected));
		});
		const hide = menu.onDidHide(() => {
			if (this.menu === menu) {
				this.menu = undefined;
			}
			accept.dispose();
			hide.dispose();
			menu.dispose();
		});
		menu.show();
		try {
			const accounts = await this.cli.getAllAccounts();
			if (!this.disposed && this.menu === menu) {
				menu.items = this.menuItems(accounts);
				menu.placeholder = accounts.length ? 'Select a subscription or action' :
					'No subscriptions found. Sign in or refresh your Azure CLI accounts.';
				menu.busy = false;
			}
		} catch (error) {
			this.report(error, this.menu === menu);
			if (!this.disposed && this.menu === menu) {
				menu.items = this.menuItems([]);
				menu.placeholder = 'Unable to load subscriptions. Check Azure CLI, then refresh or sign in.';
				menu.busy = false;
			}
		}
	}

	private async select(item: AccountItem): Promise<void> {
		switch (item.action) {
			case 'refresh': await this.refresh(true); return;
			case 'login': await this.login(); return;
			case 'logout': await this.logout(); return;
			case 'copySubscriptionId': await this.copy('id'); return;
			case 'copyTenantId': await this.copy('tenantId'); return;
			case 'copyUser': await this.copy('user'); return;
		}
		if (item.account && item.account.id !== this.currentAccount?.id) {
			const account = item.account;
			if (account.state.toLowerCase() !== 'enabled') {
				throw new AzureCliError('failed', 'This subscription is not enabled and cannot be selected.');
			}
			await this.changeAccount(async () => {
				await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Notification,
						title: 'Switching Azure CLI subscription',
						cancellable: false
					},
					() => this.cli.setSubscription(account.id)
				);
			}, account.id);
		}
	}

	private matchesContext(expectedId?: string): boolean {
		return expectedId ? this.currentAccount?.id === expectedId : this.currentAccount === null;
	}

	private async changeAccount(action: () => Promise<void>, expectedId?: string): Promise<void> {
		if (this.changingAccount || this.loginTerminal || this.startingLogin) {
			throw new AzureCliError('failed', 'Another Azure account change is in progress. Complete it before trying again.');
		}
		this.changingAccount = true;
		++this.refreshVersion;
		this.currentAccount = null;
		this.viewState = 'loading';
		this.status.backgroundColor = undefined;
		this.status.text = '$(sync~spin) Updating Azure...';
		this.status.tooltip = 'Updating Azure CLI account context';
		let succeeded = false;
		try {
			await action();
			succeeded = true;
		} finally {
			try {
				if (!this.disposed) {
					const refreshed = await this.refresh(false, true);
					if (succeeded && (!refreshed || !this.matchesContext(expectedId))) {
						throw new AzureCliError('failed', 'Azure CLI did not confirm the account change. Refresh and verify your context.');
					}
				}
			} finally {
				this.changingAccount = false;
			}
		}
		if (!this.disposed) {
			void vscode.window.showInformationMessage(expectedId ? 'Azure CLI subscription switched.' : 'Signed out of Azure CLI.');
		}
	}

	private async login(): Promise<void> {
		if (this.changingAccount || this.startingLogin) {
			throw new AzureCliError('failed', 'An Azure account change is already in progress.');
		}
		if (this.loginTerminal) {
			this.loginTerminal.show();
			return;
		}
		this.startingLogin = true;
		try {
			const executable = await resolveAzureExecutable();
			if (this.disposed) {
				return;
			}
			const invocation = createInvocation(executable, ['login', '--output', 'none', '--only-show-errors']);
			const terminal = vscode.window.createTerminal({
				name: `${displayName} Login`,
				cwd: os.homedir(),
				shellPath: invocation.file,
				shellArgs: invocation.windowsVerbatimArguments ? invocation.args.join(' ') : invocation.args,
				env: { AZURE_CONFIG_DIR: getAzureConfigPath() },
				isTransient: true
			});
			this.loginTerminal = terminal;
			this.subscriptions.push(terminal);
			terminal.show();
			void vscode.window.showInformationMessage(
				'Complete sign-in in the Azure CLI Login terminal. It closes and refreshes context when the CLI finishes. Close it to cancel.'
			);
		} finally {
			this.startingLogin = false;
		}
	}

	private async logout(): Promise<void> {
		const answer = await vscode.window.showWarningMessage(
			'Sign out of Azure CLI? This affects other tools using the same Azure CLI configuration.',
			{ modal: true }, 'Sign Out'
		);
		if (answer === 'Sign Out' && !this.disposed) {
			await this.changeAccount(() => this.cli.logout());
		}
	}

	private async copy(field: 'id' | 'tenantId' | 'user'): Promise<void> {
		if (!this.currentAccount) {
			throw new AzureCliError('failed', 'No verified account is available. Refresh or sign in first.');
		}
		const value = field === 'user' ? this.currentAccount.user.name : this.currentAccount[field];
		await vscode.env.clipboard.writeText(value);
		void vscode.window.showInformationMessage('Azure account detail copied to clipboard.');
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		++this.refreshVersion;
		clearTimeout(this.refreshTimer);
		this.cli.dispose();
		this.menu?.hide();
		for (const disposable of this.subscriptions) {
			disposable.dispose();
		}
	}
}

export function activate(context: vscode.ExtensionContext): void {
	extension = new AzureContext();
	context.subscriptions.push(extension);
}

export function deactivate(): void {
	extension?.dispose();
	extension = undefined;
}
