import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { generateCanisterAndModifyCode } from './generator'; // Import for fallback

const execPromise = promisify(exec);
const fsPromises = fs.promises;

/**
 * Deploys a Motoko canister to the Internet Computer.
 * @param canisterName The name of the canister to deploy
 * @param projectPath The local file path to the project
 * @returns A Promise that resolves to the canister ID
 */
export async function deployCanister(canisterName: string, projectPath: string): Promise<string> {
  return vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `Deploying canister ${canisterName}...`,
      cancellable: false,
    },
    async (progress) => {
      try {
        progress.report({ increment: 10, message: 'Checking DFX installation...' });
        let dfxCheck = await checkDfxInstalled();
        if (!dfxCheck.installed) {
          progress.report({ increment: 20, message: 'DFX not found, installing...' });
          const installAction = await vscode.window.showErrorMessage(
            'DFX is not installed. You need the DFINITY SDK to deploy canisters.',
            'Install DFX',
            'Cancel'
          );
          if (installAction === 'Install DFX') {
            await installDfxSdk();
            dfxCheck = await checkDfxInstalled();
            if (!dfxCheck.installed) {
              throw new Error('DFX installation failed. Please install manually from https://sdk.dfinity.org');
            }
          } else {
            throw new Error('DFX installation was cancelled.');
          }
        }

        progress.report({ increment: 30, message: `Using DFX version ${dfxCheck.version || 'unknown'}` });

        const icProjectDir = path.join(projectPath, 'ic_project');
        await createDirIfNotExists(icProjectDir);
        const srcDir = path.join(icProjectDir, 'src');
        const canisterDir = path.join(srcDir, canisterName);
        await createDirIfNotExists(srcDir);
        await createDirIfNotExists(canisterDir);

        progress.report({ increment: 40, message: 'Preparing canister files...' });
        const sourceFile = path.join(projectPath, 'src', `${canisterName}.mo`);
        const targetFile = path.join(canisterDir, 'main.mo');
        if (!fs.existsSync(sourceFile)) {
          throw new Error(`Canister source file not found: ${sourceFile}`);
        }
        await fsPromises.copyFile(sourceFile, targetFile);
        await createDfxConfig(icProjectDir, canisterName);

        progress.report({ increment: 60, message: 'Starting local replica...' });
        await startDfxReplica(icProjectDir);

        progress.report({ increment: 80, message: 'Deploying to local replica...' });
        const existingCanisterId = await getExistingCanisterId(icProjectDir, canisterName);
        if (existingCanisterId) {
          await upgradeCanister(icProjectDir, canisterName);
          return existingCanisterId;
        } else {
          const canisterId = await deployToReplica(icProjectDir, canisterName, projectPath);
          progress.report({ increment: 100, message: `Deployed canister ${canisterName} with ID: ${canisterId}` });
          return canisterId;
        }
      } catch (error) {
        console.error('Deployment error:', error);
        throw new Error(`Failed to deploy canister: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );
}

/**
 * Installs the DFINITY SDK using the official installation script
 */
async function installDfxSdk(): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    try {
      vscode.window.showInformationMessage('Installing DFINITY SDK...');

      const platform = os.platform();
      let installCmd: string;
      let installArgs: string[];

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
          vscode.window.showWarningMessage('Could not install libunwind-dev. You may need to do this manually.');
        }
      } else if (platform === 'win32') {
        installCmd = 'powershell.exe';
        installArgs = ['-Command', 'iex ((New-Object System.Net.WebClient).DownloadString(\'https://internetcomputer.org/install.ps1\'))'];
      } else {
        reject(new Error(`Unsupported platform: ${platform}. Please install DFX manually.`));
        return;
      }

      const installProcess = spawn(installCmd, installArgs, { shell: true, stdio: 'inherit' });

      installProcess.on('error', (err) => {
        reject(new Error(`Failed to start DFX installation: ${err.message}`));
      });

      installProcess.on('close', async (code) => {
        if (code === 0) {
          if (platform === 'darwin') {
            try {
              const envScript = `${os.homedir()}/Library/Application Support/org.dfinity.dfx/env`;
              const { stdout } = await execPromise(`source "${envScript}" && env`);
              stdout.split('\n').forEach(line => {
                const [key, value] = line.split('=');
                if (key && value) process.env[key] = value;
              });
            } catch (err) {
              vscode.window.showWarningMessage('Could not source DFX environment. You may need to restart VS Code.');
            }
          }
          resolve();
        } else {
          reject(new Error(`DFX installation failed with exit code ${code}. Please try installing manually.`));
        }
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Checks if DFX is installed on the system
 */
async function checkDfxInstalled(): Promise<{installed: boolean, message?: string, version?: string}> {
  try {
    const checkCmd = os.platform() === 'win32' ? 'where dfx' : 'which dfx';
    await execPromise(checkCmd);
    try {
      const { stdout } = await execPromise('dfx --version');
      return {
        installed: true,
        version: stdout.trim()
      };
    } catch (versionError) {
      return {
        installed: true,
        message: 'DFX found in PATH but could not determine version'
      };
    }
  } catch (error) {
    console.error('Error checking DFX:', error);
    const homeDir = os.homedir();
    const potentialPaths = [
      path.join(homeDir, '.local', 'bin', 'dfx'),
      path.join(homeDir, '.dfinity', 'bin', 'dfx'),
      path.join(homeDir, 'bin', 'dfx')
    ];
    for (const potentialPath of potentialPaths) {
      if (fs.existsSync(potentialPath)) {
        return {
          installed: true,
          message: `DFX found at ${potentialPath} but not in PATH. Please add it to your PATH.`
        };
      }
    }
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
        main: `src/${canisterName}/main.mo`,
        type: "motoko"
      }
    },
    defaults: {
      build: {
        args: "",
        packtool: ""
      }
    },
    networks: {
      local: {
        bind: "127.0.0.1:4943",
        type: "ephemeral"
      }
    }
  };
  const dfxPath = path.join(projectDir, 'dfx.json');
  await fsPromises.writeFile(dfxPath, JSON.stringify(dfxConfig, null, 2));
}

const net = require('net');

/**
 * Checks if a port is free on the local machine
 * @param port The port number to check
 * @returns Promise resolving to true if the port is free, false if in use
 */
function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        resolve(false);
      } else {
        resolve(true);
      }
    });
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Starts the DFX replica if not already running, forcing port 4943
 */
async function startDfxReplica(projectDir: string): Promise<void> {
  try {
    try {
      await execPromise('dfx stop', { cwd: projectDir });
      console.log('Stopped any existing DFX replica');
      await new Promise(resolve => setTimeout(resolve, 2000));
    } catch (stopError) {
      console.log('No existing replica to stop or stop failed, proceeding...');
    }

    const fixedPort = 4943;

    if (!(await isPortFree(fixedPort))) {
      console.log(`Port ${fixedPort} is in use, attempting to free it...`);
      try {
        const { stdout } = await execPromise(`lsof -i :${fixedPort} -t`);
        const pid = stdout.trim();
        if (pid) {
          await execPromise(`kill -9 ${pid}`);
          console.log(`Killed process ${pid} on port ${fixedPort}`);
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      } catch (killError) {
        throw new Error(`Port ${fixedPort} is in use and could not be freed. Please stop the process manually.`);
      }
    }

    const dfxJsonPath = path.join(projectDir, 'dfx.json');
    const dfxConfig = JSON.parse(await fsPromises.readFile(dfxJsonPath, 'utf8'));
    dfxConfig.networks.local.bind = `127.0.0.1:${fixedPort}`;
    await fsPromises.writeFile(dfxJsonPath, JSON.stringify(dfxConfig, null, 2));

    try {
      const { stdout } = await execPromise(`dfx ping`, { cwd: projectDir });
      console.log(`DFX replica already running on port ${fixedPort}: ${stdout}`);
      vscode.window.showInformationMessage(`Local Internet Computer replica is running on port ${fixedPort}`);
      return;
    } catch (pingError) {
      console.log(`DFX replica not running on port ${fixedPort}, starting it...`);
    }

    vscode.window.showInformationMessage(`Starting local Internet Computer replica on port ${fixedPort}...`);

    const dfxDir = path.join(projectDir, '.dfx');
    const startCmd = fs.existsSync(dfxDir) ? `dfx start --background --host 127.0.0.1:${fixedPort}` : `dfx start --clean --background --host 127.0.0.1:${fixedPort}`;
    const startProcess = spawn(startCmd, { shell: true, cwd: projectDir });

    let startOutput = '';
    startProcess.stdout?.on('data', (data) => {
      startOutput += data.toString();
      console.log('dfx start output:', data.toString());
    });
    startProcess.stderr?.on('data', (data) => {
      startOutput += data.toString();
      console.error('dfx start error:', data.toString());
    });

    startProcess.on('error', (err) => {
      throw new Error(`Failed to start DFX replica: ${err.message}`);
    });

    let attempts = 0;
    const maxAttempts = 24;
    while (attempts < maxAttempts) {
      try {
        const { stdout } = await execPromise(`dfx ping`, { cwd: projectDir });
        console.log(`DFX replica started successfully: ${stdout}`);
        vscode.window.showInformationMessage(`Local Internet Computer replica is running on port ${fixedPort}`);
        return;
      } catch (pingError) {
        attempts++;
        console.log(`Ping attempt ${attempts}/${maxAttempts} failed: ${pingError}`);
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
    }

    throw new Error(`DFX replica failed to start on port ${fixedPort} after 120 seconds. Output: ${startOutput}`);
  } catch (error) {
    console.error('Error starting replica:', error);
    throw new Error(`Failed to start DFX replica: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Gets the ID of an existing canister if it exists
 */
async function getExistingCanisterId(projectDir: string, canisterName: string): Promise<string | null> {
  try {
    const { stdout } = await execPromise(`dfx canister id ${canisterName}`, { cwd: projectDir });
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
    const { stdout } = await execPromise(`dfx canister install ${canisterName} --mode=upgrade`, { cwd: projectDir });
    console.log('Canister upgrade output:', stdout);
  } catch (error) {
    console.error('Error upgrading canister:', error);
    throw new Error(`Failed to upgrade canister: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Deploys the canister to the local replica and returns the canister ID, with Gemini fallback on syntax error
 */
async function deployToReplica(projectDir: string, canisterName: string, projectPath: string): Promise<string> {
  try {
    vscode.window.showInformationMessage('Deploying canister to local replica...');

    const moFile = path.join(projectDir, 'src', canisterName, 'main.mo');
    const mocPath = `${os.homedir()}/.cache/dfinity/versions/0.25.0/moc`;

    // Pre-check: Validate Motoko file syntax with moc
    try {
      const { stdout, stderr } = await execPromise(`"${mocPath}" "${moFile}" --check`, { cwd: projectDir });
      console.log('Motoko syntax check output:', stdout);
      if (stderr) console.error('Motoko syntax check stderr:', stderr);
    } catch (mocError) {
      console.error('Motoko syntax check failed:', mocError);

      // Read the faulty Motoko file
      const faultyMoContent = await fsPromises.readFile(moFile, 'utf8');
      console.log('Faulty Motoko content:', faultyMoContent);

      // Call Gemini as a fallback with examples
      const fallbackPrompt = `
INSTRUCTIONS:
The following Motoko file has a syntax error and failed to compile with the error:
"${mocError instanceof Error ? mocError.message : String(mocError)}"
Your task is to fix the Motoko code while keeping the function names and functionality the same.
Below is the faulty code and examples of valid Motoko files from ICP documentation for reference.

FAULTY MOTOKO CODE:
\`\`\`motoko
${faultyMoContent}
\`\`\`

EXAMPLES OF VALID MOTOKO FILES FROM ICP DOCS:
1. Simple Hello World:
\`\`\`motoko
actor HelloWorld {
  // We store the greeting in a stable variable such that it gets persisted over canister upgrades.
  stable var greeting : Text = "Hello, ";

  // This update method stores the greeting prefix in stable memory.
  public func setGreeting(prefix : Text) : async () {
    greeting := prefix;
  };

  // This query method returns the currently persisted greeting with the given name.
  public query func greet(name : Text) : async Text {
    return greeting # name # "!";
  };
};
\`\`\`

2. Token Transfer To:
\`\`\`motoko
import Icrc1Ledger "canister:icrc1_ledger_canister";
import Debug "mo:base/Debug";
import Result "mo:base/Result";
import Error "mo:base/Error";

actor {

  type TransferArgs = {
    amount : Nat;
    toAccount : Icrc1Ledger.Account;
  };

  public shared func transfer(args : TransferArgs) : async Result.Result<Icrc1Ledger.BlockIndex, Text> {
    Debug.print(
      "Transferring "
      # debug_show (args.amount)
      # " tokens to account"
      # debug_show (args.toAccount)
    );

    let transferArgs : Icrc1Ledger.TransferArg = {
      // can be used to distinguish between transactions
      memo = null;
      // the amount we want to transfer
      amount = args.amount;
      // we want to transfer tokens from the default subaccount of the canister
      from_subaccount = null;
      // if not specified, the default fee for the canister is used
      fee = null;
      // the account we want to transfer tokens to
      to = args.toAccount;
      // a timestamp indicating when the transaction was created by the caller; if it is not specified by the caller then this is set to the current ICP time
      created_at_time = null;
    };

    try {
      // initiate the transfer
      let transferResult = await Icrc1Ledger.icrc1_transfer(transferArgs);

      // check if the transfer was successfull
      switch (transferResult) {
        case (#Err(transferError)) {
          return #err("Couldn't transfer funds:\n" # debug_show (transferError));
        };
        case (#Ok(blockIndex)) { return #ok blockIndex };
      };
    } catch (error : Error) {
      // catch any errors that might occur during the transfer
      return #err("Reject message: " # Error.message(error));
    };
  };
};
\`\`\`


3. Token Transfer From:
\`\`\`motoko
import Icrc1Ledger "canister:icrc1_ledger_canister";
import Debug "mo:base/Debug";
import Result "mo:base/Result";
import Error "mo:base/Error";

actor {

  type TransferArgs = {
    amount : Nat;
    toAccount : Icrc1Ledger.Account;
  };

  public shared ({ caller }) func transfer(args : TransferArgs) : async Result.Result<Icrc1Ledger.BlockIndex, Text> {
    Debug.print(
      "Transferring "
      # debug_show (args.amount)
      # " tokens to account"
      # debug_show (args.toAccount)
    );

    let transferFromArgs : Icrc1Ledger.TransferFromArgs = {
      // the account we want to transfer tokens from (in this case we assume the caller approved the canister to spend funds on their behalf)
      from = {
        owner = caller;
        subaccount = null;
      };
      // can be used to distinguish between transactions
      memo = null;
      // the amount we want to transfer
      amount = args.amount;
      // the subaccount we want to spend the tokens from (in this case we assume the default subaccount has been approved)
      spender_subaccount = null;
      // if not specified, the default fee for the canister is used
      fee = null;
      // we take the principal and subaccount from the arguments and convert them into an account identifier
      to = args.toAccount;
      // a timestamp indicating when the transaction was created by the caller; if it is not specified by the caller then this is set to the current ICP time
      created_at_time = null;
    };

    try {
      // initiate the transfer
      let transferFromResult = await Icrc1Ledger.icrc2_transfer_from(transferFromArgs);

      // check if the transfer was successfull
      switch (transferFromResult) {
        case (#Err(transferError)) {
          return #err("Couldn't transfer funds:\n" # debug_show (transferError));
        };
        case (#Ok(blockIndex)) { return #ok blockIndex };
      };
    } catch (error : Error) {
      // catch any errors that might occur during the transfer
      return #err("Reject message: " # Error.message(error));
    };
  };
};
\`\`\`

4. ICP Transfer:
\`\`\`motoko
import IcpLedger "canister:icp_ledger_canister";
import Debug "mo:base/Debug";
import Result "mo:base/Result";
import Error "mo:base/Error";
import Principal "mo:base/Principal";

actor {
  type Tokens = {
    e8s : Nat64;
  };

  type TransferArgs = {
    amount : Tokens;
    toPrincipal : Principal;
    toSubaccount : ?IcpLedger.SubAccount;
  };

  public shared func transfer(args : TransferArgs) : async Result.Result<IcpLedger.BlockIndex, Text> {
    Debug.print(
      "Transferring "
      # debug_show (args.amount)
      # " tokens to principal "
      # debug_show (args.toPrincipal)
      # " subaccount "
      # debug_show (args.toSubaccount)
    );

    let transferArgs : IcpLedger.TransferArgs = {
      // can be used to distinguish between transactions
      memo = 0;
      // the amount we want to transfer
      amount = args.amount;
      // the ICP ledger charges 10_000 e8s for a transfer
      fee = { e8s = 10_000 };
      // we are transferring from the canisters default subaccount, therefore we don't need to specify it
      from_subaccount = null;
      // we take the principal and subaccount from the arguments and convert them into an account identifier
      to = Principal.toLedgerAccount(args.toPrincipal, args.toSubaccount);
      // a timestamp indicating when the transaction was created by the caller; if it is not specified by the caller then this is set to the current ICP time
      created_at_time = null;
    };

    try {
      // initiate the transfer
      let transferResult = await IcpLedger.transfer(transferArgs);

      // check if the transfer was successfull
      switch (transferResult) {
        case (#Err(transferError)) {
          return #err("Couldn't transfer funds:\n" # debug_show (transferError));
        };
        case (#Ok(blockIndex)) { return #ok blockIndex };
      };
    } catch (error : Error) {
      // catch any errors that might occur during the transfer
      return #err("Reject message: " # Error.message(error));
    };
  };
};
\`\`\`

6. Counter:
\`\`\`motoko
actor {

  stable var counter : Nat = 0;

  public func increment() : async Nat {
    counter += 1;
    return counter;
  };

  public func decrement() : async Nat {
    // avoid trap due to Natural subtraction underflow
    if(counter != 0) {
      counter -= 1;
    };
    return counter;
  };

  public query func getCount() : async Nat {
    return counter;
  };

  public func reset() : async Nat {
    counter := 0;
    return counter;
  };
};
\`\`\`

7. Simple Data Operations:
\`\`\`motoko
actor {
  public func saveData(data : Text) : async Text {
    return "Saving: " # data;
  };
  public func deleteData(id : Text) : async Text {
    return "Deleting: " # id;
  };
};
\`\`\` 


OUTPUT REQUIREMENTS:
- Return a corrected version of the Motoko code in MULTI-LINE format with 2-space indentation.
- Keep the original function names and their functionality intact.
- Output in VALID JSON format with this exact key:
  - canisterCode: The corrected Motoko code

`;

      // Call Gemini to fix the code
      const { canisterCode } = await generateCanisterAndModifyCode(fallbackPrompt, undefined, false, canisterName);
      console.log('Corrected Motoko code from Gemini:', canisterCode);

      // Write the corrected code back to main.mo
      await fsPromises.writeFile(moFile, canisterCode, 'utf8');

      // Re-check the corrected file
      try {
        const { stdout, stderr } = await execPromise(`"${mocPath}" "${moFile}" --check`, { cwd: projectDir });
        console.log('Corrected Motoko syntax check output:', stdout);
        if (stderr) console.error('Corrected Motoko syntax check stderr:', stderr);
      } catch (retryError) {
        throw new Error(`Failed to validate corrected Motoko file ${moFile}: ${retryError instanceof Error ? retryError.message : String(retryError)}`);
      }
    }

    // Deploy with detailed output
    const deployProcess = spawn('dfx', ['deploy', '--verbose'], { cwd: projectDir, shell: true });
    let deployOutput = '';
    let deployError = '';

    deployProcess.stdout.on('data', (data) => {
      deployOutput += data.toString();
      console.log('dfx deploy output:', data.toString());
    });

    deployProcess.stderr.on('data', (data) => {
      deployError += data.toString();
      console.error('dfx deploy error:', data.toString());
    });

    const deployExitCode = await new Promise<number>((resolve) => {
      deployProcess.on('close', (code) => resolve(code ?? 1));
      deployProcess.on('error', (err) => {
        console.error('Deploy process error:', err);
        resolve(1);
      });
    });

    if (deployExitCode !== 0) {
      throw new Error(`Deployment failed with exit code ${deployExitCode}. Output: ${deployOutput}\nError: ${deployError}`);
    }

    const { stdout: idOutput } = await execPromise(`dfx canister id ${canisterName}`, { cwd: projectDir });
    const canisterId = idOutput.trim();
    vscode.window.showInformationMessage(`Canister deployed with ID: ${canisterId}`);
    return canisterId;
  } catch (error) {
    console.error('Deployment error:', error);
    throw new Error(`Failed to deploy canister: ${error instanceof Error ? error.message : String(error)}`);
  }
}