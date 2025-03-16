import * as recast from 'recast';
import * as esprima from 'esprima';
// import { callGeminiAPI } from './gemini';
import { callGroqAPI } from './groq';

/**
 * Extracts JSON content from a text string, handling raw JSON or JSON-like content with newlines.
 * @param text The input text to parse
 * @returns The parsed JSON object
 * @throws Error if no valid JSON can be extracted
 */
function extractJsonFromText(text: string): any {
  // Validate input
  if (!text || typeof text !== 'string') {
    throw new Error('Input text must be a non-empty string');
  }

  // Trim whitespace
  let trimmedText = text.trim();
  console.log('Raw input text:', trimmedText);

  // Remove outer double quotes if present
  if (trimmedText.startsWith('"') && trimmedText.endsWith('"')) {
    trimmedText = trimmedText.slice(1, -1);
    console.log('Removed outer double quotes');
  }

  // Replace literal newlines with escaped newlines within the JSON structure
  trimmedText = trimmedText.replace(/\n/g, '\\n');
  console.log('Sanitized input text:', trimmedText);

  // Attempt to parse the sanitized text as JSON
  try {
    const parsedJson = JSON.parse(trimmedText);
    console.log('Successfully parsed JSON:', parsedJson);
    return parsedJson;
  } catch (parseError) {
    console.error('JSON parsing failed:', parseError instanceof Error ? parseError.message : String(parseError));
    throw new Error(`Unable to extract valid JSON from the response. Sanitized input: "${trimmedText}"`);
  }
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
 * Creates a detailed prompt for the Gemini API
 */
function createDetailedPrompt(
  web2Code: string, 
  functionalityFocus?: string, 
  isConsolidated = false,
  existingCanisterName?: string
): string {
  let focusInstruction = '';
  let consolidatedInstruction = '';
  
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

  return `
INSTRUCTIONS:
You are an expert in ICP blockchain and Web2-to-Web3 transitions.
Your task is to convert Web2 JavaScript code to Web3 using Internet Computer Protocol.
${focusInstruction}
${consolidatedInstruction}

INPUT:
\`\`\`javascript
${web2Code}
\`\`\`

OUTPUT REQUIREMENTS:
1. Generate a Motoko canister that replicates the core functionality of the provided Web2 code
2. Modify the Web2 JavaScript code to integrate with the canister using @dfinity/agent
3. Output in VALID JSON format with these exact keys:
   - canisterCode: The complete Motoko code for the canister, formatted in MULTI-LINE style with proper indentation
   - modifiedWeb2Code: The modified JavaScript code that calls the canister
   - canisterName: A descriptive name for the canister

CRITICAL FORMATTING RULES:
- For canisterCode, use MULTI-LINE formatting with proper indentation (2 spaces) for readability.
- Example of correct canisterCode format:
{
  "canisterCode": "actor {\n  public func yourFunction() : async Text {\n    return \\"Hello\\";\n  };\n}",
  "modifiedWeb2Code": "const agent = new HttpAgent(); const canister = Actor.createActor(...);",
  "canisterName": "YourCanister"
}
- DO NOT use markdown formatting or code blocks in your response.
- ONLY return a valid JSON object with the structure shown above, with NO ADDITIONAL TEXT OR EXPLANATION.
`;
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
  existingCanisterId?: string
): Promise<{
  canisterCode: string;
  modifiedWeb2Code: string;
  canisterName: string;
}> {
  const forcedCanisterName = isConsolidated ? "ConsolidatedCanister" : existingCanisterName;
  let prompt = createDetailedPrompt(web2Code, functionalityFocus, isConsolidated, forcedCanisterName);
  
  const MAX_RETRIES = 3;
  let attempt = 0;
  let result: any;
  
  while (attempt < MAX_RETRIES) {
    attempt++;
    console.log(`Attempt ${attempt} to get valid Gemini API response`);
    
    try {
      const geminiResponse = await callGroqAPI(prompt);
      console.log(`Raw Gemini response (attempt ${attempt}):`, geminiResponse);
      
      try {
        result = extractJsonFromText(geminiResponse);
        
        if (validateResponseStructure(result)) {
          console.log("Successfully extracted and validated JSON response");
          result.canisterCode = formatMotokoCode(result.canisterCode);
          break;
        } else {
          console.error("Extracted JSON is missing required fields:", result);
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
      
      prompt = `
${prompt}

PREVIOUS ATTEMPT FAILED. Your last response could not be parsed as valid JSON or was not properly formatted.
ENSURE you return a valid JSON object with NO ADDITIONAL TEXT or markdown.
ENSURE canisterCode is MULTI-LINE with 2-space indentation.
EXAMPLE OF CORRECT RESPONSE FORMAT:
{"canisterCode":"actor {\n  public func greet() : async Text {\n    return \\"Hello\\";\n  };\n}","modifiedWeb2Code":"...","canisterName":"..."}
`;
      
    } catch (apiError) {
      console.error(`API error on attempt ${attempt}:`, apiError);
      if (attempt === MAX_RETRIES) {
        throw apiError;
      }
    }
  }
  
  if (!validateResponseStructure(result)) {
    throw new Error('Invalid Gemini API response: missing required fields');
  }
  
  if (forcedCanisterName) {
    result.canisterName = forcedCanisterName;
  }
  
  if (existingCanisterId) {
    result.modifiedWeb2Code = result.modifiedWeb2Code.replace(/["']CANISTER_ID["']/g, `"${existingCanisterId}"`);
  }
  
  // For fallback case, only return canisterCode if modifiedWeb2Code and canisterName are absent
  return {
    canisterCode: result.canisterCode,
    modifiedWeb2Code: result.modifiedWeb2Code || '',
    canisterName: result.canisterName || forcedCanisterName || 'MainCanister',
  };
}