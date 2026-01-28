// Gemini画像生成テストスクリプト
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
console.log('GEMINI_API_KEY exists:', !!GEMINI_API_KEY);
console.log('Key length:', GEMINI_API_KEY ? GEMINI_API_KEY.length : 0);

async function testGeminiImageGeneration() {
  // 画像生成モデルをテスト
  const model = 'gemini-2.0-flash-exp-image-generation'; // 画像生成対応モデル
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  
  console.log('\n--- Testing Gemini Image Generation ---');
  console.log('Model:', model);
  
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{ text: 'Generate an image of a cute cat' }]
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE']
        }
      })
    });
    
    console.log('Response status:', response.status);
    const data = await response.json();
    
    if (data.error) {
      console.log('Error:', JSON.stringify(data.error, null, 2));
    } else if (data.candidates && data.candidates[0]) {
      const parts = data.candidates[0].content?.parts || [];
      console.log('Parts count:', parts.length);
      
      for (const part of parts) {
        if (part.text) {
          console.log('Text:', part.text.substring(0, 100));
        }
        if (part.inlineData) {
          console.log('Image found! MIME type:', part.inlineData.mimeType);
          console.log('Image data length:', part.inlineData.data?.length || 0);
        }
      }
    } else {
      console.log('Response:', JSON.stringify(data).substring(0, 500));
    }
  } catch (e) {
    console.error('Error:', e.message);
  }
}

// 利用可能なモデルを確認
async function listModels() {
  console.log('\n--- Listing Available Models ---');
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models?key=${GEMINI_API_KEY}`;
  
  try {
    const response = await fetch(endpoint);
    const data = await response.json();
    
    if (data.models) {
      const imageModels = data.models.filter(m => 
        m.name.includes('image') || 
        m.supportedGenerationMethods?.includes('generateContent')
      );
      console.log('Image-related models:');
      imageModels.slice(0, 10).forEach(m => {
        console.log(`  - ${m.name}: ${m.displayName}`);
      });
    }
  } catch (e) {
    console.error('Error listing models:', e.message);
  }
}

await listModels();
await testGeminiImageGeneration();
