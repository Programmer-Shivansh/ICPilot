import fetch from 'node-fetch';

// Replace with your actual Gemini API key
const GEMINI_API_KEY = 'AIzaSyCDhUxjr77ED3gHHlNzCPXwLiOQmr3KIyA'; // Set this in your environment or config
console.log('GEMINI_API_KEY:', GEMINI_API_KEY);

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

export async function callGeminiAPI(prompt: string): Promise<string> {
  const model = 'gemini-1.5-flash-001'; // Use Gemini Flash model
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: prompt,
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Gemini API error details:', {
        status: response,
        statusText: response.statusText,
        responseBody: errorText
      });
      throw new Error(`Gemini API error: ${response} ${response.statusText}`);
    }

    const data = await response.json();
    
    // Validate the response structure
    if (!data.candidates || !data.candidates[0] || !data.candidates[0].content || 
        !data.candidates[0].content.parts || !data.candidates[0].content.parts[0]) {
      console.error('Unexpected API response structure:', JSON.stringify(data));
      throw new Error('Unexpected API response structure');
    }
    
    return data.candidates[0].content.parts[0].text;
  } catch (error) {
    if (error instanceof Error) {
      // Re-throw existing errors
      throw error;
    }
    // Handle unexpected errors
    throw new Error(`Unexpected error calling Gemini API: ${error}`);
  }
}