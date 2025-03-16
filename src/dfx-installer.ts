import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { spawn,exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';

const execPromise = promisify(exec);

/**
 * Installs the DFINITY SDK using the official installation script
 * Returns a promise that resolves when installation is complete
 */
export async function installDfxSdk(): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      vscode.window.showInformationMessage('Installing DFINITY SDK...');

      const platform = os.platform();
      let installCmd: string;
      let installArgs: string[];
      
      // Choose the appropriate installation command based on platform
      if (platform === 'darwin') {
        installCmd = 'sh';
        installArgs = ['-ci', '$(curl -fsSL https://internetcomputer.org/install.sh)'];
      } else if (platform === 'linux') {
        installCmd = 'sh';
        installArgs = ['-c', 'curl -fsSL https://internetcomputer.org/install.sh | sh'];
        try {
          vscode.window.showInformationMessage('Installing libunwind-dev dependency...');
          await execPromise('apt-get -y update && apt-get -y install libunwind-dev');
        } catch (err) {
          vscode.window.showWarningMessage('Could not install libunwind-dev. You may need to install this dependency manually.');
        }
      } else if (platform === 'win32') {
        installCmd = 'powershell.exe';
        installArgs = ['-Command', 'iex ((New-Object System.Net.WebClient).DownloadString(\'https://internetcomputer.org/install.ps1\'))'];
      } else {
        reject(new Error(`Unsupported platform: ${platform}. Please install DFX manually.`));
        return;
      }

      // Execute the installation command
      const installProcess = spawn(installCmd, installArgs, { shell: true, stdio: 'pipe' });
      let installOutput = '';
      
      installProcess.stdout?.on('data', (data) => {
        installOutput += data.toString();
        console.log('DFX install output:', data.toString());
      });
      
      installProcess.stderr?.on('data', (data) => {
        installOutput += data.toString();
        console.error('DFX install error:', data.toString());
      });

      installProcess.on('error', (err) => {
        reject(new Error(`Failed to start DFX installation: ${err.message}`));
      });

      installProcess.on('close', async (code) => {
        if (code === 0) {
          // Update PATH and environment in the current process
          await updateEnvironmentVariables();
          
          // Verify installation 
          try {
            // Try to initialize the cache as well
            vscode.window.showInformationMessage('Installing DFX cache packages...');
            try {
              await execPromise('dfx cache install');
            } catch (cacheError) {
              console.log('Cache installation error:', cacheError);
              // Try again with the full path
              const dfxPath = await getDfxPath();
              if (dfxPath) {
                try {
                  await execPromise(`"${dfxPath}" cache install`);
                } catch (secondCacheError) {
                  console.log('Second cache installation attempt failed:', secondCacheError);
                }
              }
            }
            
            const { stdout } = await execPromise('dfx --version');
            vscode.window.showInformationMessage(`DFX installed successfully: ${stdout.trim()}`);
            resolve();
          } catch (verifyError) {
            console.log('DFX verification error:', verifyError);
            // Try with full path
            const dfxPath = await getDfxPath();
            if (dfxPath) {
              try {
                const { stdout } = await execPromise(`"${dfxPath}" --version`);
                vscode.window.showInformationMessage(`DFX installed successfully: ${stdout.trim()}`);
                resolve();
              } catch (fullPathError) {
                console.error('Error verifying DFX with full path:', fullPathError);
                vscode.window.showWarningMessage('DFX was installed but requires environment setup. Continuing with installation.');
                resolve();
              }
            } else {
              vscode.window.showWarningMessage('DFX was installed but requires environment setup. Continuing with installation.');
              resolve();
            }
          }
        } else {
          reject(new Error(`DFX installation failed with exit code ${code}. Please try installing manually.\n\nOutput: ${installOutput}`));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Update environment variables for the current process based on DFX installation
 */
async function updateEnvironmentVariables(): Promise<void> {
  const platform = os.platform();
  
  // Find potential DFX paths
  const potentialPaths = [
    path.join(os.homedir(), '.local', 'bin'),
    path.join(os.homedir(), '.dfinity', 'bin'),
    path.join(os.homedir(), 'bin')
  ];
  
  // For Windows, add potential Windows-specific paths
  if (platform === 'win32') {
    potentialPaths.push(
      path.join(os.homedir(), 'AppData', 'Local', 'dfinity', 'bin'),
      path.join(os.homedir(), '.cargo', 'bin')
    );
  }
  
  // Add these paths to the PATH environment variable
  let pathsAdded = false;
  for (const potentialPath of potentialPaths) {
    if (fs.existsSync(potentialPath)) {
      // Add to PATH if not already there
      if (!process.env.PATH?.includes(potentialPath)) {
        process.env.PATH = `${potentialPath}${path.delimiter}${process.env.PATH || ''}`;
        pathsAdded = true;
      }
    }
  }
  
  if (pathsAdded) {
    console.log('Added DFX paths to PATH:', process.env.PATH);
  }

  // For macOS, source the environment script
  if (platform === 'darwin') {
    const envScript = path.join(os.homedir(), 'Library', 'Application Support', 'org.dfinity.dfx', 'env');
    if (fs.existsSync(envScript)) {
      try {
        const { stdout } = await execPromise(`source "${envScript}" && env`);
        const envVars = stdout.split('\n');
        for (const line of envVars) {
          const [key, ...valueParts] = line.split('=');
          if (key && valueParts.length) {
            const value = valueParts.join('='); // Rejoin in case value contains = characters
            process.env[key] = value;
          }
        }
        console.log('Sourced DFX environment variables');
      } catch (error) {
        console.log('Error sourcing DFX environment:', error);
      }
    }
  }
}

/**
 * Find the full path to the dfx executable after installation
 */
async function getDfxPath(): Promise<string | null> {
  const potentialPaths = [
    path.join(os.homedir(), '.local', 'bin', 'dfx'),
    path.join(os.homedir(), '.dfinity', 'bin', 'dfx'),
    path.join(os.homedir(), 'bin', 'dfx')
  ];
  
  // For Windows, add .exe extension and additional paths
  if (os.platform() === 'win32') {
    potentialPaths.push(
      path.join(os.homedir(), '.local', 'bin', 'dfx.exe'),
      path.join(os.homedir(), '.dfinity', 'bin', 'dfx.exe'),
      path.join(os.homedir(), 'bin', 'dfx.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'dfinity', 'bin', 'dfx.exe'),
      path.join(os.homedir(), '.cargo', 'bin', 'dfx.exe')
    );
  }
  
  for (const potentialPath of potentialPaths) {
    if (fs.existsSync(potentialPath)) {
      return potentialPath;
    }
  }
  
  return null;
}

/**
 * Verifies if DFX is installed and working correctly
 */
export async function verifyDfxInstallation(): Promise<boolean> {
  try {
    const { stdout } = await execPromise('dfx --version');
    console.log(`DFX version: ${stdout.trim()}`);
    return true;
  } catch (error) {
    // Try with full path
    const dfxPath = await getDfxPath();
    if (dfxPath) {
      try {
        const { stdout } = await execPromise(`"${dfxPath}" --version`);
        console.log(`DFX version (full path): ${stdout.trim()}`);
        return true;
      } catch (fullPathError) {
        return false;
      }
    }
    return false;
  }
}
