import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';
import { AuthController } from './controllers/auth.controller';
import { authMiddleware } from './middleware/auth.middleware';
import { SlackService } from './services/slack.service';
import { SessionService } from './services/session.service';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const authController = new AuthController();
const sessionService = new SessionService();

// Initialize Vertex AI
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'writerly-01',
  location: process.env.GCP_LOCATION || 'us-central1',
});

// OAuth 인증 라우트
app.get('/auth/slack', authController.initiateAuth.bind(authController));
app.get('/auth/slack/callback', authController.handleCallback.bind(authController));
app.get('/auth/status', authController.checkAuthStatus.bind(authController));
app.post('/auth/revoke', authController.revokeAuth.bind(authController));
app.post('/auth/refresh', authController.refreshToken.bind(authController));

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
      endpoints: {
        auth: '/auth/slack',
        callback: '/auth/slack/callback',
        status: '/auth/status'
      }
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

// Send message using Slack Web API (as user)
async function sendSlackMessage(accessToken: string, channel: string, content: string): Promise<void> {
  try {
    const slackService = new SlackService('', '', '');
    const client = slackService.createWebApiClient(accessToken);

    const result = await client.postMessage({
      channel,
      text: content,
    });

    if (!result.ok) {
      throw new Error(`Slack API error: ${result.error}`);
    }

    logger.info('Slack 메시지 전송 성공', { channel, messageId: result.ts });
  } catch (error) {
    logger.error('Slack 메시지 전송 실패', { error, channel });
  }
}

// Slack command endpoint - with authentication middleware
app.post('/slack/commands', authMiddleware.requireSlackAuth, async (req, res) => {
  try {
    const { text, user_id, channel_id } = req.body;
    const { user } = req as any; // From auth middleware

    // Show help if empty
    if (!text || text.trim().length === 0) {
      return res.json({
        response_type: 'ephemeral',
        text: '📋 **Writerly AI 사용법**\n\n사용법: `/ai "작업" "내용"`\n\n예시:\n• `/ai "영어로 번역" "안녕하세요"`\n• `/ai "요약" "긴 텍스트..."`\n• `/ai "문법 검토" "영어 문장..."`\n\n⚠️ 입력은 최대 10,000자까지 가능합니다.'
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

    // Immediate response (Fire-and-Forget pattern from ADR-003)
    res.json({
      response_type: 'ephemeral',
      text: '🤖 AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!'
    });

    // Process AI request asynchronously
    processAIRequest(prompt, data, user_id, channel_id, user.accessToken);

  } catch (error) {
    console.error('Slack command processing failed', error);
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

async function processAIRequest(prompt: string, data: string, userId: string, channelId: string, accessToken: string): Promise<void> {
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

    // Send response to Slack channel using Web API (as user)
    await sendSlackMessage(accessToken, channelId, content);
    logger.info(`AI 응답 전송 완료`, { userId, channelId, responseLength: content.length });

  } catch (error) {
    logger.error('AI 처리 실패', { error, userId, channelId });
    
    // Send error message to user
    try {
      await sendSlackMessage(accessToken, channelId, '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
    } catch (sendError) {
      logger.error('에러 메시지 전송 실패', { sendError, userId, channelId });
    }
  }
}

// Default route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Writerly Slack AI Assistant',
    status: 'running',
    endpoints: {
      health: '/health',
      slack: '/slack/commands'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Writerly Slack AI running on port ${PORT}`);
});