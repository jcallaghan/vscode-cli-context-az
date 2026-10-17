# Azure CLI Context

[![CI](https://github.com/jcallaghan/vscode-cli-context-az/actions/workflows/ci.yml/badge.svg)](https://github.com/jcallaghan/vscode-cli-context-az/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

See which Azure subscription your CLI is using, without leaving VS Code.
Click the status bar to inspect your account, switch subscriptions, copy identifiers,
or start an Azure CLI sign-in.

> Initial release candidate. Marketplace publication is a separate, manual release step.
> This project is independent and is not affiliated with Microsoft.

## Features

- Current subscription in the status bar, with account details in the hover tooltip.
- Subscription switching with confirmation of the resulting CLI context.
- Copy user identity, subscription ID or tenant ID without displaying their values in notifications.
- Azure CLI login in an integrated terminal, and confirmed logout.
- Event-driven refresh on account/configuration changes and window focus; no polling.
- Individual visibility controls for subscription names, user identity and identifiers.
- Actionable errors for a missing CLI, malformed output, failed commands and timeouts.

## Requirements

- VS Code 1.107.0 or later in a trusted workspace.
- [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed on the extension host's PATH.
- An Azure CLI account with access to an enabled subscription.

For Remote SSH, WSL and Dev Containers, install and sign in to Azure CLI **in that
remote environment**. This workspace extension shows the remote CLI context, not
the account on your local computer. Browser-only/virtual workspaces are unsupported.

## Install

Until the first Marketplace release, download a release-candidate VSIX from the
repository's [Actions artifacts](https://github.com/jcallaghan/vscode-cli-context-az/actions)
or build it yourself:

```sh
npm ci
npm run vsix
code --install-extension azure-cli-context-0.1.0.vsix
```

Building requires Node.js 22.14 or later. No npm runtime dependencies are shipped.

The intended Marketplace identity is `jcallaghan.azure-cli-context`; availability
and publisher ownership must be verified before the first publication.

## Use

1. Run `az login` in the appropriate environment, or use **Login to Azure CLI**.
2. Find the Azure subscription on the left of the status bar.
3. Click it to inspect context, select another enabled subscription or copy account details.

**Important:** switching and logout change the Azure CLI configuration shared with
other terminals and tools. The extension does not isolate accounts per workspace
and cannot prevent a command being run against the wrong subscription. Always
verify the target before an important operation.

Sign-in remains interactive in a dedicated terminal running the resolved Azure CLI
as its own process. The terminal closes and context refreshes when that process
finishes, even without terminal shell integration. Close it to cancel sign-in.
Configuration changes, window focus and manual refresh provide additional triggers.
There is no fixed five-second assumption about how long authentication takes.

## Commands

Open the Command Palette and search for **Azure CLI Context**:

| Command | Purpose |
| --- | --- |
| Show Azure Account Menu | Inspect accounts and available actions |
| Refresh Azure Account | Read the latest CLI context |
| Login to Azure CLI | Start interactive sign-in in a terminal |
| Logout from Azure CLI | Confirm and sign out of the shared CLI configuration |
| Switch Azure Subscription | Choose an enabled subscription |
| Copy Subscription ID | Copy the currently verified subscription ID |
| Copy Tenant ID | Copy the currently verified tenant ID |

## Detail visibility

All context details are visible by default. Use these **user-level** settings to
hide individual details for presentations or screen sharing:

```json
{
  "azure-cli-context.showSubscriptionName": true,
  "azure-cli-context.showUser": true,
  "azure-cli-context.showSubscriptionId": true,
  "azure-cli-context.showTenantId": true
}
```

Set all four to `false` for a generic Azure status label and numbered subscriptions.
Changing these settings dismisses an already-open account menu so previously
displayed details are not left on screen. These are presentation controls, not
access controls: explicit copy commands still copy the selected values. Clipboard
history and the login terminal are outside these display controls.

## How it works and security

- Reads account data through `az account show` and `az account list`.
- Uses `AZURE_CONFIG_DIR` when set, otherwise the home directory's `.azure` folder.
- Watches only `azureProfile.json` and `config`, not token-cache files.
- Validates account output and subscription GUIDs before using them.
- Uses absolute executable paths from absolute PATH entries, without implicitly
  searching the current working directory.
- Executes programs without a general-purpose shell on Unix and for native Windows
  executables. Windows batch launchers use the system `cmd.exe` with fixed command
  tokens, validated GUIDs, disabled AutoRun and disabled delayed expansion.
- Limits background CLI operations to 15 seconds and 4 MiB of combined output;
  timeout, cancellation and extension disposal terminate owned process trees.
- Does not implement credential storage or send extension telemetry. Azure CLI
  retains responsibility for its own authentication, credentials and telemetry.
- Diagnostics contain standardized errors, not raw CLI output or account identifiers.
- Runs only in trusted workspaces. PATH entries and the Azure CLI installation
  must still be trusted; this is not a sandbox for a compromised environment.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Azure CLI not found | Install it in the extension host environment, check PATH, then restart VS Code |
| Not logged in | Run `az login`, or use the login command |
| No subscriptions found | Verify your subscription access and CLI sign-in |
| Command failed or timed out | Run `az account show --output json` in a terminal for the CLI's detailed diagnostic |
| Context not updating | Run Refresh Azure Account; check `AZURE_CONFIG_DIR` in the extension host environment |
| Login completed but the UI did not update | Refocus VS Code or use Refresh; verify the login process has finished |

The **Azure CLI Context** Output channel records redacted diagnostic categories.
Do not include tokens, account dumps or sensitive screenshots in public issues.
See [SECURITY.md](SECURITY.md) to report a suspected vulnerability privately.

## Development and release

See [CONTRIBUTING.md](CONTRIBUTING.md) for tests, CI and the manual release checklist.
See [CHANGELOG.md](CHANGELOG.md) for changes and [LICENSE](LICENSE) for the MIT license.
