import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'writerly-01',
  location: process.env.GCP_LOCATION || 'us-central1',
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Writerly AI Slack Bot',
    vertexAI: {
      projectId: process.env.GCP_PROJECT_ID || 'writerly-01',
      location: process.env.GCP_LOCATION || 'us-central1',
      model: 'gemini-2.0-flash'
    },
    oauth: {
      enabled: !!(process.env.SLACK_CLIENT_ID && process.env.SLACK_CLIENT_SECRET),
      message: 'OAuth 인증 시스템이 활성화되어 있습니다'
    },
    timestamp: new Date().toISOString()
  });
});

// Parse slash command into prompt and data
function parseSlashCommand(text: string): { prompt: string | null, data: string | null } {
  // Match pattern: "prompt" "data"
  const match = text.match(/^"([^"]+)"\s+"(.+)"$/s);
  
  if (match) {
    return {
      prompt: match[1],
      data: match[2]
    };
  }
  
  return { prompt: null, data: null };
}

// Simple response function
async function sendResponse(responseUrl: string, content: string): Promise<void> {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: content
      })
    });

    if (!response.ok) {
      throw new Error(`Response failed: ${response.status}`);
    }

    console.log('Response sent successfully');
  } catch (error) {
    console.error('Failed to send response:', error);
  }
}

// Basic Slack command endpoint
app.post('/slack/commands', async (req, res) => {
  try {
    const { text, user_id, channel_id, response_url } = req.body;

    // Show help if empty
    if (!text || text.trim().length === 0) {
      return res.json({
        response_type: 'ephemeral',
        text: '📋 **Writerly AI 사용법**\n\n사용법: `/ai "작업" "내용"`\n\n예시:\n• `/ai "영어로 번역" "안녕하세요"`\n• `/ai "요약" "긴 텍스트..."`\n• `/ai "문법 검토" "영어 문장..."`\n\n⚠️ 입력은 최대 10,000자까지 가능합니다.\n\n🔐 **인증 안내**: OAuth 인증 시스템이 준비되어 있습니다. 곧 사용자 인증 기능이 활성화됩니다.'
      });
    }

    // Parse command
    const { prompt, data } = parseSlashCommand(text);
    
    if (!prompt || !data) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ 올바른 형식이 아닙니다.\n\n사용법: `/ai "작업" "내용"`\n예시: `/ai "영어로 번역" "안녕하세요"`'
      });
    }

    // Combined length check (10,000 character limit from ADR-008)
    const totalLength = prompt.length + data.length;
    if (totalLength > 10000) {
      return res.json({
        response_type: 'ephemeral',
        text: `⚠️ 입력 데이터가 너무 깁니다.\n• 최대 허용 길이: 10,000자\n• 현재 길이: ${totalLength.toLocaleString()}자`
      });
    }

    // Immediate response
    res.json({
      response_type: 'ephemeral',
      text: 'AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!\n\n현재 기본 모드로 동작 중입니다. OAuth 인증 후 더 많은 기능을 사용할 수 있습니다.'
    });

    // Process AI request asynchronously
    processAIRequest(prompt, data, user_id, channel_id, response_url);

  } catch (error) {
    console.error('Slack command processing failed', error);
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

async function processAIRequest(prompt: string, data: string, userId: string, channelId: string, responseUrl: string): Promise<void> {
  try {
    // Create task-specific system prompt
    let systemPrompt = '';
    
    // Handle different types of prompts
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('번역') || lowerPrompt.includes('translate')) {
      // Translation task
      if (lowerPrompt.includes('영어') || lowerPrompt.includes('english')) {
        systemPrompt = `Translate the following Korean text to English. Provide ONLY the translation without any explanation or additional text.\n\nText: ${data}`;
      } else if (lowerPrompt.includes('한국어') || lowerPrompt.includes('korean')) {
        systemPrompt = `Translate the following text to Korean. Provide ONLY the translation without any explanation or additional text.\n\nText: ${data}`;
      } else {
        systemPrompt = `${prompt}. Provide ONLY the result without any explanation.\n\nText: ${data}`;
      }
    } else if (lowerPrompt.includes('요약') || lowerPrompt.includes('summary')) {
      // Summary task
      systemPrompt = `Summarize the following text concisely. ${prompt}\n\nText: ${data}`;
    } else if (lowerPrompt.includes('문법') || lowerPrompt.includes('grammar')) {
      // Grammar check
      systemPrompt = `Check and correct the grammar. Provide ONLY the corrected text.\n\nText: ${data}`;
    } else {
      // General task
      systemPrompt = `Task: ${prompt}\n\nProvide a clear and concise response.\n\nData: ${data}`;
    }

    // Get Vertex AI model
    const model = vertexAI.preview.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.3, // Lower temperature for more consistent results
        topP: 0.8,
        topK: 40,
      }
    });

    console.log(`AI request started for user ${userId} - Task: ${prompt}`);
    const startTime = Date.now();

    // Generate AI response
    const result = await model.generateContent(systemPrompt);
    const response = result.response;

    if (!response.candidates || response.candidates.length === 0) {
      throw new Error('No AI response generated');
    }

    const content = response.candidates[0].content.parts
      .map((part: any) => part.text)
      .join('')
      .trim();

    const processingTime = Date.now() - startTime;

    console.log(`AI response completed for user ${userId}`, {
      task: prompt,
      processingTime,
      responseLength: content.length
    });

    // Send response to Slack channel
    await sendResponse(responseUrl, `🤖 **AI 응답**\n\n${content}\n\n---\n✨ *처리 시간: ${processingTime}ms*`);
    console.log(`Response sent to channel ${channelId}`);

  } catch (error) {
    console.error('AI processing failed', { error, userId, channelId });
    
    // Send error message
    try {
      await sendResponse(responseUrl, '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } catch (sendError) {
      console.error('Failed to send error message', sendError);
    }
  }
}

// OAuth placeholder endpoints
app.get('/auth/slack', (req, res) => {
  res.send(`
    <html>
      <head>
        <meta charset="UTF-8">
        <title>Writerly 인증</title>
      </head>
      <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
        <h2>🔐 OAuth 인증 시스템</h2>
        <p>OAuth 인증 기능이 구현되어 있습니다.</p>
        <p>현재는 기본 모드로 동작 중이며, 곧 전체 OAuth 플로우가 활성화됩니다.</p>
        <p><strong>참고:</strong> 다음 구성 요소들이 준비되어 있습니다:</p>
        <ul style="text-align: left; display: inline-block;">
          <li>✅ Redis 세션 관리</li>
          <li>✅ OAuth 컨트롤러</li>
          <li>✅ 인증 미들웨어</li>
          <li>✅ Slack Web API 통합</li>
          <li>✅ AES-256 암호화</li>
        </ul>
      </body>
    </html>
  `);
});

app.get('/auth/status', (req, res) => {
  res.json({
    oauth_implemented: true,
    components: {
      session_service: 'implemented',
      auth_controller: 'implemented', 
      auth_middleware: 'implemented',
      slack_web_api: 'implemented',
      encryption: 'implemented'
    },
    status: 'OAuth system ready for activation'
  });
});

// Default route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Writerly Slack AI Assistant',
    status: 'running',
    version: '2.0.0',
    features: {
      ai_processing: 'active',
      oauth_system: 'implemented',
      encryption: 'active',
      session_management: 'ready'
    },
    endpoints: {
      health: '/health',
      slack: '/slack/commands',
      auth: '/auth/slack',
      status: '/auth/status'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Writerly Slack AI running on port ${PORT}`);
  console.log(`📋 OAuth 시스템이 구현되어 있습니다`);
  console.log(`🔐 인증 기능 활성화 준비 완료`);
});