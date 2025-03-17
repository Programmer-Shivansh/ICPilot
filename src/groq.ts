import { Groq } from 'groq-sdk';
import { config} from 'dotenv';

// Load environment variables from .env file
config();
// Initialize the Groq client
const groq = new Groq({
  // You may need to set your API key here or via environment variable
  apiKey: `${process.env.GROQ_API_KEY}`,
});

/**
 * Extracts JSON content from potentially markdown-formatted text
 * Handles cases where the JSON is wrapped in markdown code blocks
 */
function extractJsonFromText(text: string): string {
  // Try to find JSON content between markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (jsonMatch && jsonMatch[1]) {
    return jsonMatch[1].trim();
  }
  
  // If no markdown block found, try to find content that looks like JSON
  const possibleJson = text.match(/(\{[\s\S]*\})/);
  if (possibleJson && possibleJson[1]) {
    return possibleJson[1].trim();
  }
  
  // If all else fails, return the original text
  return text.trim();
}

export async function callGroqAPI(prompt: string): Promise<string> {
  try {
    // Add explicit instructions for formatting JSON correctly
    const wrappedPrompt = `
${prompt}

CRITICAL: 
Your response MUST be a valid, parseable JSON object and NOTHING else.
DO NOT use markdown code blocks.
DO NOT include any explanation text.
DO NOT format your response in any way that would prevent direct JSON.parse().
`;

    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "system", 
          content: "You are a code conversion assistant that outputs only valid JSON. Your responses should contain no markdown, no explanations, just pure JSON objects that can be parsed by JSON.parse()."
        },
        {
          role: "user",
          content: wrappedPrompt
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 0.5,  // Reduced for more predictable outputs
      max_tokens: 2048,  // Increased for more complete responses
      top_p: 0.9,
      stream: false,
      stop: null
    });

    // Extract the response text from the completion
    const responseText = chatCompletion.choices[0]?.message?.content || '';
    
    // Log the first 100 characters for debugging
    console.log(`Groq API response start: ${responseText.substring(0, 100)}...`);
    
    return responseText;
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error calling Groq API: ${error}`);
  }
}

// Streaming version if needed
export async function streamGroqAPI(prompt: string, callback: (text: string) => void): Promise<void> {
  try {
    const chatCompletion = await groq.chat.completions.create({
      messages: [
        {
          role: "user",
          content: prompt
        }
      ],
      model: "llama-3.3-70b-versatile",
      temperature: 1,
      max_tokens: 1024,
      top_p: 1,
      stream: true,
      stop: null
    });

    for await (const chunk of chatCompletion) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        callback(content);
      }
    }
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error(`Unexpected error streaming from Groq API: ${error}`);
  }
}
