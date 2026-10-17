# Azure CLI Context VS Code Extension

## Project Overview

A VS Code extension that displays the current Azure CLI user and selected subscription in the status bar. Clicking the status bar shows detailed account information and allows switching between Azure accounts/subscriptions.

## Features

-   Status bar showing current Azure CLI account and subscription
-   QuickPick menu on click with account details
-   Ability to switch between Azure accounts/subscriptions
-   Uses `az account show` and `az account list` CLI commands

## Development

-   TypeScript-based VS Code extension
-   Uses VS Code Status Bar API
-   Executes Azure CLI commands via child_process

## Build & Run

-   `npm install` - Install dependencies
-   `npm run compile` - Compile TypeScript
-   Press F5 to launch Extension Development Host
