import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { analyzeCode } from './analyzer';
import { generateCanisterAndModifyCode } from './generator';
import { deployCanister } from './deployer';
import { promptForFileSelection, promptForFunctionalityFocus, SelectedFile } from './provider';

// Global canister name to use for all conversions in a session
const CANISTER_NAME = "MainCanister";

export function activate(context: vscode.ExtensionContext) {
  console.log('ICP Web2 to Web3 extension is now active!');

  let disposable = vscode.commands.registerCommand('icp-web2-to-web3.convert', async () => {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open!');
        return;
      }

      // Ask user if they want to select specific files
      const useFileSelection = await vscode.window.showQuickPick(['Use current file', 'Select files'], {
        placeHolder: 'Choose file source for conversion'
      });
      
      if (!useFileSelection) {
        return; // User cancelled
      }
      
      let selectedFiles: SelectedFile[] = [];
      
      if (useFileSelection === 'Select files') {
        const files = await promptForFileSelection(workspaceFolder);
        if (!files || files.length === 0) {
          vscode.window.showInformationMessage('No files selected, operation cancelled.');
          return;
        }
        selectedFiles = files;
      } else {
        // Use current file
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

      // Prompt for specific functionality
      const functionalityFocus = await promptForFunctionalityFocus();
      
      // Show progress while processing
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Converting ${selectedFiles.length} file(s) to Web3 for ICP...`,
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 10, message: 'Analyzing all files...' });
          
          // First, analyze all files to ensure they have functions
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
            // Add file comment and content to combined code
            combinedCode += `// From file: ${file.filename}\n${web2Code}\n\n`;
          }
          
          if (validFiles.length === 0) {
            vscode.window.showErrorMessage('No functions found in any of the selected files.');
            return;
          }
          
          progress.report({ increment: 30, message: 'Generating consolidated canister...' });
          
          // Always use the consistent canister name
          const fixedCanisterName = CANISTER_NAME;
          
          // Check if the canister file already exists
          const existingCanisterContent = await getExistingCanisterContent(workspaceFolder.uri.fsPath, fixedCanisterName);
          
          // Generate a single canister for all files
          const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(
            combinedCode,
            functionalityFocus,
            true, // Indicate this is a consolidated canister
            existingCanisterContent ? fixedCanisterName : undefined // Pass existing canister name if it exists
          );
          
          // Save the canister file (overwriting if exists)
          const srcDir = path.join(workspaceFolder.uri.fsPath, 'src');
          await fs.promises.mkdir(srcDir, { recursive: true });
          
          const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${fixedCanisterName}.mo`);
          await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));
          
          progress.report({ increment: 40, message: 'Deploying canister...' });

          try {
            // Deploy the single canister
            const canisterId = await deployCanister(fixedCanisterName, workspaceFolder.uri.fsPath);
            
            progress.report({ increment: 50, message: 'Updating client code...' });
            
            // Now we need to update each selected file with the appropriate client code
            let processedCount = 0;
            const totalFiles = validFiles.length;
            
            for (const file of validFiles) {
              // We need to re-analyze each file individually to generate appropriate client code
              const singleFileResult = await generateCanisterAndModifyCode(
                file.content,
                functionalityFocus,
                false, // Not consolidated for individual file client code
                fixedCanisterName, // Use the fixed canister name for all files
                canisterId   // Use the same canister ID for all files
              );
              
              // Find or open the file to update the Web2 code
              let document = await findOrOpenDocument(file.path);
              
              if (document) {
                const edit = new vscode.WorkspaceEdit();
                edit.replace(
                  document.uri,
                  new vscode.Range(0, 0, document.lineCount, 0),
                  singleFileResult.modifiedWeb2Code
                );
                await vscode.workspace.applyEdit(edit);
              }
              
              processedCount++;
              progress.report({ 
                increment: (50 / totalFiles), 
                message: `${processedCount}/${totalFiles} files updated` 
              });
            }
          
            progress.report({ increment: 100, message: 'Conversion complete!' });
            vscode.window.showInformationMessage(
              `Created single canister "${fixedCanisterName}" (${canisterId}) with all functions. ${processedCount} file(s) updated.`
            );
          } catch (deployError) {
            vscode.window.showErrorMessage(`Deployment failed: ${deployError instanceof Error ? deployError.message : String(deployError)}`);
            throw deployError;
          }
        }
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error: ${errorMessage}`);
    }
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
      return fs.readFileSync(filePath, 'utf8');
    }
    return null;
  } catch (error) {
    console.log('No existing canister file found:', error);
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