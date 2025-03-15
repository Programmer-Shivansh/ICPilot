import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface FileInfo {
    label: string;
    description: string;
    path: string;
}

/**
 * Lists JavaScript/TypeScript files in the workspace
 */
export async function listJavaScriptFiles(workspaceFolder: vscode.WorkspaceFolder): Promise<FileInfo[]> {
    const files: FileInfo[] = [];
    
    // Get all JS/TS files in the workspace
    const jsFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(workspaceFolder, '**/*.{js,ts}'),
        new vscode.RelativePattern(workspaceFolder, '**/node_modules/**')
    );
    
    for (const file of jsFiles) {
        const relativePath = path.relative(workspaceFolder.uri.fsPath, file.fsPath);
        files.push({
            label: path.basename(file.fsPath),
            description: relativePath,
            path: file.fsPath
        });
    }
    
    return files;
}

/**
 * Prompts the user to select a file to convert
 */
export async function promptForFileSelection(workspaceFolder: vscode.WorkspaceFolder): Promise<string | undefined> {
    const fileInfos = await listJavaScriptFiles(workspaceFolder);
    
    if (fileInfos.length === 0) {
        vscode.window.showInformationMessage('No JavaScript/TypeScript files found in workspace.');
        return undefined;
    }
    
    // Include an option to use the current file
    const currentFileOption: vscode.QuickPickItem = {
        label: "$(file-code) Use current file",
        description: "Convert the currently open file"
    };
    
    const options = [currentFileOption, ...fileInfos];
    
    const selection = await vscode.window.showQuickPick(options, {
        placeHolder: 'Select a file to convert or use current file',
        ignoreFocusOut: true
    });
    
    if (!selection) {
        return undefined;
    }
    
    if (selection === currentFileOption) {
        const editor = vscode.window.activeTextEditor;
        return editor ? editor.document.getText() : undefined;
    } else {
        const fileInfo = selection as FileInfo;
        return fs.readFileSync(fileInfo.path, 'utf8');
    }
}

/**
 * Prompts the user to specify which functionality to focus on
 */
export async function promptForFunctionalityFocus(): Promise<string | undefined> {
    return vscode.window.showInputBox({
        placeHolder: 'Specify functionality to focus on (optional)',
        prompt: 'Enter specific functions or features to convert (leave blank for full conversion)',
        ignoreFocusOut: true
    });
}
