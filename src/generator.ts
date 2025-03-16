import * as recast from 'recast';
import * as esprima from 'esprima';
// import { callGeminiAPI } from './gemini';
import { callGroqAPI } from './groq';

/**
 * Enhanced JSON extraction function to handle various formats and edge cases
 * @param text The input text to parse
 * @returns The parsed JSON object
 */
function extractJsonFromText(text: string): any {
  if (!text || typeof text !== 'string') {
    throw new Error('Input text must be a non-empty string');
  }

  console.log('Attempting to extract JSON from response');
  
  // First try: direct JSON parsing of the entire text
  try {
    return JSON.parse(text);
  } catch (firstError) {
    console.log('Direct JSON parsing failed, trying to find JSON object in text');
  }

  // Second try: Find JSON in markdown code blocks
  const jsonBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonBlockMatch && jsonBlockMatch[1]) {
    try {
      return JSON.parse(jsonBlockMatch[1]);
    } catch (blockError) {
      console.log('JSON parsing from code block failed');
    }
  }

  // Third try: Find anything that looks like a JSON object
  const jsonPattern = /(\{[\s\S]*\})/g;
  const matches = text.match(jsonPattern);
  
  if (matches) {
    for (const potentialJson of matches) {
      try {
        return JSON.parse(potentialJson);
      } catch (matchError) {
        continue; // Try the next match
      }
    }
  }

  // Fourth try: Manual repair of common issues
  let repaired = text
    .replace(/\\n/g, '\\\\n') // Double escape newlines
    .replace(/\\"/g, '\\\\"') // Double escape quotes
    .replace(/(['"])(\\?.)*?\1/g, match => {
      // Fix quotes within strings
      return match.replace(/\\(?!")"/g, '\\\\"');
    });

  try {
    return JSON.parse(repaired);
  } catch (repairError) {
    // Last resort: Try to manually construct a JSON object from the response
    try {
      const canisterCodeMatch = text.match(/["']canisterCode["']\s*:\s*["'](.*?)["']/s);
      const modifiedCodeMatch = text.match(/["']modifiedWeb2Code["']\s*:\s*["'](.*?)["']/s);
      const canisterNameMatch = text.match(/["']canisterName["']\s*:\s*["'](.*?)["']/s);

      if (canisterCodeMatch && modifiedCodeMatch && canisterNameMatch) {
        return {
          canisterCode: canisterCodeMatch[1].replace(/\\"/g, '"'),
          modifiedWeb2Code: modifiedCodeMatch[1].replace(/\\"/g, '"'),
          canisterName: canisterNameMatch[1]
        };
      }
    } catch (lastError) {
      console.error('All JSON extraction methods failed');
    }
  }

  throw new Error(`Could not extract valid JSON from the response: ${text.substring(0, 100)}...`);
}

/**
 * Formats Motoko code into a readable multi-line structure
 */
function formatMotokoCode(code: string): string {
  // Basic formatting: split on key Motoko syntax points and indent
  let formatted = code.trim();
  
  // Replace single-line braces with multi-line structure
  formatted = formatted
    .replace(/actor\s*{/, 'actor {\n')
    .replace(/}\s*;/g, '};')
    .replace(/}/g, '\n}')
    .replace(/;/g, ';\n')
    .replace(/\s*public\s*func/g, '  public func')
    .replace(/:\s*async/g, ' : async')
    .replace(/{\s*return/g, ' {\n    return')
    .replace(/}\s*(public|$)/g, '\n  }\n$1');

  // Ensure proper indentation
  const lines = formatted.split('\n');
  let indentLevel = 0;
  const indentedLines = lines.map(line => {
    if (line.trim().endsWith('}') || line.trim().endsWith('};')) {
      indentLevel = Math.max(0, indentLevel - 1);
    }
    const indent = '  '.repeat(indentLevel);
    if (line.trim().startsWith('public') || line.trim() === '}') {
      return indent + line.trim();
    }
    return indent + line.trim();
  }).filter(line => line.trim().length > 0);

  if (indentedLines.length > 0 && !indentedLines[indentedLines.length - 1].endsWith('}')) {
    indentedLines.push('}');
  }

  return indentedLines.join('\n');
}

/**
 * Creates a detailed prompt for the LLM API with clearer JSON formatting instructions
 */
function createDetailedPrompt(
  web2Code: string, 
  functionalityFocus?: string, 
  isConsolidated = false,
  existingCanisterName?: string,
  existingCanisterId?: string,
  existingCanisterCode?: string | null
): string {
  let focusInstruction = '';
  let consolidatedInstruction = '';
  let canisterIdInstruction = '';
  let existingCodeInstruction = '';
  
  if (functionalityFocus && functionalityFocus.trim()) {
    focusInstruction = `
FOCUS ON THIS SPECIFIC FUNCTIONALITY:
${functionalityFocus}

Only convert the specifically mentioned functionality above. If functions or features not mentioned are required 
for the mentioned functionality to work, include them as well.
`;
  }

  if (isConsolidated) {
    consolidatedInstruction = `
IMPORTANT: This input contains code from multiple files (indicated by file comments).
Create ONE SINGLE CONSOLIDATED canister with name "ConsolidatedCanister" that includes ALL functions from these files.
The canister should be well-structured with clear organization of functions.
`;
  } else if (existingCanisterName) {
    consolidatedInstruction = `
IMPORTANT: A canister named "${existingCanisterName}" already exists that contains all necessary functions.
DO NOT create a new canister. Instead, modify this client code to use the existing canister.
In the modifiedWeb2Code, use the existing canister name (${existingCanisterName}) and DO NOT change the canisterName field.
`;
  }

  if (existingCanisterId) {
    canisterIdInstruction = `
IMPORTANT: Use the exact canister ID "${existingCanisterId}" in the client code. 
Replace any canister ID placeholders with this specific ID.
Set this ONCE as a constant at the top of your file - DO NOT declare it multiple times.
`;
  }

  if (existingCanisterCode) {
    existingCodeInstruction = `
IMPORTANT: The canister "${existingCanisterName || 'MainCanister'}" already exists with the following code.
DO NOT REPLACE THIS CODE. Instead, MERGE your new functions with the existing ones.
KEEP ALL EXISTING FUNCTIONALITY while adding new functions to handle the Web2 code conversion.

EXISTING CANISTER CODE:
\`\`\`motoko
${existingCanisterCode}
\`\`\`
`;
  }

  return `
INSTRUCTIONS:
You are an expert in ICP blockchain and Web2-to-Web3 transitions.
Your task is to REPLACE Web2 JavaScript code with Web3 equivalent using Internet Computer Protocol.
${focusInstruction}
${consolidatedInstruction}
${canisterIdInstruction}
${existingCodeInstruction}

INPUT:
\`\`\`javascript
${web2Code}
\`\`\`

OUTPUT REQUIREMENTS:
1. ${existingCanisterCode ? 'UPDATE the existing Motoko canister by adding new functions to handle the provided Web2 code.' : 'Generate a new Motoko canister that replicates the core functionality of the provided Web2 code.'}
2. TRANSFORM the Web2 JavaScript code to Web3 code that uses the canister via @dfinity/agent.
3. REPLACE Web2 functionality with Web3 equivalents - DO NOT keep both versions in your output.
4. Return a valid JSON object with these exact keys:
   - canisterCode: ${existingCanisterCode ? 'The UPDATED Motoko code that INCLUDES all existing functions plus new ones' : 'The complete Motoko code for the canister'}
   - modifiedWeb2Code: The TRANSFORMED Web2->Web3 JavaScript code that calls the canister
   - canisterName: A descriptive name for the canister

YOUR RESPONSE MUST BE A VALID JSON OBJECT THAT CAN BE PARSED WITH JSON.parse()
DO NOT include any text outside the JSON object.
DO NOT use markdown code blocks in your response.
PROPERLY ESCAPE all quotes and special characters in strings.
For multi-line strings like canisterCode, use explicit \\n for line breaks.

${existingCanisterId ? `IMPORTANT: In the modifiedWeb2Code, declare the canister ID as "const canisterId = \\"${existingCanisterId}\\";" ONCE at the top of your code.` : ''}

EXAMPLE OF EXPECTED RESPONSE FORMAT:
${existingCanisterId ? 
  `{"canisterCode":"actor {\\n  // Existing functions are preserved\\n  public func existingFunction() : async Text {\\n    return \\"I was here before\\";\\n  };\\n\\n  // New function added\\n  public func greet(name: Text) : async Text {\\n    return \\"Hello \\" # name;\\n  };\\n}","modifiedWeb2Code":"import { Actor, HttpAgent } from \\"@dfinity/agent\\";\\nconst canisterId = \\"${existingCanisterId}\\";\\n\\n// Define the interface for our canister\\nconst canisterInterface = {\\n  // Use the canister\\n};\\n\\nconst agent = new HttpAgent();\\nconst greetingCanister = Actor.createActor(canisterInterface, { agent, canisterId });\\n\\n// Transformed Web2 function\\nasync function greetUser(name) {\\n  const greeting = await greetingCanister.greet(name);\\n  return greeting;\\n}","canisterName":"GreeterCanister"}` :
  `{"canisterCode":"actor {\\n  public func greet(name: Text) : async Text {\\n    return \\"Hello \\" # name;\\n  };\\n}","modifiedWeb2Code":"import { Actor, HttpAgent } from \\"@dfinity/agent\\";\\n// rest of code","canisterName":"GreeterCanister"}`
}
`;
}

/**
 * Extract function declarations from Motoko code
 * @param code Motoko code
 * @returns Array of function declarations
 */
function extractMotokoFunctions(code: string): string[] {
  // Find all public func declarations - this is a simple extraction
  // In a real implementation you might need a proper parser
  const functionRegex = /public\s+(?:shared\s+)?(?:query\s+)?func\s+([^{]+){([^}]*)}/g;
  const functions: string[] = [];
  let match;
  
  while ((match = functionRegex.exec(code)) !== null) {
    functions.push(`public ${match[0].substring(6).trim()}`);
  }
  
  return functions;
}

/**
 * Merges existing canister code with new code by preserving existing functions
 * @param existingCode Existing canister code
 * @param newCode New canister code
 * @returns Merged canister code
 */
function mergeCanisterCode(existingCode: string, newCode: string): string {
  // If the AI already did a good job merging, just return the new code
  if (newCode.includes("// Existing functions") || 
      newCode.includes("// existing functions")) {
    return newCode;
  }
  
  // Extract actor declaration from existing code
  const actorMatch = existingCode.match(/actor\s+(?:\w+\s*)?{/);
  if (!actorMatch) return newCode; // If we can't find actor declaration, just use new code
  
  const actorDeclaration = actorMatch[0];
  
  // Extract existing functions
  const existingFunctions = extractMotokoFunctions(existingCode);
  console.log(`Found ${existingFunctions.length} existing functions`);
  
  // Extract new functions
  const newFunctions = extractMotokoFunctions(newCode);
  console.log(`Found ${newFunctions.length} new functions`);
  
  // Create a set of function names to avoid duplicates
  const existingFunctionNames = new Set(existingFunctions.map(f => {
    const nameMatch = f.match(/func\s+(\w+)/);
    return nameMatch ? nameMatch[1] : '';
  }).filter(Boolean));
  
  // Filter out functions that already exist
  const uniqueNewFunctions = newFunctions.filter(f => {
    const nameMatch = f.match(/func\s+(\w+)/);
    const name = nameMatch ? nameMatch[1] : '';
    return name && !existingFunctionNames.has(name);
  });
  
  console.log(`Adding ${uniqueNewFunctions.length} unique new functions`);
  
  // Build the merged code
  let mergedCode = actorDeclaration + '\n';
  
  // Add existing functions
  if (existingFunctions.length > 0) {
    mergedCode += '  // Existing functions\n  ' + existingFunctions.join('\n\n  ') + '\n\n';
  }
  
  // Add new functions
  if (uniqueNewFunctions.length > 0) {
    mergedCode += '  // New functions added\n  ' + uniqueNewFunctions.join('\n\n  ') + '\n';
  }
  
  // Close actor
  mergedCode += '\n}';
  
  return mergedCode;
}

/**
 * Validates if the response object has the required fields and correct types
 */
function validateResponseStructure(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  
  if (!obj.canisterCode || typeof obj.canisterCode !== 'string') return false;
  if (!obj.modifiedWeb2Code || typeof obj.modifiedWeb2Code !== 'string') return false;
  if (!obj.canisterName || typeof obj.canisterName !== 'string') return false;
  
  return true;
}

// ... (rest of generator.ts remains unchanged until generateCanisterAndModifyCode)

export async function generateCanisterAndModifyCode(
  web2Code: string, 
  functionalityFocus?: string,
  isConsolidated = false,
  existingCanisterName?: string,
  existingCanisterId?: string,
  existingCanisterCode?: string | null
): Promise<{
  canisterCode: string;
  modifiedWeb2Code: string;
  canisterName: string;
}> {
  const forcedCanisterName = isConsolidated ? "ConsolidatedCanister" : existingCanisterName;
  let prompt = createDetailedPrompt(
    web2Code, 
    functionalityFocus, 
    isConsolidated, 
    forcedCanisterName, 
    existingCanisterId,
    existingCanisterCode
  );
  
  const MAX_RETRIES = 3;
  let attempt = 0;
  let result: any;
  
  while (attempt < MAX_RETRIES) {
    attempt++;
    console.log(`Attempt ${attempt} to get valid API response`);
    
    try {
      // Request response with clear JSON formatting instructions
      const response = await callGroqAPI(prompt);
      console.log(`Raw API response (attempt ${attempt}) length: ${response.length}`);
      
      try {
        result = extractJsonFromText(response);
        
        if (validateResponseStructure(result)) {
          console.log("Successfully extracted and validated JSON response");
          // Format the canister code for better readability
          result.canisterCode = formatMotokoCode(result.canisterCode);
          break;
        } else {
          console.error("Extracted JSON is missing required fields:", result);
          
          // Try to fix common structure issues
          if (result && typeof result === 'object') {
            if (!result.canisterCode && result.canistercode) {
              result.canisterCode = result.canistercode;
            }
            if (!result.modifiedWeb2Code && result.modifiedweb2code) {
              result.modifiedWeb2Code = result.modifiedweb2code;
            }
            if (!result.canisterName && result.canistername) {
              result.canisterName = result.canistername;
            }
            
            // Check again after corrections
            if (validateResponseStructure(result)) {
              console.log("Fixed JSON structure after case-insensitive key correction");
              result.canisterCode = formatMotokoCode(result.canisterCode);
              break;
            }
          }
          
          if (attempt === MAX_RETRIES) {
            throw new Error("Failed to get valid JSON after maximum retries");
          }
        }
      } catch (jsonError) {
        console.error(`JSON parsing error (attempt ${attempt}):`, jsonError);
        if (attempt === MAX_RETRIES) {
          throw jsonError;
        }
      }
      
      // Simplify the prompt for retry to get cleaner output
      prompt = `
I need you to convert this JavaScript code to an ICP canister. Reply ONLY with a valid JSON object containing:
- canisterCode: Motoko code as a string with \\n for newlines
- modifiedWeb2Code: Modified JavaScript code as a string
- canisterName: Name for the canister

Here is the code to convert:
\`\`\`javascript
${web2Code}
\`\`\`

RETURN ONLY A RAW JSON OBJECT WITH NO FORMATTING OR EXPLANATION:
`;
      
    } catch (apiError) {
      console.error(`API error on attempt ${attempt}:`, apiError);
      if (attempt === MAX_RETRIES) {
        throw apiError;
      }
    }
  }
  
  if (!validateResponseStructure(result)) {
    // Create a fallback minimal result if all else fails
    result = {
      canisterCode: `actor ${forcedCanisterName || "MainCanister"} {\n  // Generated fallback canister\n  public func process(input: Text) : async Text {\n    return "Processed: " # input;\n  };\n}`,
      modifiedWeb2Code: web2Code + "\n\n// TODO: Implement canister integration",
      canisterName: forcedCanisterName || "MainCanister"
    };
  }
  
  // Format and merge the canister code if there's existing code
  if (existingCanisterCode && result.canisterCode) {
    console.log('Merging new canister code with existing code');
    const formattedExistingCode = formatMotokoCode(existingCanisterCode);
    const formattedNewCode = formatMotokoCode(result.canisterCode);
    result.canisterCode = mergeCanisterCode(formattedExistingCode, formattedNewCode);
  } else {
    result.canisterCode = formatMotokoCode(result.canisterCode);
  }
  
  if (forcedCanisterName) {
    result.canisterName = forcedCanisterName;
  }
  
  // Enhanced canister ID replacement with multiple patterns and duplicate detection
  if (existingCanisterId) {
    console.log(`Replacing canister ID placeholders with: ${existingCanisterId}`);
    
    // Check if the code already has a canister ID declaration
    const hasCanisterIdDeclaration = /const\s+canisterId\s*=|let\s+canisterId\s*=|var\s+canisterId\s*=/.test(result.modifiedWeb2Code);
    
    // Look for multiple common placeholder patterns
    const patterns = [
      /["']CANISTER_ID["']/g,
      /["']canister-id["']/g,
      /["']canisterId["']/g,
      /canisterId\s*=\s*["'][^"']*["']/g,
      /canister_id\s*=\s*["'][^"']*["']/g,
      /const\s+canisterId\s*=\s*["'][^"']*["']/g,
      /let\s+canisterId\s*=\s*["'][^"']*["']/g,
      /var\s+canisterId\s*=\s*["'][^"']*["']/g,
      /createActor\(\s*["'][^"']*["']/g
    ];
    
    let originalCode = result.modifiedWeb2Code;
    
    // Apply all replacements
    for (const pattern of patterns) {
      result.modifiedWeb2Code = result.modifiedWeb2Code.replace(pattern, (match: string) => {
        // Special handling for different patterns
        if (match.includes('canisterId =') || match.includes('canister_id =')) {
          return match.replace(/["'][^"']*["']/, `"${existingCanisterId}"`);
        } else if (match.includes('const canisterId =') || match.includes('let canisterId =') || match.includes('var canisterId =')) {
          return match.replace(/["'][^"']*["']/, `"${existingCanisterId}"`);
        } else if (match.includes('createActor(')) {
          return `createActor("${existingCanisterId}"`;
        } else {
          return `"${existingCanisterId}"`;
        }
      });
    }
    
    // Only add canister ID declaration if one doesn't exist yet
    if (!hasCanisterIdDeclaration && originalCode === result.modifiedWeb2Code) {
      const importMatch = result.modifiedWeb2Code.match(/import.*?;/s);
      if (importMatch) {
        const importStatement = importMatch[0];
        const importEndIndex = result.modifiedWeb2Code.indexOf(importStatement) + importStatement.length;
        result.modifiedWeb2Code = 
          result.modifiedWeb2Code.slice(0, importEndIndex) + 
          `\n\n// Canister ID for the deployed ${existingCanisterName || "MainCanister"}\nconst canisterId = "${existingCanisterId}";\n` + 
          result.modifiedWeb2Code.slice(importEndIndex);
      } else {
        result.modifiedWeb2Code = 
          `// Canister ID for the deployed ${existingCanisterName || "MainCanister"}\nconst canisterId = "${existingCanisterId}";\n\n` + 
          result.modifiedWeb2Code;
      }
      console.log('Added explicit canister ID declaration to the code');
    } else {
      console.log('Canister ID already defined or replaced in the code');
    }
  }
  
  return {
    canisterCode: result.canisterCode,
    modifiedWeb2Code: result.modifiedWeb2Code || '',
    canisterName: result.canisterName || forcedCanisterName || 'MainCanister',
  };
}