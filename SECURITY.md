# Security

## Report a concern privately

Use [GitHub private vulnerability reporting](https://github.com/jcallaghan/vscode-cli-context-az/security/advisories/new)
for a suspected security vulnerability. Avoid public issues containing exploit
details, tokens, authentication caches, account dumps or private identifiers.

Include the extension version, OS, VS Code and Azure CLI versions, the
local/remote execution environment, prerequisites, impact and a minimal
reproduction using synthetic account details.

## Scope and trust

The extension executes the Azure CLI installed in the extension host environment.
The CLI installation, absolute PATH entries, user environment and trusted
workspace remain part of the trust boundary. It does not sandbox compromised
executables, isolate account state per workspace or authorize Azure operations.

It does not implement token storage or extension telemetry. Azure CLI owns its
authentication caches and its own telemetry settings. Display visibility controls
do not restrict access to the clipboard or CLI credentials.

The latest published release is the maintenance target. Before the first release,
report problems against the current source revision.
