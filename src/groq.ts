import { Groq } from 'groq-sdk';

// Initialize the Groq client
const groq = new Groq({
  // You may need to set your API key here or via environment variable
  apiKey: "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"
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
      stream: false,
      stop: null
    });

    // Extract the response text from the completion
    const responseText = chatCompletion.choices[0]?.message?.content || '';
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
