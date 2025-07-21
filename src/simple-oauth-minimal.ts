import express from 'express';
import { VertexAI } from '@google-cloud/vertexai';

// TRD Phase 1 - 서식 보존 시스템 컴포넌트
import { AdvancedSlackParser, ParsedCommand, FormatMetadata } from './parsers/AdvancedSlackParser';
import { FormatDetector } from './formatters/FormatDetector';
import { FormatAwarePrompts, PromptConfig } from './prompts/FormatAwarePrompts';

// Firestore 기반 인증 서비스
import { authService } from './services/firestore-auth.service';

// Thread Support - Slack Events API 핸들러
import { SlackEventsHandler } from './handlers/slack-events.handler';

const app = express();
const PORT = process.env.PORT || 8080;

// Raw body capture middleware for Slack signature verification (POST only)
app.use('/slack/events', (req, res, next) => {
  if (req.method === 'POST') {
    // Apply raw body parser only for POST requests
    express.raw({ type: 'application/json' })(req, res, (err) => {
      if (err) return next(err);
      try {
        // Convert raw buffer to string and parse JSON for downstream handlers
        const bodyString = req.body.toString('utf8');
        (req as any).rawBody = bodyString;
        req.body = JSON.parse(bodyString);
        next();
      } catch (parseError) {
        console.error('JSON parsing error:', parseError);
        next(parseError);
      }
    });
  } else {
    // For GET requests, just continue without raw body parsing
    next();
  }
});

// Standard JSON parsing for other endpoints
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize services
const vertexAI = new VertexAI({
  project: process.env.GCP_PROJECT_ID || 'writerly-01',
  location: process.env.GCP_LOCATION || 'us-central1',
});

// TRD Phase 1 - 서식 보존 시스템 인스턴스
const advancedParser = new AdvancedSlackParser();
const formatDetector = new FormatDetector();
const formatAwarePrompts = new FormatAwarePrompts();

// Thread Support - Events API 핸들러 인스턴스
const slackEventsHandler = new SlackEventsHandler();

// OAuth configuration
const SLACK_CLIENT_ID = process.env.SLACK_CLIENT_ID || '';
const SLACK_CLIENT_SECRET = process.env.SLACK_CLIENT_SECRET || '';
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN || '';
const BASE_URL = process.env.BASE_URL || 'https://writerly-ai-ryvo6rqgea-du.a.run.app';

// Simple in-memory session storage (for minimal implementation) - DEPRECATED: Replaced with Firestore
// const sessionStore = new Map<string, any>(); // Firestore 로 대체됨

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

    const data = await response.json() as any;
    if (!data.ok) {
      console.error('Bot message failed:', data.error, data);
    } else {
      console.log('Bot message sent successfully');
    }
  } catch (error) {
    console.error('Bot message error:', error);
  }
}

// Bot client for sending ephemeral processing messages
async function sendEphemeralProcessingMessage(channel: string, userId: string, text: string): Promise<string | null> {
  if (!SLACK_BOT_TOKEN) {
    console.log('Bot token not available, skipping ephemeral message');
    return null;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.postEphemeral', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        user: userId,
        text,
      }),
    });

    const data = await response.json() as any;
    if (!data.ok) {
      console.error('Ephemeral message failed:', data.error, data);
      return null;
    } else {
      console.log('Ephemeral processing message sent successfully');
      return (data as any).message_ts || (data as any).ts;
    }
  } catch (error) {
    console.error('Ephemeral message error:', error);
    return null;
  }
}

// Bot client for deleting messages
async function deleteMessage(channel: string, messageTs: string): Promise<void> {
  if (!SLACK_BOT_TOKEN) {
    console.log('Bot token not available, skipping message deletion');
    return;
  }

  try {
    const response = await fetch('https://slack.com/api/chat.delete', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        ts: messageTs,
      }),
    });

    const data = await response.json() as any;
    if (!data.ok) {
      console.error('Message deletion failed:', data.error, data);
    } else {
      console.log('Processing message deleted successfully');
    }
  } catch (error) {
    console.error('Message deletion error:', error);
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

    const data = await response.json() as any;
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
async function isUserAuthenticated(userId: string, teamId: string): Promise<boolean> {
  return await authService.isAuthenticated(userId, teamId);
}

// Get user OAuth token
async function getUserToken(userId: string, teamId: string): Promise<string | null> {
  return await authService.getAuth(userId, teamId);
}

// Store user session
async function storeUserSession(userId: string, teamId: string, accessToken: string): Promise<void> {
  await authService.storeAuth(userId, teamId, accessToken);
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
      await storeUserSession(stateData.user_id, stateData.team_id, tokenData.authed_user.access_token);
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
    version: '3.0.0 - Dual Token OAuth + Firestore Auth',
    oauth: {
      enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
      bot_token_available: !!SLACK_BOT_TOKEN,
      user_oauth_enabled: !!(SLACK_CLIENT_ID && SLACK_CLIENT_SECRET),
    },
    features: {
      authentication_first: true,
      bot_auth_prompts: !!SLACK_BOT_TOKEN,
      user_ai_responses: true,
      firestore_auth: true,
      persistent_sessions: true,
      thread_support: !!(process.env.SLACK_SIGNING_SECRET && process.env.SLACK_BOT_USER_ID),
      events_api: !!process.env.SLACK_SIGNING_SECRET
    },
    timestamp: new Date().toISOString()
  });
});

// Firestore Auth Health check
app.get('/health/auth', async (req, res) => {
  try {
    // Firestore 연결 테스트
    const testDoc = await authService.firestoreDB
      .collection('health')
      .doc('check')
      .get();
    
    const cacheStats = authService.getCacheStats();
    
    res.json({
      status: 'healthy',
      firestore: 'connected',
      cache: cacheStats,
      encryption: 'enabled',
      auth_service: 'operational',
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(503).json({
      status: 'unhealthy',
      firestore: 'connection_failed',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Thread Support - Slack Events API 엔드포인트
app.post('/slack/events', async (req, res) => {
  await slackEventsHandler.handle(req, res);
});

// Events API GET 요청에 대한 응답 (Slack 앱 설정 페이지에서 접근할 때)
app.get('/slack/events', (req, res) => {
  res.json({
    status: 'Slack Events API Ready',
    endpoint: '/slack/events',
    methods: ['POST'],
    description: 'This endpoint receives Slack Events API webhooks',
    setup_url: 'https://api.slack.com/apps',
    thread_support: true
  });
});

// TRD Phase 1 - 고급 서식 보존 파싱
function parseSlashCommand(text: string): { prompt: string | null, data: string | null } {
  // 기존 호환성을 위한 래퍼 함수
  const fullCommand = `/ai ${text}`;
  const parsed = advancedParser.parse(fullCommand);
  
  if (advancedParser.isValidParse(parsed)) {
    return { prompt: parsed.task, data: parsed.content };
  }
  
  // 기존 방식 폴백
  const match = text.match(/^"([^"]+)"\s+"(.+)"$/s);
  if (match) {
    return { prompt: match[1], data: match[2] };
  }
  return { prompt: null, data: null };
}

// TRD Phase 1 - 서식 보존 명령어 파싱 (새로운 함수)
function parseSlashCommandAdvanced(text: string): ParsedCommand | null {
  const fullCommand = `/ai ${text}`;
  const parsed = advancedParser.parse(fullCommand);
  
  if (advancedParser.isValidParse(parsed)) {
    console.log('🎯 Advanced parsing success:', advancedParser.getParsingInfo(parsed));
    return parsed;
  }
  
  console.log('⚠️ Advanced parsing failed, content:', text.substring(0, 50) + '...');
  return null;
}

// Slack command endpoint with authentication-first flow
app.post('/slack/commands', async (req, res) => {
  try {
    const { text, user_id, channel_id, team_id, user_name } = req.body;

    console.log('Slack command received:', { user_id, team_id, text: text?.substring(0, 50) + '...' });

    // 1. Authentication check FIRST (highest priority)
    const isAuthenticated = await isUserAuthenticated(user_id, team_id);

    if (!isAuthenticated) {
      // Show ephemeral auth message with button (private to user)
      const authUrl = `${BASE_URL}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
      return res.json({
        response_type: 'ephemeral',
        text: 'AI를 사용하려면 먼저 인증이 필요합니다.',
        attachments: [{
          actions: [{
            type: 'button',
            text: '🔗 인증하러 가기',
            url: authUrl,
            style: 'primary'
          }]
        }]
      });
    }

    // 2. Authenticated user - handle command
    if (!text || text.trim().length === 0) {
      return res.json({
        response_type: 'ephemeral',
        text: `사용법: \`/ai "작업" "내용"\`

예시:
• \`/ai "영어로 번역" "안녕하세요"\`
• \`/ai "요약" "긴 텍스트..."\`
• \`/ai "문법 검토" "영어 문장..."\`

기타 명령어:
• \`/ai logout\` 또는 \`/ai 로그아웃\` - 인증 해제

입력은 최대 10,000자까지 가능합니다.
AI 응답이 사용자 이름으로 표시됩니다.`
      });
    }

    // 로그아웃 명령어 처리
    if (text.trim().toLowerCase() === 'logout' || text.trim() === '로그아웃') {
      await authService.deleteAuth(user_id, team_id);
      return res.json({
        response_type: 'ephemeral',
        text: '로그아웃되었습니다. 다시 사용하려면 재인증이 필요합니다.'
      });
    }

    // TRD Phase 1 - 고급 서식 보존 파싱 시도
    const parsedCommand = parseSlashCommandAdvanced(text);
    
    if (!parsedCommand) {
      // 기존 방식 폴백
      const { prompt, data } = parseSlashCommand(text);
      
      if (!prompt || !data) {
        return res.json({
          response_type: 'ephemeral',
          text: '올바른 형식이 아닙니다.\n\n사용법: `/ai "작업" "내용"`\n예시: `/ai "영어로 번역" "안녕하세요"`'
        });
      }
      
      // 기존 방식으로 처리
      const totalLength = prompt.length + data.length;
      if (totalLength > 10000) {
        return res.json({
          response_type: 'ephemeral',
          text: `입력 데이터가 너무 깁니다.\n• 최대 허용 길이: 10,000자\n• 현재 길이: ${totalLength.toLocaleString()}자`
        });
      }

      // Bot으로 처리 중 메시지 생성 및 처리 (응답도 함께 처리)
      processAIRequestWithUserTokenAndTracking(prompt, data, user_id, channel_id, team_id, res);
      return;
    }

    // TRD Phase 1 - 고급 서식 보존 처리
    const totalLength = parsedCommand.task.length + parsedCommand.content.length;
    if (totalLength > 10000) {
      return res.json({
        response_type: 'ephemeral',
        text: `입력 데이터가 너무 깁니다.\n• 최대 허용 길이: 10,000자\n• 현재 길이: ${totalLength.toLocaleString()}자`
      });
    }

    // Process AI request with advanced format preservation and tracking (응답도 함께 처리)
    processAIRequestWithFormatPreservationAndTracking(parsedCommand, user_id, channel_id, team_id, res);

  } catch (error) {
    console.error('Slack command error:', error);
    res.json({
      response_type: 'ephemeral',
      text: '요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
    });
  }
});

// TRD Phase 1.4 - AI processing with format preservation
async function processAIRequestWithFormatPreservation(parsedCommand: ParsedCommand, userId: string, channelId: string, teamId: string): Promise<void> {
  try {
    const userToken = await getUserToken(userId, teamId);
    if (!userToken) {
      console.error('User token not found:', { userId, teamId });
      await sendBotMessage(channelId, '❌ OAuth 토큰을 찾을 수 없습니다. 다시 인증해주세요.');
      return;
    }

    // TRD Phase 1.4 - 서식 보존 AI 프롬프트 생성
    const promptConfig: PromptConfig = {
      task: parsedCommand.task,
      content: parsedCommand.content,
      metadata: parsedCommand.metadata,
      preservationLevel: 'adaptive' // 기본값으로 adaptive 사용
    };

    const systemPrompt = formatAwarePrompts.generatePrompt(promptConfig);

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

    console.log('🎯 AI processing with format preservation started:', { 
      userId, 
      task: parsedCommand.task.substring(0, 30) + '...',
      complexity: parsedCommand.metadata.complexity 
    });
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
    console.log('✅ AI processing with format preservation completed:', { 
      userId, 
      processingTime, 
      responseLength: content.length,
      originalComplexity: parsedCommand.metadata.complexity
    });

    // Send response as user
    await sendUserMessage(channelId, content, userToken);
    console.log('📤 Format-preserved AI response sent as user:', { userId, channelId });

  } catch (error) {
    console.error('❌ Format preservation AI processing failed:', { error, userId, channelId });
    await sendBotMessage(channelId, '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// Enhanced format preservation AI processing with message tracking
async function processAIRequestWithFormatPreservationAndTracking(parsedCommand: ParsedCommand, userId: string, channelId: string, teamId: string, res: any): Promise<void> {
  let processingMessageTs: string | null = null;

  try {
    // Send processing message using Bot token with complexity info
    const complexityMessage = parsedCommand.metadata.complexity === 'complex' 
      ? '\n\n🎨 복잡한 서식이 감지되었습니다. 구조를 보존하여 처리합니다.' 
      : '';

    processingMessageTs = await sendEphemeralProcessingMessage(
      channelId, 
      userId, 
      `AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!\n\n완료되면 사용자 이름으로 응답이 표시됩니다.${complexityMessage}`
    );

    // Bot 메시지 성공 여부에 따른 slash command 응답
    if (processingMessageTs) {
      // Bot 메시지가 성공하면 아무 응답도 하지 않음 (빈 응답)
      res.status(200).send();
    } else {
      // Bot 메시지 실패 시 fallback 응답
      res.json({
        response_type: 'ephemeral',
        text: `AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!${complexityMessage}`
      });
    }

    const userToken = await getUserToken(userId, teamId);
    if (!userToken) {
      console.error('User token not found:', { userId, teamId });
      await sendBotMessage(channelId, '❌ OAuth 토큰을 찾을 수 없습니다. 다시 인증해주세요.');
      return;
    }

    // TRD Phase 1.4 - 서식 보존 AI 프롬프트 생성
    const promptConfig: PromptConfig = {
      task: parsedCommand.task,
      content: parsedCommand.content,
      metadata: parsedCommand.metadata,
      preservationLevel: 'adaptive' // 기본값으로 adaptive 사용
    };

    const systemPrompt = formatAwarePrompts.generatePrompt(promptConfig);

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

    console.log('🎯 AI processing with format preservation started:', { 
      userId, 
      task: parsedCommand.task.substring(0, 30) + '...',
      complexity: parsedCommand.metadata.complexity 
    });
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
    console.log('✅ AI processing with format preservation completed:', { 
      userId, 
      processingTime, 
      responseLength: content.length,
      originalComplexity: parsedCommand.metadata.complexity
    });

    // Send response as user
    await sendUserMessage(channelId, content, userToken);
    console.log('📤 Format-preserved AI response sent as user:', { userId, channelId });

    // Delete the processing message
    if (processingMessageTs) {
      await deleteMessage(channelId, processingMessageTs);
      console.log('Processing message deleted:', { userId, channelId, messageTs: processingMessageTs });
    }

  } catch (error) {
    console.error('❌ Format preservation AI processing failed:', { error, userId, channelId });
    
    // Delete processing message even on error
    if (processingMessageTs) {
      await deleteMessage(channelId, processingMessageTs);
    }
    
    await sendBotMessage(channelId, '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
  }
}

// AI processing with user token
async function processAIRequestWithUserToken(prompt: string, data: string, userId: string, channelId: string, teamId: string): Promise<void> {
  try {
    const userToken = await getUserToken(userId, teamId);
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

// Enhanced AI processing with user token and message tracking
async function processAIRequestWithUserTokenAndTracking(prompt: string, data: string, userId: string, channelId: string, teamId: string, res: any): Promise<void> {
  let processingMessageTs: string | null = null;

  try {
    // Send processing message using Bot token
    processingMessageTs = await sendEphemeralProcessingMessage(
      channelId, 
      userId, 
      'AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!\n\n완료되면 사용자 이름으로 응답이 표시됩니다.'
    );

    // Bot 메시지 성공 여부에 따른 slash command 응답
    if (processingMessageTs) {
      // Bot 메시지가 성공하면 아무 응답도 하지 않음 (빈 응답)
      res.status(200).send();
    } else {
      // Bot 메시지 실패 시 fallback 응답
      res.json({
        response_type: 'ephemeral',
        text: 'AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!'
      });
    }

    const userToken = await getUserToken(userId, teamId);
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

    // Delete the processing message
    if (processingMessageTs) {
      await deleteMessage(channelId, processingMessageTs);
      console.log('Processing message deleted:', { userId, channelId, messageTs: processingMessageTs });
    }

  } catch (error) {
    console.error('AI processing failed:', { error, userId, channelId });
    
    // Delete processing message even on error
    if (processingMessageTs) {
      await deleteMessage(channelId, processingMessageTs);
    }
    
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