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
          const { canisterCode, modifiedWeb2Code, canisterName } = await generateCanisterAndModifyCode(
            combinedCode,
            functionalityFocus,
            true,
            existingCanisterContent ? fixedCanisterName : undefined
          );

          const srcDir = path.join(workspaceFolder.uri.fsPath, 'src');
          await fs.promises.mkdir(srcDir, { recursive: true });
          const canisterUri = vscode.Uri.joinPath(workspaceFolder.uri, 'src', `${fixedCanisterName}.mo`);
          await vscode.workspace.fs.writeFile(canisterUri, new TextEncoder().encode(canisterCode));

          progress.report({ increment: 50, message: 'Deploying canister...' });
          const canisterId = await deployCanister(fixedCanisterName, workspaceFolder.uri.fsPath);

          progress.report({ increment: 70, message: 'Updating client code...' });
          let processedCount = 0;
          const totalFiles = validFiles.length;
          for (const file of validFiles) {
            const singleFileResult = await generateCanisterAndModifyCode(
              file.content,
              functionalityFocus,
              false,
              fixedCanisterName,
              canisterId
            );
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
              increment: (20 / totalFiles),
              message: `${processedCount}/${totalFiles} files updated`
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