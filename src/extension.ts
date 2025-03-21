import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeCode } from './analyzer';
import { generateCanisterAndModifyCode } from './generator';
import { deployCanister } from './deployer';
import { promptForFileSelection, promptForFunctionalityFocus, SelectedFile } from './provider';
import { checkDfxStatus, DfxStatus, showDfxFixInstructions } from './dfx-setup';
import { installDfxSdk, verifyDfxInstallation } from './dfx-installer';

// Global canister name to use for all conversions in a session
const CANISTER_NAME = "MainCanister";

export function activate(context: vscode.ExtensionContext) {
  console.log('ICP Web2 to Web3 extension is now active!');

  // Add a command to check and fix DFX environment
  const checkDfxCmd = vscode.commands.registerCommand('icpilot-web2-to-web3.checkDfx', async () => {
    vscode.window.showInformationMessage('Checking DFX installation...');
    const status = await checkDfxStatus();
    
    switch (status) {
      case DfxStatus.FullyInstalled:
        vscode.window.showInformationMessage('DFX is properly installed with all required packages.');
        break;
      case DfxStatus.InstalledButMissingPackages:
        await showDfxFixInstructions();
        break;
      case DfxStatus.NotInstalled:
        vscode.window.showErrorMessage(
          'DFX is not installed. Install it from https://internetcomputer.org/docs/current/developer-docs/setup/install/',
          'Open Installation Guide'
        ).then(selection => {
          if (selection === 'Open Installation Guide') {
            vscode.env.openExternal(vscode.Uri.parse('https://internetcomputer.org/docs/current/developer-docs/setup/install/'));
          }
        });
        break;
    }
  });
  
  context.subscriptions.push(checkDfxCmd);

  // Existing convert command
  let disposable = vscode.commands.registerCommand('icpilot-web2-to-web3.convert', async () => {
    // Check DFX status first
    const status = await checkDfxStatus();
    if (status === DfxStatus.InstalledButMissingPackages) {
      const fix = await vscode.window.showWarningMessage(
        'DFX is installed but missing required packages. Fix before proceeding?',
        'Fix Now',
        'Continue Anyway'
      );
      
      if (fix === 'Fix Now') {
        await showDfxFixInstructions();
        return;
      }
      // else continue with deployment
    } else if (status === DfxStatus.NotInstalled) {
      const selection = await vscode.window.showErrorMessage(
        'DFX is not installed. You need the DFINITY SDK to deploy canisters.',
        'Install Automatically',
        'Open Installation Guide',
        'Cancel'
      );
      
      if (selection === 'Install Automatically') {
        try {
          await vscode.window.withProgress(
            {
              location: vscode.ProgressLocation.Notification,
              title: 'Installing DFX...',
              cancellable: false
            },
            async (progress) => {
              progress.report({ message: 'Starting DFX installation...' });
              await installDfxSdk();
              progress.report({ message: 'DFX installation completed successfully!' });
            }
          );
          
          // Verify installation worked
          const installed = await verifyDfxInstallation();
          if (installed) {
            vscode.window.showInformationMessage('DFX has been successfully installed. Continuing with conversion...');
            // Continue with conversion without returning
          } else {
            const continueAnyway = await vscode.window.showWarningMessage(
              'DFX installation completed but verification failed. This might be due to environment variables not being fully updated.',
              'Continue Anyway',
              'Cancel'
            );
            if (continueAnyway !== 'Continue Anyway') {
              return;
            }
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Failed to install DFX: ${errorMessage}`);
          return;
        }
      } else if (selection === 'Open Installation Guide') {
        vscode.env.openExternal(vscode.Uri.parse('https://internetcomputer.org/docs/current/developer-docs/setup/install/'));
        return;
      } else {
        // User clicked Cancel
        return;
      }
    }

    // Rest of the existing convert command implementation
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      vscode.window.showErrorMessage('No workspace folder open!');
      return;
    }

    const useFileSelection = await vscode.window.showQuickPick(['Use current file', 'Select files'], {
      placeHolder: 'Choose file source for conversion'
    });

    if (!useFileSelection) return;

    let selectedFiles: SelectedFile[] = [];
    if (useFileSelection === 'Select files') {
      const files = await promptForFileSelection(workspaceFolder);
      if (!files || files.length === 0) {
        vscode.window.showInformationMessage('No files selected, operation cancelled.');
        return;
      }
      selectedFiles = files;
    } else {
      const currentEditor = vscode.window.activeTextEditor;
      if (!currentEditor) {
        vscode.window.showErrorMessage('No active editor found!');
        return;
      }
      selectedFiles = [{
        content: currentEditor.document.getText(),
        path: currentEditor.document.uri.fsPath,
        filename: path.basename(currentEditor.document.uri.fsPath)
      }];
    }

    const functionalityFocus = await promptForFunctionalityFocus();

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Converting ${selectedFiles.length} file(s) to Web3 for ICP...`,
        cancellable: false,
      },
      async (progress) => {
        try {
          progress.report({ increment: 10, message: 'Analyzing all files...' });
          const validFiles: SelectedFile[] = [];
          let combinedCode = '';
          for (const file of selectedFiles) {
            const web2Code = file.content;
            const analysis = analyzeCode(web2Code);
            if (!analysis.hasFunctions) {
              vscode.window.showInformationMessage(`No functions found in ${file.filename}. Skipping.`);
              continue;
            }
            validFiles.push(file);
            combinedCode += `// From file: ${file.filename}\n${web2Code}\n\n`;
          }

          if (validFiles.length === 0) {
            vscode.window.showErrorMessage('No functions found in any of the selected files.');
            return;
          }

          progress.report({ increment: 30, message: 'Generating consolidated canister...' });
          const fixedCanisterName = CANISTER_NAME;
          const existingCanisterContent = await getExistingCanisterContent(workspaceFolder.uri.fsPath, fixedCanisterName);

          // Log if we're updating or creating a new canister
          if (existingCanisterContent) {
            console.log(`Found existing canister code (${existingCanisterContent.length} bytes). Updating...`);
            progress.report({ message: 'Updating existing canister...' });
          } else {
            console.log('No existing canister found. Creating new one...');
            progress.report({ message: 'Creating new canister...' });
          }

          // Pass existingCanisterContent to be merged, not replaced
          const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(
            combinedCode,
            functionalityFocus,
            true,
            existingCanisterContent ? fixedCanisterName : undefined,
            undefined, // No canisterId yet
            existingCanisterContent // Pass existing canister code
          );

          const srcDir = path.join(workspaceFolder.uri.fsPath, 'src');
          await fs.promises.mkdir(srcDir, { recursive: true });
          const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${fixedCanisterName}.mo`);
          await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));

          progress.report({ increment: 50, message: 'Deploying canister...' });
          const canisterId = await deployCanister(fixedCanisterName, workspaceFolder.uri.fsPath);
          console.log(`Deployed canister with ID: ${canisterId}`);

          progress.report({ increment: 70, message: 'Updating client code...' });
          let processedCount = 0;
          const totalFiles = validFiles.length;
          for (const file of validFiles) {
            // Pass the canister ID to the generator function
            console.log(`Generating code for ${file.filename} with canister ID: ${canisterId}`);
            const singleFileResult = await generateCanisterAndModifyCode(
              file.content,
              functionalityFocus,
              false,
              fixedCanisterName,
              canisterId
            );
            
            // Check for duplicate canister ID declarations
            const canisterIdMatches = (singleFileResult.modifiedWeb2Code.match(/const\s+canisterId\s*=|let\s+canisterId\s*=|var\s+canisterId\s*=/g) || []).length;
            if (canisterIdMatches > 1) {
              console.warn(`Found ${canisterIdMatches} canister ID declarations in generated code. Fixing...`);
              // Remove all but the first canister ID declaration
              const firstDeclaration = singleFileResult.modifiedWeb2Code.match(/(const|let|var)\s+canisterId\s*=\s*["'][^"']*["'];/);
              if (firstDeclaration) {
                const restOfCode = singleFileResult.modifiedWeb2Code.replace(/(const|let|var)\s+canisterId\s*=\s*["'][^"']*["'];/g, '');
                singleFileResult.modifiedWeb2Code = `${firstDeclaration[0]}\n\n${restOfCode}`;
              }
            }
            
            // Check if the canister ID is in the modified code
            const canisterIdIncluded = singleFileResult.modifiedWeb2Code.includes(canisterId);
            console.log(`Canister ID ${canisterId} included in modified code: ${canisterIdIncluded}`);
            
            let document = await findOrOpenDocument(file.path);
            if (document) {
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                singleFileResult.modifiedWeb2Code
              );
              await vscode.workspace.applyEdit(edit);
              
              // Double-check the updated content
              document = await vscode.workspace.openTextDocument(document.uri);
              const updatedContent = document.getText();
              const canisterIdVerified = updatedContent.includes(canisterId);
              console.log(`Verified canister ID in updated document: ${canisterIdVerified}`);
            }
            processedCount++;
            progress.report({
              increment: (20 / totalFiles),
              message: `${processedCount}/${totalFiles} files updated with canister ID: ${canisterId}`
            });
          }

          progress.report({ increment: 100, message: 'Conversion complete!' });
          vscode.window.showInformationMessage(
            `Created single canister "${fixedCanisterName}" (${canisterId}) with all functions. ${processedCount} file(s) updated.`
          );
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          vscode.window.showErrorMessage(`Error: ${errorMessage}`);
          if (errorMessage.includes('DFX installation failed')) {
            vscode.window.showErrorMessage(
              'DFX installation failed. Please install manually following the official guide.',
              'Open Installation Guide'
            ).then(selection => {
              if (selection === 'Open Installation Guide') {
                vscode.env.openExternal(vscode.Uri.parse('https://internetcomputer.org/docs/current/developer-docs/setup/install/'));
              }
            });
          }
        }
      }
    );
  });

  context.subscriptions.push(disposable);
}
/**
 * Gets the content of an existing canister file if it exists
 */
async function getExistingCanisterContent(projectPath: string, canisterName: string): Promise<string | null> {
  try {
    const filePath = path.join(projectPath, 'src', `${canisterName}.mo`);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf8');
      console.log(`Found existing canister at ${filePath}, ${content.length} bytes`);
      return content;
    }
    console.log(`No existing canister found at ${filePath}`);
    return null;
  } catch (error) {
    console.log('Error reading existing canister file:', error);
    return null;
  }
}

/**
 * Finds an existing document or opens a new one
 */
async function findOrOpenDocument(filePath: string): Promise<vscode.TextDocument | undefined> {
  // Check if document is already open
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.fsPath === filePath) {
      return doc;
    }
  }
  
  // Open the document if it's not already open
  try {
    const uri = vscode.Uri.file(filePath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
    return doc;
  } catch (error) {
    console.error(`Error opening document ${filePath}:`, error);
    return undefined;
  }
}

export function deactivate() {}