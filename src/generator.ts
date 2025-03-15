import * as recast from 'recast';
import * as esprima from 'esprima';
import { callGeminiAPI } from './gemini';

/**
 * Extracts JSON content from potentially markdown-formatted text
 */
function extractJsonFromText(text: string): any {
  try {
    // Try direct JSON parsing first
    return JSON.parse(text);
  } catch (e) {
    console.log('Direct JSON parsing failed, attempting to extract from markdown');
    
    // Try to find JSON content between markdown code blocks
    const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch && jsonMatch[1]) {
      try {
        return JSON.parse(jsonMatch[1].trim());
      } catch (e) {
        console.error('Failed to parse extracted JSON from code block:', e);
      }
    }
    
    // If no markdown block found, try to find content that looks like JSON
    const possibleJson = text.match(/(\{[\s\S]*\})/);
    if (possibleJson && possibleJson[1]) {
      try {
        return JSON.parse(possibleJson[1].trim());
      } catch (e) {
        console.error('Failed to parse extracted JSON from content:', e);
      }
    }
    
    throw new Error('Unable to extract valid JSON from the response');
  }
}

/**
 * Creates a detailed prompt for the Gemini API
 */
function createDetailedPrompt(web2Code: string): string {
  return `
INSTRUCTIONS:
You are an expert in ICP blockchain and Web2-to-Web3 transitions.
Your task is to convert Web2 JavaScript code to Web3 using Internet Computer Protocol.

INPUT:
\`\`\`javascript
${web2Code}
\`\`\`

OUTPUT REQUIREMENTS:
1. Generate a Motoko canister that replicates the core functionality of the provided Web2 code
2. Modify the Web2 JavaScript code to integrate with the canister using @dfinity/agent
3. Output in VALID JSON format with these exact keys:
   - canisterCode: The complete Motoko code for the canister
   - modifiedWeb2Code: The modified JavaScript code that calls the canister
   - canisterName: A descriptive name for the canister

CRITICAL: DO NOT use markdown formatting or code blocks in your response.
ONLY return a valid JSON object with the structure shown below:

{
  "canisterCode": "actor { public func yourFunction() : async Text { return \"Hello\" }; }",
  "modifiedWeb2Code": "const agent = new HttpAgent(); const canister = Actor.createActor(...);",
  "canisterName": "YourCanister"
}

DO NOT INCLUDE ANY OTHER TEXT OR EXPLANATION in your response, ONLY the JSON object described above.
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

export async function generateCanisterAndModifyCode(web2Code: string): Promise<{
  canisterCode: string;
  modifiedWeb2Code: string;
  canisterName: string;
}> {
  let prompt = createDetailedPrompt(web2Code);
  
  // Maximum number of retries
  const MAX_RETRIES = 3;
  
  let attempt = 0;
  let result: any;
  
  while (attempt < MAX_RETRIES) {
    attempt++;
    console.log(`Attempt ${attempt} to get valid Gemini API response`);
    
    try {
      const geminiResponse = await callGeminiAPI(prompt);
      console.log(`Raw Gemini response (attempt ${attempt}):`, geminiResponse);
      
      // Try to parse the response as JSON
      try {
        result = extractJsonFromText(geminiResponse);
        
        if (validateResponseStructure(result)) {
          console.log("Successfully extracted and validated JSON response");
          break; // Exit the retry loop if successful
        } else {
          console.error("Extracted JSON is missing required fields:", result);
          
          // If this was the last attempt, throw an error
          if (attempt === MAX_RETRIES) {
            throw new Error("Failed to get valid JSON after maximum retries");
          }
          // Otherwise continue to the next attempt
        }
        
      } catch (jsonError) {
        console.error(`JSON parsing error (attempt ${attempt}):`, jsonError);
        
        // If this was the last attempt, throw the error
        if (attempt === MAX_RETRIES) {
          throw jsonError;
        }
        // Otherwise continue to the next attempt with a more explicit prompt
      }
      
      // If we're here, we need to retry with an even more explicit prompt
      prompt = `
${prompt}

PREVIOUS ATTEMPT FAILED. Your last response could not be parsed as valid JSON.
ENSURE you only return a valid JSON object with NO ADDITIONAL TEXT or markdown.
EXAMPLE OF CORRECT RESPONSE FORMAT:
{"canisterCode":"actor {...}","modifiedWeb2Code":"...","canisterName":"..."}
`;
      
    } catch (apiError) {
      console.error(`API error on attempt ${attempt}:`, apiError);
      
      // If this was the last attempt, throw the error
      if (attempt === MAX_RETRIES) {
        throw apiError;
      }
      // Otherwise continue to the next attempt
    }
  }
  
  // Final validation before returning
  if (!validateResponseStructure(result)) {
    throw new Error('Invalid Gemini API response: missing required fields');
  }
  
  return {
    canisterCode: result.canisterCode,
    modifiedWeb2Code: result.modifiedWeb2Code,
    canisterName: result.canisterName,
  };
}