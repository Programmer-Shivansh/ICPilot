import * as vscode from 'vscode';
import { analyzeCode } from './analyzer';
import { generateCanisterAndModifyCode } from './generator';
import { deployCanister } from './deployer';
import { promptForFileSelection, promptForFunctionalityFocus } from './provider';

export function activate(context: vscode.ExtensionContext) {
  console.log('ICP Web2 to Web3 extension is now active!');

  let disposable = vscode.commands.registerCommand('icp-web2-to-web3.convert', async () => {
    try {
      const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        vscode.window.showErrorMessage('No workspace folder open!');
        return;
      }

      // Ask user if they want to select a specific file
      const useFileSelection = await vscode.window.showQuickPick(['Use current file', 'Select a file'], {
        placeHolder: 'Choose file source for conversion'
      });
      
      if (!useFileSelection) {
        return; // User cancelled
      }
      
      let web2Code: string;
      let currentEditor = vscode.window.activeTextEditor;
      
      if (useFileSelection === 'Select a file') {
        const selectedCode = await promptForFileSelection(workspaceFolder);
        if (!selectedCode) {
          vscode.window.showInformationMessage('No file selected, operation cancelled.');
          return;
        }
        web2Code = selectedCode;
        
        // Create a new document for the selected file if it's not already open
        if (!currentEditor) {
          const doc = await vscode.workspace.openTextDocument({
            content: web2Code,
            language: 'javascript'
          });
          currentEditor = await vscode.window.showTextDocument(doc);
        }
      } else {
        // Use current file
        if (!currentEditor) {
          vscode.window.showErrorMessage('No active editor found!');
          return;
        }
        web2Code = currentEditor.document.getText();
      }

      // Prompt for specific functionality
      const functionalityFocus = await promptForFunctionalityFocus();
      
      const analysis = analyzeCode(web2Code);

      if (!analysis.hasFunctions) {
        vscode.window.showInformationMessage('No functions found to convert. Please provide code with functions.');
        return;
      }

      // Show progress while processing
      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Converting Web2 to Web3 for ICP...',
          cancellable: false,
        },
        async (progress) => {
          progress.report({ increment: 10, message: 'Analyzing code...' });

          // Generate canister and modify Web2 code
          const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(
            web2Code, 
            functionalityFocus
          );
          progress.report({ increment: 40, message: 'Generating canister and modifying code...' });

          // Save the canister file
          const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${canisterName}.mo`);
          await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));

          // Update the Web2 code in the editor
          if (currentEditor) {
            await currentEditor.edit((editBuilder) => {
              editBuilder.replace(
                new vscode.Range(0, 0, currentEditor!.document.lineCount, 0),
                modifiedWeb2Code
              );
            });
          }

          progress.report({ increment: 70, message: 'Deploying canister...' });

          // Deploy the canister
          const canisterId = await deployCanister(canisterName, workspaceFolder.uri.fsPath);

          // Update Web2 code with canister ID
          const finalWeb2Code = modifiedWeb2Code.replace('CANISTER_ID', canisterId);
          if (currentEditor) {
            await currentEditor.edit((editBuilder) => {
              editBuilder.replace(
                new vscode.Range(0, 0, currentEditor!.document.lineCount, 0),
                finalWeb2Code
              );
            });
          }

          progress.report({ increment: 100, message: 'Conversion complete!' });
          vscode.window.showInformationMessage(`Canister deployed at ${canisterId}. Web2 code updated!`);
        }
      );
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      vscode.window.showErrorMessage(`Error: ${errorMessage}`);
    }
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}