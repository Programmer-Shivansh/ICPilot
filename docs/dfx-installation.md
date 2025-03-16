# DFINITY SDK (DFX) Installation Guide

The ICPilot Web2 to Web3 Converter extension requires the DFINITY SDK (DFX) to deploy canisters to the Internet Computer. This guide provides instructions for installing DFX on different operating systems.

## Automatic Installation

When you try to deploy a canister for the first time, the extension will detect if DFX is not installed and offer to install it for you. Simply click "Install DFX" when prompted.

## Manual Installation

If the automatic installation fails or you prefer to install manually, follow these platform-specific instructions.

### macOS

1. Open Terminal
2. Install Homebrew if you don't already have it:

   ```
   /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
   ```

3. Install Node.js:

   ```
   brew install node
   ```

4. For Apple Silicon machines (M1, M2, etc), install Rosetta:

   ```
   softwareupdate --install-rosetta
   ```

5. Install the IC SDK:

   ```
   sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"
   ```

6. Verify the installation:
   ```
   dfx --version
   ```

### Linux

1. Install Node.js according to your distribution
   (Ubuntu example):

   ```
   sudo apt update
   sudo apt install nodejs npm
   ```

2. Install required dependencies:

   ```
   sudo apt install libunwind-dev
   ```

3. Install the IC SDK:

   ```
   sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"
   ```

4. Verify the installation:
   ```
   dfx --version
   ```

### Windows

1. Install Node.js from the official website: https://nodejs.org/
2. Open PowerShell as Administrator
3. Install the IC SDK:
   ```
   iex ((New-Object System.Net.WebClient).DownloadString('https://internetcomputer.org/install.ps1'))
   ```
4. Verify the installation:
   ```
   dfx --version
   ```

## Troubleshooting

If you encounter issues with DFX installation:

1. Make sure you have administrative privileges
2. Check that your PATH includes the DFX binary location (usually `~/.local/bin` on Unix systems)
3. Try restarting your terminal/IDE after installation
4. Consult the [official documentation](https://internetcomputer.org/docs/current/developer-docs/setup/install/) for more information

## Next Steps

After installing DFX, you should be able to deploy canisters using the extension. The extension will automatically start a local replica when needed.
