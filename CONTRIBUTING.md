# Contributing

## Setup

Use Node.js 22.14 or later and VS Code 1.107.0 or later.

```sh
git clone https://github.com/jcallaghan/vscode-cli-context-az.git
cd vscode-cli-context-az
npm ci
npm run compile
```

Press F5 to launch the development extension, or run `npm run watch`.
An installed Azure CLI and a test account are needed only for manual end-to-end tests.

## Automated checks

```sh
npm run test:unit
npm test
npm run vsix
npm run verify:vsix
npm audit --audit-level=low
```

- `test:unit` compiles TypeScript and runs deterministic Node tests with fake account
  data. CLI process tests execute local fixtures, never a real account change.
- `npm test` builds and lints, runs the deterministic tests, then activates the
  production bundle in a VS Code extension host. It does not execute login, logout
  or subscription switching. Activation can read the host's current CLI account.
- `VSCODE_TEST_VERSION=1.107.0` selects the minimum supported VS Code release.
  In PowerShell, set `$env:VSCODE_TEST_VERSION = '1.107.0'` before running the tests.
- Linux desktop tests need an X display; CI uses `xvfb-run`.
- `verify:vsix` checks the packaging file allowlist, release identity and icon.
- CI covers minimum/stable VS Code on Windows, Linux and macOS. A separate
  Node.js 24 job validates the deterministic suite.

Keep the VS Code typings pinned to the minimum supported API version. Update the
dependency lockfile with manifest changes; do not use forced audit upgrades without
examining compatibility. No runtime npm dependencies should be required.

Compiler upgrades must remain within the installed `typescript-eslint` peer
dependency range. Dependabot currently defers TypeScript 7 and later because the
parser supports TypeScript versions below 6.1. Remove that ignore only after the
parser supports the proposed compiler and the complete CI matrix passes. Do not
use `--force` or `--legacy-peer-deps` to conceal an unsupported combination.

The test CLI currently constrains Mocha to an older major with vulnerable
serialization/diff dependencies. A narrowly scoped override uses patched Mocha 12.
Keep the minimum/stable extension-host tests green when updating it, and remove
the override when the upstream test CLI supports the patched major.
The test-electron override also keeps the test CLI on the same current downloader
as the project, including support for newer macOS application layouts.

### Registry portability

Do not commit a corporate registry URL or registry credentials. The project
`.npmrc` only enables `omit-lockfile-registry-resolved`: the lockfile retains exact
versions and integrity hashes without embedding registry download URLs.
`npm ci` uses the registry configured in each environment. Corporate development
can therefore keep its required registry/CFS configuration, while public
contributors and GitHub Actions use their normal public registry.

Run `npm install` with the same project configuration when updating dependencies.
The package verification check rejects registry URLs in the lockfile so a local
corporate configuration cannot accidentally become a public installation requirement.

A registry-neutral lockfile does not guarantee that every registry has mirrored
every locked version. If a required corporate feed reports `ETARGET` for a version
that passes public CI, request the package through the corporate feed's normal
process. Do not switch registries to bypass corporate controls. Public CI and the
release-candidate workflow can validate the exact commit while mirroring is pending.

## Implementation boundaries

- `src/azureCli.ts`: validated account data, executable resolution, bounded process
  execution and cancellable CLI operations.
- `src/extension.ts`: status bar, menu lifecycle, refresh ordering, settings and commands.
- `test/`: deterministic CLI and UI behavior regressions.
- `src/test/`: production-bundle extension-host smoke tests.

Keep command arguments structured and validate identifiers. Never log raw CLI
output or credentials. Error states must not be represented as successful empty
results. Dispose listeners, menus, timers and owned processes.

## CLI Context branding

The display name is **CLI Context: Azure**. Keep the published identity
`jcallaghan.azure-cli-context`, the `azure-cli-context.*` command IDs and the
configuration keys stable when changing presentation.

The Marketplace icon is an original terminal frame with a CLI label, ellipsis and
an AZ tag, not a Microsoft product logo. Within VS Code, use the built-in Azure
glyph to identify Azure context. A future **CLI Context: GitHub** companion can use
the same icon geometry with a GH tag; it is not part of this extension.

The committed 256-pixel PNG requires no build-time image dependencies. To regenerate
it on Windows with PowerShell 7 and the installed Segoe UI font:

```powershell
pwsh -NoProfile -File .\scripts\generate-icon.ps1 -Tag AZ -OutputPath .\images\icon.png
```

Use `-Tag GH` and a separate output path to preview the companion artwork without
replacing the Azure asset. Review generated icons at 256, 128 and 64 pixels.

## Manual release checklist

Passing CI is necessary but not a replacement for interactive checks.

- [ ] Verify ownership of Marketplace publisher `jcallaghan` and its credentials.
- [ ] Confirm all CI jobs are green for the exact release commit.
- [ ] On each supported platform, install the VSIX into a clean VS Code profile.
- [ ] Verify sign-in with MFA and a deliberately slow authentication flow.
- [ ] Switch between two enabled subscriptions and confirm with `az account show`.
- [ ] Verify user, service principal and managed-identity CLI contexts where supported.
- [ ] Verify cancellation of logout, then confirmed logout and signed-out UI.
- [ ] Verify missing CLI, CLI failures and an account with no available subscriptions.
- [ ] Verify custom `AZURE_CONFIG_DIR`, external CLI changes and window-focus refresh.
- [ ] Verify each detail visibility setting, including an already-open menu.
- [ ] Verify Remote SSH/WSL/container behavior in every environment advertised as supported.
- [ ] Confirm untrusted workspaces do not activate the extension.
- [ ] Check screen-reader navigation and light, dark and high-contrast themes.
- [ ] Capture sanitized screenshots for the Marketplace listing.
- [ ] Review the VSIX contents and run the dependency audit.
- [ ] Update the changelog/version and commit the lockfile before tagging.

## Packaging and publication

`npm run package` builds the production JavaScript bundle. `npm run vsix` invokes
the pinned VSCE tool, runs the production prepublish checks and creates the VSIX.
The **Package release candidate** workflow produces a versioned artifact without
publishing to the Marketplace or creating a GitHub release.

After the checklist is complete, create the release tag and GitHub release using
the validated VSIX. Authenticate VSCE as the real publisher outside source control.
Publishing is deliberately manual:

```sh
npm run vsix
npm run verify:vsix
npx vsce publish --packagePath azure-cli-context-0.1.0.vsix
```

Adjust the versioned filename when the version changes. Never commit publisher
tokens, put credentials in workflow files or publish an artifact from an unreviewed commit.

## Reporting problems

Use [GitHub issues](https://github.com/jcallaghan/vscode-cli-context-az/issues).
Include OS, VS Code and Azure CLI versions, remote/local environment, steps to
reproduce and the redacted extension error category. Do not post tokens, full
account dumps or private tenant/subscription details.
