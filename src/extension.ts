import * as vscode from 'vscode';
import { analyzeCode } from './analyzer';
import { generateCanisterAndModifyCode } from './generator';
import { deployCanister } from './deployer';

export function activate(context: vscode.ExtensionContext) {
  console.log('ICP Web2 to Web3 extension is now active!');

  let disposable = vscode.commands.registerCommand('icp-web2-to-web3.convert', async () => {
    try {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showErrorMessage('No active editor found!');
        return;
      }

      const web2Code = editor.document.getText();
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
          const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(web2Code);
          progress.report({ increment: 40, message: 'Generating canister and modifying code...' });

          // Save the canister file
          const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
          if (!workspaceFolder) {
            throw new Error('No workspace folder open!');
          }
          const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${canisterName}.mo`);
          await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));

          // Update the Web2 code in the editor
          await editor.edit((editBuilder) => {
            editBuilder.replace(
              new vscode.Range(0, 0, editor.document.lineCount, 0),
              modifiedWeb2Code
            );
          });

          progress.report({ increment: 70, message: 'Deploying canister...' });

          // Deploy the canister
          const canisterId = await deployCanister(canisterName, workspaceFolder.uri.fsPath);

          // Update Web2 code with canister ID
          const finalWeb2Code = modifiedWeb2Code.replace('CANISTER_ID', canisterId);
          await editor.edit((editBuilder) => {
            editBuilder.replace(
              new vscode.Range(0, 0, editor.document.lineCount, 0),
              finalWeb2Code
            );
          });

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