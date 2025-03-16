# 🚀 ICPilot

<div align="center">
  <h3><em>Web3, one click away</em></h3>
  <p>Transform your traditional Web2 JavaScript code into Web3 applications on the Internet Computer Protocol</p>

[![VS Code Marketplace](https://img.shields.io/badge/VS%20Code-Marketplace-blue.svg)](https://marketplace.visualstudio.com/items?itemName=ICPilot)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-Required-green.svg)](https://nodejs.org/)

</div>

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [DFX Installation](#dfx-installation)
- [Architecture](#architecture)
- [Troubleshooting](#troubleshooting)
- [License](#license)
- [Development](#development)
- [Links](#links)

## 🔍 Overview

ICPilot bridges the gap between traditional web development and blockchain technology, allowing developers to seamlessly migrate their JavaScript applications to the Internet Computer Protocol (ICP) blockchain ecosystem.

The extension provides a streamlined workflow to:

1. Analyze your JavaScript code
2. Generate equivalent Motoko canisters for the Internet Computer
3. Deploy the canisters to a local or production ICP blockchain
4. Modify your client code to interact with the deployed canister

## ✨ Features

- **🔄 One-Click Conversion**: Transform Web2 code to Web3 with a single command
- **🛠️ Automated DFX Installation**: Built-in management of the DFINITY SDK (dfx)
- **🧠 Smart Code Analysis**: Identifies functions and patterns in your code suitable for blockchain migration
- **🏗️ Canister Generation**: Creates Motoko canisters that replicate your Web2 functionality
- **🔌 Client Code Updates**: Modifies your JavaScript to interact with the blockchain using @dfinity/agent
- **📦 Consolidated Canisters**: Option to create a single canister for multiple files
- **📈 Incremental Updates**: Support for adding functions to existing canisters

## 📋 Requirements

- Visual Studio Code 1.85.0 or higher
- Node.js and npm
- Internet connection for canister deployment and SDK installation

## 💻 Installation

### VS Code Marketplace

1. Open VS Code
2. Go to Extensions (Ctrl+Shift+X / Cmd+Shift+X)
3. Search for "ICPilot"
4. Click "Install"

### Manual Installation

Download and install the VSIX file:

```bash
code --install-extension icpilot-0.0.1.vsix
```

## 🚀 Quick Start

1. Open your JavaScript project in VS Code
2. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (Mac)
3. Type and select `ICPilot: Convert to Web3`
4. Choose between converting the current file or selecting multiple files
5. Follow the prompts to complete the conversion
6. Begin interacting with the ICP blockchain!

## ⚙️ DFX Installation

When you first use the extension, it will check if the DFINITY SDK (dfx) is installed on your system:

- If not found, it will offer to install it automatically
- You can also follow the manual installation instructions in the documentation

For detailed installation instructions, see [dfx-installation.md](docs/dfx-installation.md).

## 🏛️ Architecture

The extension consists of several key components:

- **Analyzer**: Examines JavaScript code to identify functions for blockchain migration
- **Generator**: Creates Motoko canister code based on the analysis
- **Deployer**: Handles DFX installation and canister deployment
- **Provider**: Manages file selection and user interactions

## ❓ Troubleshooting

- **DFX Installation Issues**: The extension provides automatic fixes for common DFX installation problems
- **Missing Base Packages**: Automatically attempts to fix issues with Motoko base libraries
- **Deployment Failures**: Implements several fallback mechanisms for reliable canister deployment

If you encounter issues, check out our [troubleshooting guide](docs/troubleshooting.md) or [open an issue](https://github.com/Programmer-Shivansh/ICPilot/issues).

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🛠️ Development

1. Clone the repository

```bash
git clone https://github.com/Programmer-Shivansh/ICPilot.git
cd ICPilot
```

2. Install dependencies

```bash
npm install
```

3. Make your changes and test them

```bash
npm run compile
npm run test
```

4. Submit a pull request with your improvements

## 🔗 Links

- [GitHub Repository](https://github.com/Programmer-Shivansh/ICPilot)
- [DFINITY Developer Docs](https://internetcomputer.org/docs/current/developer-docs/)
- [VS Code Extension Marketplace](https://marketplace.visualstudio.com/items?itemName=ICPilot)
- [Report Issues](https://github.com/Programmer-Shivansh/ICPilot/issues)
