import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);

/**
 * Enum for DFX installation status
 */
export enum DfxStatus {
  NotInstalled,
  InstalledButMissingPackages,
  FullyInstalled
}

/**
 * Checks the status of DFX installation and packages
 */
export async function checkDfxStatus(): Promise<DfxStatus> {
  try {
    // Check if DFX is installed
    const checkCmd = os.platform() === 'win32' ? 'where dfx' : 'which dfx';
    await execPromise(checkCmd);
    
    // Check if base packages are accessible
    const tempDir = path.join(os.tmpdir(), 'dfx-check-' + Math.random().toString(36).substring(2, 15));
    await fs.promises.mkdir(tempDir, { recursive: true });
    
    const testFile = path.join(tempDir, 'test.mo');
    await fs.promises.writeFile(testFile, 'import Nat "mo:base/Nat"; actor {}');
    
    const mocPath = `${os.homedir()}/.cache/dfinity/versions/0.25.0/moc`;
    
    try {
      await execPromise(`"${mocPath}" "${testFile}" --check`);
      
      // Clean up
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      
      return DfxStatus.FullyInstalled;
    } catch (packageError) {
      // Clean up
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      
      return DfxStatus.InstalledButMissingPackages;
    }
  } catch (error) {
    return DfxStatus.NotInstalled;
  }
}

/**
 * Attempts to fix DFX package issues
 */
export async function fixDfxPackages(): Promise<boolean> {
  try {
    vscode.window.showInformationMessage('Attempting to fix DFX packages...');
    
    // First try updating DFX
    try {
      vscode.window.showInformationMessage('Updating DFX...');
      await execPromise('dfx upgrade');
    } catch (upgradeError) {
      console.error('DFX upgrade failed:', upgradeError);
    }
    
    // Ensure cache is populated
    vscode.window.showInformationMessage('Installing DFX cache...');
    await execPromise('dfx cache install');
    
    // Check if fix worked
    const status = await checkDfxStatus();
    return status === DfxStatus.FullyInstalled;
  } catch (error) {
    console.error('Failed to fix DFX packages:', error);
    return false;
  }
}

/**
 * Shows a modal dialog with instructions for fixing DFX
 */
export async function showDfxFixInstructions(): Promise<void> {
  const selection = await vscode.window.showErrorMessage(
    'Your DFX installation appears to be missing required packages. This can happen if DFX was not correctly installed.',
    'Fix Automatically',
    'Show Manual Instructions'
  );
  
  if (selection === 'Fix Automatically') {
    const fixed = await fixDfxPackages();
    if (fixed) {
      vscode.window.showInformationMessage('DFX packages have been successfully installed.');
    } else {
      await showManualInstructions();
    }
  } else if (selection === 'Show Manual Instructions') {
    await showManualInstructions();
  }
}

async function showManualInstructions(): Promise<void> {
  const instructions = `
# Fix DFX Installation

It appears your DFX installation is missing the Motoko base packages.
Follow these steps to fix the issue:

1. Open a terminal and run:
   \`\`\`
   dfx cache install
   \`\`\`

2. If that doesn't work, try reinstalling DFX:
   \`\`\`
   sh -ci "$(curl -fsSL https://internetcomputer.org/install.sh)"
   \`\`\`

3. After reinstalling, check if it works:
   \`\`\`
   dfx --version
   \`\`\`

4. Then try deploying your canister again.
`;

  const doc = await vscode.workspace.openTextDocument({
    content: instructions,
    language: 'markdown'
  });
  
  await vscode.window.showTextDocument(doc);
}
