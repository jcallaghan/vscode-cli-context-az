# Changelog

## [Unreleased]

### Hardened

- Runtime validation of Azure CLI account data and subscription GUIDs.
- Structured process arguments, safe Windows batch-launcher handling and executable
  resolution that excludes relative PATH entries and the current workspace.
- Bounded CLI output, process timeouts, cancellation and owned process-tree cleanup.
- Distinct signed-out, missing-CLI, invalid-data and command-failure states.
- Ordered refreshes so older results cannot overwrite newer account context.
- Explicit subscription-change verification and serialized account mutations.
- Lifecycle-safe menus, disposable debouncing and redacted diagnostics.
- Custom `AZURE_CONFIG_DIR` support; watch account/config files rather than token caches.
- Interactive login runs as a dedicated terminal process, with refresh on process
  completion, configuration changes or focus instead of an arbitrary five-second delay.
- Trusted-workspace and remote-extension-host behavior documented explicitly.

### Added

- Individual user-level detail visibility controls; context remains visible by default.
- Deterministic CLI and UI behavior regressions alongside extension-host smoke tests.
- Cross-platform minimum/stable VS Code CI and reproducible release-candidate packaging.
- Completed release identity, original PNG icon and a strict VSIX file allowlist.

## [0.1.0] - Initial implementation (not yet published)

- Azure CLI subscription status bar, account menu and subscription switching.
- Interactive login, confirmed logout and copy actions.
- Configuration-file and window-focus refresh.
