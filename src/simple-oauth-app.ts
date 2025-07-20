import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';
import { SessionService } from './services/session.service';
import { SlackBotClient, SlackUserClient } from './services/slack.service';
import { 
  postToSlackAsUser, 
  postToSlackAsBot, 
  createAuthPromptPayload, 
  createErrorMessagePayload 
} from './utils/slack';
import { logger } from './utils/logger';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'writerly-01',
  location: process.env.GCP_LOCATION || 'us-central1',
});

const sessionService = new SessionService();

// OAuth configuration
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const BASE_URL = process.env.BASE_URL || 'https://writerly-177365346300.us-central1.run.app';

// Initialize Bot client
const botClient = SLACK_BOT_TOKEN ? new SlackBotClient(SLACK_BOT_TOKEN) : null;

// Authentication helper functions
async function checkUserAuthentication(userId: string, teamId: string): Promise<boolean> {
  try {
    const session = await sessionService.getOAuthSession(userId, teamId);
    if (!session || !session.oauthTokens) {
      return false;
    }

    // Check token expiration
    if (session.oauthTokens.expires_at && session.oauthTokens.expires_at <= new Date()) {
      logger.warn('User token expired', { userId, teamId });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Authentication check failed', { error, userId, teamId });
    return false;
  }
}

async function sendAuthPromptWithBot(channelId: string, userId: string, teamId: string): Promise<void> {
  try {
    if (!botClient) {
      logger.error('Bot client not available - SLACK_BOT_TOKEN missing');
      return;
    }

    const authUrl = `${BASE_URL}/auth/slack?user_id=${encodeURIComponent(userId)}&team_id=${encodeURIComponent(teamId)}`;
    
    await botClient.sendAuthPrompt(channelId, authUrl);
    
    logger.info('Auth prompt sent via Bot', { channelId, userId, teamId });
  } catch (error) {
    logger.error('Failed to send auth prompt via Bot', { error, channelId, userId, teamId });
    throw error;
  }
}

async function getUserOAuthToken(userId: string, teamId: string): Promise<string | null> {
  try {
    const session = await sessionService.getOAuthSession(userId, teamId);
    return session?.oauthTokens?.access_token || null;
  } catch (error) {
    logger.error('Failed to get user OAuth token', { error, userId, teamId });
    return null;
  }
}

// OAuth 인증 시작
app.get('/auth/slack', async (req, res) => {
  try {
    const { user_id, team_id } = req.query;

    // 파라미터가 없는 경우 안내 페이지 표시
    if (!user_id || !team_id) {
      return res.send(`
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Writerly OAuth 인증</title>
          </head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>🔐 Writerly OAuth 인증</h2>
            <p>이 페이지는 Slack에서 자동으로 접근됩니다.</p>
            <p>Slack에서 <code>/ai</code> 명령어를 사용하면 자동으로 인증 프로세스가 시작됩니다.</p>
            <hr>
            <h3>📋 사용 방법:</h3>
            <ol style="text-align: left; display: inline-block;">
              <li>Slack 워크스페이스에서 <code>/ai</code> 명령어 입력</li>
              <li>나타나는 인증 버튼 클릭</li>
              <li>권한 승인</li>
              <li>AI 기능 사용 시작!</li>
            </ol>
            <p><strong>현재 상태:</strong> OAuth 시스템 활성화됨 ✅</p>
          </body>
        </html>
      `);
    }

    if (!SLACK_CLIENT_ID) {
      return res.status(500).json({ 
        error: 'Slack OAuth가 설정되지 않았습니다' 
      });
    }

    // State parameter 생성
    const state = Buffer.from(JSON.stringify({ 
      user_id, 
      team_id,
      timestamp: Date.now()
    })).toString('base64');

    const scopes = [
      'users:read',
      'chat:write',
      'chat:write.public',
      'channels:history',
      'groups:history',
      'im:history',
      'mpim:history'
    ].join(',');

    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('redirect_uri', `${BASE_URL}/auth/slack/callback`);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('user_scope', 'chat:write');

    console.log('OAuth 인증 시작', { user_id, team_id });
    res.redirect(authUrl.toString());

  } catch (error) {
    console.error('OAuth 인증 시작 실패', error);
    res.status(500).json({ 
      error: '인증 시작 중 오류가 발생했습니다' 
    });
  }
});

// OAuth 콜백 처리
app.get('/auth/slack/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      console.error('OAuth 인증 거부됨', error);
      return res.status(400).send(`
        <html>
          <body>
            <h2>❌ 인증이 취소되었습니다</h2>
            <p>Slack 인증을 완료하려면 다시 시도해주세요.</p>
            <script>window.close();</script>
          </body>
        </html>
      `);
    }

    if (!code || !state) {
      return res.status(400).json({ 
        error: '인증 코드 또는 상태 정보가 없습니다' 
      });
    }

    // State 검증
    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch {
      return res.status(400).json({ 
        error: '잘못된 상태 정보입니다' 
      });
    }

    // 토큰 교환
    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        client_id: SLACK_CLIENT_ID,
        client_secret: SLACK_CLIENT_SECRET,
        code: code as string,
        redirect_uri: `${BASE_URL}/auth/slack/callback`,
      }),
    });

    const tokenData = await tokenResponse.json() as any;

    if (!tokenData.ok) {
      console.error('토큰 교환 실패', tokenData.error);
      return res.status(500).json({ 
        error: '토큰 교환에 실패했습니다' 
      });
    }

    console.log('OAuth 인증 완료', { 
      user_id: stateData.user_id, 
      team_id: stateData.team_id 
    });

    // 성공 페이지 표시
    res.send(`
      <html>
        <head>
          <meta charset="UTF-8">
          <title>Writerly 인증 완료</title>
        </head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>✅ 인증이 완료되었습니다!</h2>
          <p>이제 Slack에서 <code>/ai</code> 명령어를 사용할 수 있습니다.</p>
          <p>이 창을 닫고 Slack으로 돌아가세요.</p>
          <script>
            setTimeout(() => {
              window.close();
            }, 3000);
          </script>
        </body>
      </html>
    `);

  } catch (error) {
    console.error('OAuth 콜백 처리 실패', error);
    res.status(500).json({ 
      error: '인증 처리 중 오류가 발생했습니다' 
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    service: 'Writerly AI Slack Bot',
    version: '3.0.0 - Dual Token OAuth',
    vertexAI: {
      projectId: process.env.GCP_PROJECT_ID || 'writerly-01',
      location: process.env.GCP_LOCATION || 'us-central1',
      model: 'gemini-2.0-flash'
    },
    oauth: {
      enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
      dual_token_system: {
        bot_token_available: !!SLACK_BOT_TOKEN,
        user_oauth_enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
        bot_client_initialized: !!botClient
      },
      endpoints: {
        auth: '/auth/slack',
        callback: '/auth/slack/callback'
      }
    },
    features: {
      authentication_first: true,
      bot_auth_prompts: !!botClient,
      user_ai_responses: true,
      session_management: true
    },
    timestamp: new Date().toISOString()
  });
});

// Parse slash command
function parseSlashCommand(text: string): { prompt: string | null, data: string | null } {
  const match = text.match(/^"([^"]+)"\s+"(.+)"$/s);
  if (match) {
    return { prompt: match[1], data: match[2] };
  }
  return { prompt: null, data: null };
}

// Send message using Slack Web API
async function sendSlackMessage(accessToken: string, channel: string, content: string): Promise<void> {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: content,
        as_user: true,
      }),
    });

    const data = await response.json() as any;

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    console.log('Slack 메시지 전송 성공', { channel, messageId: data.ts });
  } catch (error) {
    console.error('Slack 메시지 전송 실패', { error, channel });
  }
}

// Slack command endpoint with new authentication flow
app.post('/slack/commands', async (req, res) => {
  try {
    const { text, user_id, channel_id, response_url, team_id, team_domain, user_name } = req.body;
    
    // 요청 로깅
    logger.info('Slack 명령어 수신', { 
      user_id, 
      team_id, 
      team_domain, 
      user_name, 
      text: text ? `"${text.substring(0, 50)}..."` : 'empty',
      channel_id 
    });

    // 1. 인증 상태 확인 (우선순위 1) - 모든 요청에서 먼저 확인
    const isAuthenticated = await checkUserAuthentication(user_id, team_id);
    
    if (!isAuthenticated) {
      try {
        // Bot token으로 인증 안내 메시지 전송
        await sendAuthPromptWithBot(channel_id, user_id, team_id);
        
        return res.json({ 
          response_type: 'ephemeral', 
          text: '🔐 인증이 필요합니다. 채널에 전송된 인증 버튼을 클릭해주세요.' 
        });
      } catch (authError) {
        logger.error('Bot auth prompt failed, falling back to inline', { authError });
        
        // Bot 전송 실패 시 기존 방식으로 폴백
        const authUrl = `${BASE_URL}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
        
        return res.json({
          response_type: 'ephemeral',
          text: '🔐 AI를 사용하려면 먼저 인증이 필요합니다.',
          attachments: [{
            color: '#007ac7',
            text: '아래 버튼을 클릭하여 OAuth 인증을 완료하세요.',
            actions: [{
              type: 'button',
              text: '🔗 지금 인증하기',
              url: authUrl,
              style: 'primary'
            }]
          }]
        });
      }
    }

    // 2. 인증된 경우에만 AI 처리 진행
    
    // Show help if empty (인증된 사용자용)
    if (!text || text.trim().length === 0) {
      return res.json({
        response_type: 'ephemeral',
        text: `📋 **Writerly AI 사용법** ✅ 인증됨

사용법: \`/ai "작업" "내용"\`

예시:
• \`/ai "영어로 번역" "안녕하세요"\`
• \`/ai "요약" "긴 텍스트..."\`
• \`/ai "문법 검토" "영어 문장..."\`

⚠️ 입력은 최대 10,000자까지 가능합니다.
✨ AI 응답이 사용자 이름으로 표시됩니다.`
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

    // Length check
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
      text: '🤖 AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!\n\n✨ 완료되면 사용자 이름으로 응답이 표시됩니다.'
    });

    // Log AI request start
    logger.info('AI 요청 시작', { user_id, prompt: prompt.substring(0, 30) + '...', dataLength: data.length });

    // Process AI request with user token
    processAIRequestWithUserToken(prompt, data, user_id, channel_id, team_id);

  } catch (error) {
    logger.error('Slack command processing failed', { error, body: req.body });
    
    try {
      // Error message via Bot if available
      if (botClient) {
        await botClient.sendErrorMessage(channel_id, '요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.');
      }
    } catch (botError) {
      logger.error('Bot error message failed', botError);
    }
    
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

// New AI processing function using User token
async function processAIRequestWithUserToken(prompt: string, data: string, userId: string, channelId: string, teamId: string): Promise<void> {
  try {
    // Get user OAuth token
    const userToken = await getUserOAuthToken(userId, teamId);
    if (!userToken) {
      logger.error('User OAuth token not found', { userId, teamId });
      
      // Send error via Bot if available
      if (botClient) {
        await botClient.sendErrorMessage(channelId, 'OAuth 토큰을 찾을 수 없습니다. 다시 인증해주세요.');
      }
      return;
    }

    // Create system prompt
    let systemPrompt = '';
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('번역') || lowerPrompt.includes('translate')) {
      if (lowerPrompt.includes('영어') || lowerPrompt.includes('english')) {
        systemPrompt = `Translate the following Korean text to English. Provide ONLY the translation without any explanation.\n\nText: ${data}`;
      } else if (lowerPrompt.includes('한국어') || lowerPrompt.includes('korean')) {
        systemPrompt = `Translate the following text to Korean. Provide ONLY the translation without any explanation.\n\nText: ${data}`;
      } else {
        systemPrompt = `${prompt}. Provide ONLY the result without any explanation.\n\nText: ${data}`;
      }
    } else if (lowerPrompt.includes('요약') || lowerPrompt.includes('summary')) {
      systemPrompt = `Summarize the following text concisely. ${prompt}\n\nText: ${data}`;
    } else if (lowerPrompt.includes('문법') || lowerPrompt.includes('grammar')) {
      systemPrompt = `Check and correct the grammar. Provide ONLY the corrected text.\n\nText: ${data}`;
    } else {
      systemPrompt = `Task: ${prompt}\n\nProvide a clear and concise response.\n\nData: ${data}`;
    }

    // Get AI response
    const model = vertexAI.preview.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
      }
    });

    logger.info('AI request started', { userId, task: prompt.substring(0, 30) + '...' });
    const startTime = Date.now();

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

    logger.info('AI response completed', {
      userId,
      task: prompt,
      processingTime,
      responseLength: content.length
    });

    // Send response using User token (as user)
    await postToSlackAsUser(userToken, channelId, {
      text: content,
      response_type: 'in_channel'
    });

    logger.info('AI response sent as user', { userId, channelId, responseLength: content.length });

  } catch (error) {
    logger.error('AI processing failed', { error, userId, channelId });
    
    // Send error message via Bot token
    try {
      if (botClient) {
        await botClient.sendErrorMessage(channelId, 'AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
      }
    } catch (botError) {
      logger.error('Bot error message failed', botError);
    }
  }
}

// Legacy function for backward compatibility
async function processAIRequest(prompt: string, data: string, userId: string, channelId: string, responseUrl: string): Promise<void> {
  try {
    // Create system prompt
    let systemPrompt = '';
    const lowerPrompt = prompt.toLowerCase();
    
    if (lowerPrompt.includes('번역') || lowerPrompt.includes('translate')) {
      if (lowerPrompt.includes('영어') || lowerPrompt.includes('english')) {
        systemPrompt = `Translate the following Korean text to English. Provide ONLY the translation without any explanation.\n\nText: ${data}`;
      } else if (lowerPrompt.includes('한국어') || lowerPrompt.includes('korean')) {
        systemPrompt = `Translate the following text to Korean. Provide ONLY the translation without any explanation.\n\nText: ${data}`;
      } else {
        systemPrompt = `${prompt}. Provide ONLY the result without any explanation.\n\nText: ${data}`;
      }
    } else if (lowerPrompt.includes('요약') || lowerPrompt.includes('summary')) {
      systemPrompt = `Summarize the following text concisely. ${prompt}\n\nText: ${data}`;
    } else if (lowerPrompt.includes('문법') || lowerPrompt.includes('grammar')) {
      systemPrompt = `Check and correct the grammar. Provide ONLY the corrected text.\n\nText: ${data}`;
    } else {
      systemPrompt = `Task: ${prompt}\n\nProvide a clear and concise response.\n\nData: ${data}`;
    }

    // Get AI response
    const model = vertexAI.preview.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        maxOutputTokens: 2000,
        temperature: 0.3,
        topP: 0.8,
        topK: 40,
      }
    });

    console.log(`AI request started for user ${userId}`);
    const startTime = Date.now();

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

    // Send response
    await fetch(responseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        response_type: 'in_channel',
        text: `🤖 **AI 응답**\n\n${content}\n\n---\n✨ *처리 시간: ${processingTime}ms*`
      })
    });

  } catch (error) {
    console.error('AI processing failed', { error, userId, channelId });
    
    // Send error message
    try {
      await fetch(responseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          response_type: 'ephemeral',
          text: '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
        })
      });
    } catch (sendError) {
      console.error('Failed to send error message', sendError);
    }
  }
}

// 디버깅용 테스트 엔드포인트
app.post('/test/slack-command', (req, res) => {
  console.log('🔧 테스트 Slack 명령어 수신:', req.body);
  res.json({
    received: req.body,
    timestamp: new Date().toISOString(),
    message: 'Slack 명령어 수신 테스트 성공'
  });
});

// Slack 앱 설정 확인용
app.get('/slack-info', (req, res) => {
  res.json({
    slack_setup: {
      client_id_set: !!SLACK_CLIENT_ID,
      client_secret_set: !!SLACK_CLIENT_SECRET,
      required_urls: {
        slash_command: `${BASE_URL}/slack/commands`,
        oauth_redirect: `${BASE_URL}/auth/slack/callback`,
        oauth_start: `${BASE_URL}/auth/slack?user_id=USER_ID&team_id=TEAM_ID`
      },
      scopes: [
        'users:read',
        'chat:write', 
        'chat:write.public',
        'channels:history',
        'groups:history',
        'im:history',
        'mpim:history'
      ]
    }
  });
});

// Default route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Writerly Slack AI Assistant',
    status: 'running with OAuth',
    version: '2.2.0',
    oauth: {
      enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
      auth_url: `${BASE_URL}/auth/slack`
    },
    endpoints: {
      health: '/health',
      slack: '/slack/commands',
      auth: '/auth/slack',
      callback: '/auth/slack/callback',
      debug: '/test/slack-command',
      info: '/slack-info'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Writerly Slack AI running on port ${PORT}`);
  console.log(`🔐 OAuth 시스템 상태: ${SLACK_CLIENT_ID ? '활성화됨' : '비활성화됨'}`);
  console.log(`📋 인증 URL: ${BASE_URL}/auth/slack`);
});