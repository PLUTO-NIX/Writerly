import { logger } from './logger';

export interface SlackMessagePayload {
  text: string;
  response_type?: 'in_channel' | 'ephemeral';
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}

export interface SlackAttachment {
  color?: string;
  text?: string;
  title?: string;
  title_link?: string;
  fields?: Array<{
    title: string;
    value: string;
    short?: boolean;
  }>;
  actions?: Array<{
    type: string;
    text: string;
    url?: string;
    style?: string;
  }>;
}

export interface SlackBlock {
  type: string;
  text?: {
    type: string;
    text: string;
  };
  elements?: any[];
}

/**
 * 기본 postToSlack 함수 - response_url 사용
 * @param responseUrl Slack response URL
 * @param payload 메시지 페이로드
 */
export async function postToSlack(
  responseUrl: string, 
  payload: SlackMessagePayload
): Promise<void> {
  try {
    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    logger.info('Slack 메시지 전송 성공 (response_url)', { 
      responseUrl: responseUrl.substring(0, 50) + '...',
      textLength: payload.text.length 
    });

  } catch (error) {
    logger.error('postToSlack 실패', { 
      error, 
      responseUrl: responseUrl.substring(0, 50) + '...' 
    });
    throw error;
  }
}

/**
 * User token으로 사용자 대신 메시지 전송
 * @param userToken 사용자 OAuth 토큰 (xoxp-)
 * @param channel 채널 ID
 * @param payload 메시지 페이로드
 */
export async function postToSlackAsUser(
  userToken: string,
  channel: string,
  payload: SlackMessagePayload
): Promise<void> {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: payload.text,
        as_user: true, // 사용자 대신 메시지 전송
        attachments: payload.attachments,
        blocks: payload.blocks,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    logger.info('사용자 메시지 전송 성공', { 
      channel, 
      messageId: data.ts,
      textLength: payload.text.length 
    });

  } catch (error) {
    logger.error('postToSlackAsUser 실패', { 
      error, 
      channel, 
      tokenPrefix: userToken.substring(0, 10) + '...' 
    });
    throw error;
  }
}

/**
 * Bot token으로 봇 메시지 전송
 * @param botToken 봇 토큰 (xoxb-)
 * @param channel 채널 ID
 * @param payload 메시지 페이로드
 */
export async function postToSlackAsBot(
  botToken: string,
  channel: string, 
  payload: SlackMessagePayload
): Promise<void> {
  try {
    const response = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${botToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel,
        text: payload.text,
        as_user: false, // 봇으로 메시지 전송
        attachments: payload.attachments,
        blocks: payload.blocks,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Slack API error: ${data.error}`);
    }

    logger.info('봇 메시지 전송 성공', { 
      channel, 
      messageId: data.ts,
      textLength: payload.text.length 
    });

  } catch (error) {
    logger.error('postToSlackAsBot 실패', { 
      error, 
      channel, 
      tokenPrefix: botToken.substring(0, 10) + '...' 
    });
    throw error;
  }
}

/**
 * 재시도 로직이 포함된 postToSlack 함수
 * @param fn 실행할 함수
 * @param maxRetries 최대 재시도 횟수
 * @param delayMs 재시도 간격 (밀리초)
 */
export async function retrySlackOperation<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  delayMs: number = 1000
): Promise<T> {
  let lastError: Error;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === maxRetries) {
        logger.error('Slack 작업 최대 재시도 횟수 초과', { 
          error: lastError, 
          attempts: attempt + 1 
        });
        throw lastError;
      }

      logger.warn(`Slack 작업 재시도 중 (${attempt + 1}/${maxRetries})`, { 
        error: lastError, 
        nextRetryInMs: delayMs 
      });

      // 지수 백오프 적용
      await new Promise(resolve => setTimeout(resolve, delayMs * Math.pow(2, attempt)));
    }
  }

  throw lastError!;
}

/**
 * postToSlackAsUser with retry
 */
export async function postToSlackAsUserWithRetry(
  userToken: string,
  channel: string,
  payload: SlackMessagePayload,
  maxRetries: number = 3
): Promise<void> {
  return retrySlackOperation(
    () => postToSlackAsUser(userToken, channel, payload),
    maxRetries
  );
}

/**
 * postToSlackAsBot with retry
 */
export async function postToSlackAsBotWithRetry(
  botToken: string,
  channel: string,
  payload: SlackMessagePayload,
  maxRetries: number = 3
): Promise<void> {
  return retrySlackOperation(
    () => postToSlackAsBot(botToken, channel, payload),
    maxRetries
  );
}

/**
 * 일반적인 메시지 페이로드 생성 헬퍼
 */
export function createSlackMessagePayload(
  text: string,
  responseType: 'in_channel' | 'ephemeral' = 'in_channel',
  attachments?: SlackAttachment[]
): SlackMessagePayload {
  return {
    text,
    response_type: responseType,
    attachments,
  };
}

/**
 * 인증 프롬프트 메시지 생성 헬퍼
 */
export function createAuthPromptPayload(authUrl: string): SlackMessagePayload {
  return {
    text: '🔐 AI 기능을 사용하려면 인증이 필요합니다.',
    response_type: 'ephemeral',
    attachments: [{
      color: '#007ac7',
      text: 'OAuth 인증을 완료하면 AI가 사용자 이름으로 응답할 수 있습니다.',
      actions: [{
        type: 'button',
        text: '🔗 지금 인증하기',
        url: authUrl,
        style: 'primary'
      }]
    }]
  };
}

/**
 * 에러 메시지 페이로드 생성 헬퍼
 */
export function createErrorMessagePayload(errorMessage: string): SlackMessagePayload {
  return {
    text: `❌ ${errorMessage}`,
    response_type: 'ephemeral',
    attachments: [{
      color: '#ff6b35',
      text: '문제가 지속되면 관리자에게 문의하세요.'
    }]
  };
}