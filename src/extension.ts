import * as vscode from 'vscode';
import * as path from 'path';
import { analyzeCode } from './analyzer';
import { generateCanisterAndModifyCode } from './generator';
import { deployCanister } from './deployer';
import { promptForFileSelection, promptForFunctionalityFocus, SelectedFile } from './provider';

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
          let processedCount = 0;
          
          for (const file of selectedFiles) {
            progress.report({ 
              increment: (100 / selectedFiles.length) * 0.1, 
              message: `Analyzing ${file.filename}...` 
            });
            
            const web2Code = file.content;
            const analysis = analyzeCode(web2Code);

            if (!analysis.hasFunctions) {
              vscode.window.showInformationMessage(`No functions found in ${file.filename}. Skipping.`);
              processedCount++;
              continue;
            }

            progress.report({ 
              increment: (100 / selectedFiles.length) * 0.3, 
              message: `Generating canister for ${file.filename}...` 
            });

            // Generate canister and modify Web2 code
            const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(
              web2Code, 
              functionalityFocus
            );

            // Save the canister file
            const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${canisterName}.mo`);
            await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));

            // Find or open the file to update the Web2 code
            let document = await findOrOpenDocument(file.path);
            
            if (document) {
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                modifiedWeb2Code
              );
              await vscode.workspace.applyEdit(edit);
            }

            progress.report({ 
              increment: (100 / selectedFiles.length) * 0.4, 
              message: `Deploying canister for ${file.filename}...` 
            });

            // Deploy the canister
            const canisterId = await deployCanister(canisterName, workspaceFolder.uri.fsPath);

            // Update Web2 code with canister ID
            if (document) {
              const finalWeb2Code = modifiedWeb2Code.replace('CANISTER_ID', canisterId);
              const edit = new vscode.WorkspaceEdit();
              edit.replace(
                document.uri,
                new vscode.Range(0, 0, document.lineCount, 0),
                finalWeb2Code
              );
              await vscode.workspace.applyEdit(edit);
            }

            processedCount++;
            progress.report({ 
              increment: (100 / selectedFiles.length) * 0.2, 
              message: `${processedCount}/${selectedFiles.length} files processed` 
            });
          }

          progress.report({ increment: 100, message: 'Conversion complete!' });
          vscode.window.showInformationMessage(`${processedCount} file(s) converted successfully to Web3 for ICP.`);
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