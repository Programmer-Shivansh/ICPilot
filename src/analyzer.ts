import * as esprima from 'esprima';

export function analyzeCode(code: string): { hasFunctions: boolean; functionNames: string[] } {
  try {
    const ast = esprima.parseScript(code);
    const functionNames: string[] = [];

    function traverse(node: any) {
      if (node.type === 'FunctionDeclaration') {
        functionNames.push(node.id.name);
      }
      for (const key in node) {
        if (node[key] && typeof node[key] === 'object') {
          traverse(node[key]);
        }
      }
    }

    traverse(ast);
    return { hasFunctions: functionNames.length > 0, functionNames };
  } catch (error) {
    console.error('Error analyzing code:', error);
    return { hasFunctions: false, functionNames: [] };
  }
}