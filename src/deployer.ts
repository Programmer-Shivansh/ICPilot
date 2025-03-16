import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execPromise = promisify(exec);
const fsPromises = fs.promises;

/**
 * Deploys a Motoko canister to the Internet Computer.
 * @param canisterName The name of the canister to deploy
 * @param projectPath The local file path to the project
 * @returns A Promise that resolves to the canister ID
 */
export async function deployCanister(canisterName: string, projectPath: string): Promise<string> {
  try {
    // First, check if dfx is installed
    const dfxCheck = await checkDfxInstalled();
    if (!dfxCheck.installed) {
      throw new Error(dfxCheck.message || 'DFX not installed. Please install the DFINITY SDK.');
    }
    
    // Create a directory for the IC project if it doesn't exist
    const icProjectDir = path.join(projectPath, 'ic_project');
    await createDirIfNotExists(icProjectDir);
    
    // Create required subdirectories
    const srcDir = path.join(icProjectDir, 'src');
    const canisterDir = path.join(srcDir, canisterName);
    await createDirIfNotExists(srcDir);
    await createDirIfNotExists(canisterDir);
    
    // Copy the Motoko file to the canister directory
    const sourceFile = path.join(projectPath, 'src', `${canisterName}.mo`);
    const targetFile = path.join(canisterDir, 'main.mo');
    
    // Check if the source file exists
    if (!fs.existsSync(sourceFile)) {
      throw new Error(`Canister source file not found: ${sourceFile}`);
    }
    
    await fsPromises.copyFile(sourceFile, targetFile);
    
    // Create or update dfx.json
    await createDfxConfig(icProjectDir, canisterName);
    
    // Start the local replica if not already running
    await startDfxReplica(icProjectDir);
    
    // Check if the canister already exists
    const existingCanisterId = await getExistingCanisterId(icProjectDir, canisterName);
    
    if (existingCanisterId) {
      // If canister exists, just upgrade it
      vscode.window.showInformationMessage(`Updating existing canister ${canisterName}...`);
      await upgradeCanister(icProjectDir, canisterName);
      return existingCanisterId;
    } else {
      // Deploy the canister to the local replica
      return await deployToReplica(icProjectDir, canisterName);
    }
    
  } catch (error) {
    console.error('Deployment error:', error);
    throw new Error(`Failed to deploy canister: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets the ID of an existing canister if it exists
 */
async function getExistingCanisterId(projectDir: string, canisterName: string): Promise<string | null> {
  try {
    // Check if the canister ID exists in the .dfx directory
    const { stdout } = await execPromise(`dfx canister id ${canisterName}`, {
      cwd: projectDir
    });
    
    const canisterId = stdout.trim();
    if (canisterId) {
      return canisterId;
    }
    return null;
  } catch (error) {
    console.log(`Canister ${canisterName} does not exist yet.`);
    return null;
  }
}

/**
 * Upgrades an existing canister
 */
async function upgradeCanister(projectDir: string, canisterName: string): Promise<void> {
  try {
    const { stdout } = await execPromise(`dfx canister install ${canisterName} --mode=upgrade`, {
      cwd: projectDir
    });
    
    console.log('Canister upgrade output:', stdout);
  } catch (error) {
    console.error('Error upgrading canister:', error);
    throw new Error(`Failed to upgrade canister: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Checks if DFX is installed on the system
 */
async function checkDfxInstalled(): Promise<{installed: boolean, message?: string, version?: string}> {
  try {
    const { stdout } = await execPromise('dfx --version');
    return {
      installed: true,
      version: stdout.trim()
    };
  } catch (error) {
    console.error('Error checking DFX:', error);
    return {
      installed: false,
      message: 'DFX is not installed or not in PATH. Please install the DFINITY SDK from https://sdk.dfinity.org'
    };
  }
}

/**
 * Creates a directory if it doesn't exist
 */
async function createDirIfNotExists(dirPath: string): Promise<void> {
  try {
    await fsPromises.mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Ignore if directory exists
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
      throw error;
    }
  }
}

/**
 * Creates or updates the dfx.json configuration file
 */
async function createDfxConfig(projectDir: string, canisterName: string): Promise<void> {
  const dfxConfig = {
    version: 1,
    canisters: {
      [canisterName]: {
        type: "motoko",
        main: `src/${canisterName}/main.mo`
      }
    },
    defaults: {
      build: {
        packtool: "mops sources",
        args: ""
      }
    },
    networks: {
      local: {
        bind: "127.0.0.1:8000",
        type: "ephemeral"
      }
    }
  };
  
  const dfxPath = path.join(projectDir, 'dfx.json');
  await fsPromises.writeFile(dfxPath, JSON.stringify(dfxConfig, null, 2));
}

/**
 * Starts the DFX replica if not already running
 */
async function startDfxReplica(projectDir: string): Promise<void> {
  try {
    // Check if replica is already running
    try {
      await execPromise('dfx ping');
      console.log('DFX replica is already running');
      return;
    } catch {
      console.log('DFX replica not running, starting it...');
    }
    
    // Start the replica in background
    const startProcess = exec('dfx start --background', {
      cwd: projectDir
    });
    
    // Wait for replica to be ready
    return await new Promise<void>((resolve, reject) => {
      if (!startProcess.stdout || !startProcess.stderr) {
        reject(new Error('Failed to start DFX process'));
        return;
      }
      
      startProcess.stdout.on('data', (data) => {
        console.log(`DFX stdout: ${data}`);
        if (data.includes('Running') || data.includes('started')) {
          resolve();
        }
      });
      
      startProcess.stderr.on('data', (data) => {
        console.error(`DFX stderr: ${data}`);
      });
      
      // Set a timeout for starting the replica
      setTimeout(() => {
        resolve(); // Assume it started, the deploy command will fail if it didn't
      }, 10000);
    });
  } catch (error) {
    console.error('Error starting replica:', error);
    throw new Error(`Failed to start DFX replica: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deploys the canister to the local replica and returns the canister ID
 */
async function deployToReplica(projectDir: string, canisterName: string): Promise<string> {
  try {
    // Deploy the canister
    vscode.window.showInformationMessage('Deploying canister to local replica...');
    const { stdout } = await execPromise('dfx deploy', {
      cwd: projectDir
    });
    
    console.log('Deployment output:', stdout);
    
    // Get the canister ID
    const { stdout: idOutput } = await execPromise(`dfx canister id ${canisterName}`, {
      cwd: projectDir
    });
    
    const canisterId = idOutput.trim();
    vscode.window.showInformationMessage(`Canister deployed with ID: ${canisterId}`);
    
    return canisterId;
  } catch (error) {
    console.error('Deployment error:', error);
    throw new Error(`Failed to deploy canister: ${error instanceof Error ? error.message : String(error)}`);
  }
}