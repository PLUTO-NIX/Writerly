import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'writerly-01',
  location: process.env.GCP_LOCATION || 'us-central1',
});

// OAuth configuration
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const BASE_URL = process.env.BASE_URL || 'https://writerly-177365346300.us-central1.run.app';

// Simple in-memory session storage (for minimal implementation)
const sessionStore = new Map<string, any>();

// Bot client for sending auth prompts
async function sendBotMessage(channel: string, text: string, authUrl?: string): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    console.log('Bot token not available, skipping bot message');
    return;
  }

  try {
    let messageText = text;
    if (authUrl) {
      messageText += `\n\n🔗 인증하러 가기: ${authUrl}`;
    }

    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: messageText,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('Bot message failed:', data.error, data);
    } else {
      console.log('Bot message sent successfully');
    }
  } catch (error) {
    console.error('Bot message error:', error);
  }
}

// User client for sending AI responses
async function sendUserMessage(channel: string, text: string, userToken: string): Promise<void> {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text,
        as_user: true, // User message - this is still valid for user tokens
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      console.error('User message failed:', data.error);
    } else {
      console.log('User message sent successfully');
    }
  } catch (error) {
    console.error('User message error:', error);
  }
}

// Check if user is authenticated
function isUserAuthenticated(userId: string, teamId: string): boolean {
  const sessionKey = `${userId}:${teamId}`;
  const session = sessionStore.get(sessionKey);
  return !!(session && session.access_token);
}

// Get user OAuth token
function getUserToken(userId: string, teamId: string): string | null {
  const sessionKey = `${userId}:${teamId}`;
  const session = sessionStore.get(sessionKey);
  return session?.access_token || null;
}

// Store user session
function storeUserSession(userId: string, teamId: string, accessToken: string): void {
  const sessionKey = `${userId}:${teamId}`;
  sessionStore.set(sessionKey, {
    access_token: accessToken,
    created_at: Date.now()
  });
}

// OAuth start
app.get('/auth/slack', async (req, res) => {
  try {
    const { user_id, team_id } = req.query;

    if (!user_id || !team_id) {
      return res.send(`
        <html>
          <head><meta charset="UTF-8"><title>Writerly OAuth</title></head>
          <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
            <h2>🔐 Writerly OAuth</h2>
            <p>Slack에서 /ai 명령어를 사용하면 자동으로 인증이 시작됩니다.</p>
            <p><strong>현재 상태:</strong> OAuth 시스템 활성화됨 ✅</p>
          </body>
        </html>
      `);
    }

    if (!SLACK_CLIENT_ID) {
      return res.status(500).json({ error: 'Slack OAuth가 설정되지 않았습니다' });
    }

    const state = Buffer.from(JSON.stringify({ user_id, team_id, timestamp: Date.now() })).toString('base64');
    const scopes = ['users:read', 'chat:write', 'channels:history', 'groups:history', 'im:history', 'mpim:history'].join(',');

    const authUrl = new URL('https://slack.com/oauth/v2/authorize');
    authUrl.searchParams.set('client_id', SLACK_CLIENT_ID);
    authUrl.searchParams.set('scope', scopes);
    authUrl.searchParams.set('redirect_uri', `${BASE_URL}/auth/slack/callback`);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('user_scope', 'chat:write');

    res.redirect(authUrl.toString());
  } catch (error) {
    console.error('OAuth start error:', error);
    res.status(500).json({ error: '인증 시작 중 오류가 발생했습니다' });
  }
});

// OAuth callback
app.get('/auth/slack/callback', async (req, res) => {
  try {
    const { code, state, error } = req.query;

    if (error) {
      return res.send(`<html><body><h2>❌ 인증이 취소되었습니다</h2></body></html>`);
    }

    if (!code || !state) {
      return res.status(400).json({ error: '인증 코드가 없습니다' });
    }

    let stateData;
    try {
      stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
    } catch {
      return res.status(400).json({ error: '잘못된 상태 정보입니다' });
    }

    // Debug: Environment variables
    console.log('DEBUG - OAuth Environment Check:', {
      has_client_id: !!SLACK_CLIENT_ID,
      client_id_length: SLACK_CLIENT_ID?.length || 0,
      client_id_first_10: SLACK_CLIENT_ID?.substring(0, 10),
      has_client_secret: !!SLACK_CLIENT_SECRET,
      client_secret_length: SLACK_CLIENT_SECRET?.length || 0,
      client_secret_first_4: SLACK_CLIENT_SECRET?.substring(0, 4),
      client_secret_last_4: SLACK_CLIENT_SECRET?.substring(SLACK_CLIENT_SECRET?.length - 4),
      base_url: BASE_URL,
      redirect_uri: `${BASE_URL}/auth/slack/callback`
    });

    // Token exchange
    const tokenPayload = {
      client_id: SLACK_CLIENT_ID,
      client_secret: SLACK_CLIENT_SECRET,
      code: code as string,
      redirect_uri: `${BASE_URL}/auth/slack/callback`,
    };

    console.log('DEBUG - Token exchange payload:', {
      client_id: tokenPayload.client_id?.substring(0, 10) + '...',
      client_secret: tokenPayload.client_secret ? 'PRESENT' : 'MISSING',
      code: tokenPayload.code?.substring(0, 10) + '...',
      redirect_uri: tokenPayload.redirect_uri
    });

    const tokenResponse = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenPayload),
    });

    const tokenData = await tokenResponse.json() as any;

    console.log('DEBUG - Slack OAuth Response:', {
      ok: tokenData.ok,
      error: tokenData.error,
      has_access_token: !!tokenData.access_token,
      has_authed_user: !!tokenData.authed_user
    });

    if (!tokenData.ok) {
      console.error('Token exchange failed:', tokenData.error, tokenData);
      return res.status(500).json({ error: '토큰 교환에 실패했습니다' });
    }

    // Store user session
    if (tokenData.authed_user?.access_token) {
      storeUserSession(stateData.user_id, stateData.team_id, tokenData.authed_user.access_token);
    }

    res.send(`
      <html>
        <head><meta charset="UTF-8"><title>Writerly 인증 완료</title></head>
        <body style="font-family: Arial, sans-serif; text-align: center; padding: 50px;">
          <h2>✅ 인증이 완료되었습니다!</h2>
          <p>이제 Slack에서 /ai 명령어를 사용할 수 있습니다.</p>
          <script>setTimeout(() => window.close(), 3000);</script>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: '인증 처리 중 오류가 발생했습니다' });
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'Writerly AI Slack Bot',
    version: '3.0.0 - Dual Token OAuth',
    oauth: {
      enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
      bot_token_available: !!SLACK_BOT_TOKEN,
      user_oauth_enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
    },
    features: {
      authentication_first: true,
      bot_auth_prompts: !!SLACK_BOT_TOKEN,
      user_ai_responses: true,
      in_memory_sessions: true
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

// Slack command endpoint with authentication-first flow
app.post('/slack/commands', async (req, res) => {
  try {
    const { text, user_id, channel_id, team_id, user_name } = req.body;

    console.log('Slack command received:', { user_id, team_id, text: text?.substring(0, 50) + '...' });

    // 1. Authentication check FIRST (highest priority)
    const isAuthenticated = isUserAuthenticated(user_id, team_id);

    if (!isAuthenticated) {
      try {
        // Send auth prompt via Bot token
        const authUrl = `${BASE_URL}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
        
        await sendBotMessage(channel_id, '🔐 AI 기능을 사용하려면 인증이 필요합니다.', authUrl);

        return res.json({
          response_type: 'ephemeral',
          text: '🔐 인증이 필요합니다. 채널에 전송된 인증 버튼을 클릭해주세요.'
        });
      } catch (authError) {
        console.error('Bot auth prompt failed:', authError);
        
        // Fallback to inline auth
        const authUrl = `${BASE_URL}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
        return res.json({
          response_type: 'ephemeral',
          text: `🔐 AI를 사용하려면 먼저 인증이 필요합니다.\n\n🔗 인증하러 가기: ${authUrl}`
        });
      }
    }

    // 2. Authenticated user - handle command
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

    const { prompt, data } = parseSlashCommand(text);
    
    if (!prompt || !data) {
      return res.json({
        response_type: 'ephemeral',
        text: '❌ 올바른 형식이 아닙니다.\n\n사용법: `/ai "작업" "내용"`\n예시: `/ai "영어로 번역" "안녕하세요"`'
      });
    }

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

    // Process AI request with user token (async)
    processAIRequestWithUserToken(prompt, data, user_id, channel_id, team_id);

  } catch (error) {
    console.error('Slack command error:', error);
    res.json({
      response_type: 'ephemeral',
      text: '⚠️ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

// AI processing with user token
async function processAIRequestWithUserToken(prompt: string, data: string, userId: string, channelId: string, teamId: string): Promise<void> {
  try {
    const userToken = getUserToken(userId, teamId);
    if (!userToken) {
      console.error('User token not found:', { userId, teamId });
      await sendBotMessage(channelId, '❌ OAuth 토큰을 찾을 수 없습니다. 다시 인증해주세요.');
      return;
    }

    // Create AI prompt
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

    console.log('AI processing started:', { userId, prompt: prompt.substring(0, 30) + '...' });
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
    console.log('AI processing completed:', { userId, processingTime, responseLength: content.length });

    // Send response as user
    await sendUserMessage(channelId, content, userToken);
    console.log('AI response sent as user:', { userId, channelId });

  } catch (error) {
    console.error('AI processing failed:', { error, userId, channelId });
    await sendBotMessage(channelId, '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// Default route
app.get('/', (req, res) => {
  res.json({
    message: 'Writerly Slack AI Assistant',
    status: 'running with OAuth',
    version: '3.0.0 - Dual Token OAuth',
    oauth: {
      enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET && SLACK_BOT_TOKEN),
      auth_url: `${BASE_URL}/auth/slack`
    },
    endpoints: {
      health: '/health',
      slack: '/slack/commands',
      auth: '/auth/slack',
      callback: '/auth/slack/callback'
    }
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Writerly Slack AI running on port ${PORT}`);
  console.log(`🔐 OAuth enabled: ${!!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET)}`);
  console.log(`🤖 Bot token available: ${!!SLACK_BOT_TOKEN}`);
  console.log(`📋 Auth URL: ${BASE_URL}/auth/slack`);
});