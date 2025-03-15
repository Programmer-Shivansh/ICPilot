import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface FileInfo {
    label: string;
    description: string;
    path: string;
}

export interface SelectedFile {
    content: string;
    path: string;
    filename: string;
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
 * Prompts the user to select one or more files to convert
 * @returns Array of selected files with their content
 */
export async function promptForFileSelection(workspaceFolder: vscode.WorkspaceFolder): Promise<SelectedFile[] | undefined> {
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
        placeHolder: 'Select files to convert (press space to select, enter to confirm)',
        canPickMany: true,
        ignoreFocusOut: true
    });
    
    if (!selection || selection.length === 0) {
        return undefined;
    }
    
    const selectedFiles: SelectedFile[] = [];
    
    // Check if the current file option was selected
    const hasCurrentFileOption = selection.some(item => item === currentFileOption);
    
    if (hasCurrentFileOption) {
        const editor = vscode.window.activeTextEditor;
        if (editor) {
            selectedFiles.push({
                content: editor.document.getText(),
                path: editor.document.uri.fsPath,
                filename: path.basename(editor.document.uri.fsPath)
            });
        }
    }
    
    // Add selected workspace files
    for (const item of selection) {
        if (item !== currentFileOption) {
            const fileInfo = item as FileInfo;
            selectedFiles.push({
                content: fs.readFileSync(fileInfo.path, 'utf8'),
                path: fileInfo.path,
                filename: path.basename(fileInfo.path)
            });
        }
    }
    
    return selectedFiles;
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
