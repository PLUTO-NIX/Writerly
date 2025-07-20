import { logger } from '../utils/logger';

export interface SlackOAuthResponse {
  access_token: string;
  team: {
    id: string;
    name: string;
  };
  authed_user: {
    id: string;
  };
  scope?: string;
}

export interface SlackUserInfo {
  id: string;
  name: string;
  real_name: string;
  email?: string;
}

export interface SlackMessage {
  channel: string;
  text: string;
  user?: string;
  as_user?: boolean;
  username?: string;
  icon_emoji?: string;
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

export interface SlackApiResponse {
  ok: boolean;
  error?: string;
  ts?: string;
  channel?: string;
  message?: any;
}

export class SlackWebApiClient {
  private readonly baseUrl = 'https://slack.com/api';

  constructor(private readonly accessToken: string) {}

  // 메시지 전송 (사용자 대신)
  async postMessage(message: SlackMessage): Promise<SlackApiResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          as_user: true, // 사용자 대신 메시지 전송
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        logger.error('Slack 메시지 전송 실패', { 
          error: data.error, 
          channel: message.channel 
        });
      }

      return data;

    } catch (error) {
      logger.error('Slack API 요청 실패', { error, endpoint: 'chat.postMessage' });
      return { 
        ok: false, 
        error: '메시지 전송 중 오류가 발생했습니다' 
      };
    }
  }

  // 메시지 업데이트
  async updateMessage(channel: string, ts: string, text: string): Promise<SlackApiResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat.update`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel,
          ts,
          text,
          as_user: true,
        }),
      });

      return await response.json();

    } catch (error) {
      logger.error('Slack 메시지 업데이트 실패', { error, channel, ts });
      return { 
        ok: false, 
        error: '메시지 업데이트 중 오류가 발생했습니다' 
      };
    }
  }

  // 사용자 정보 조회
  async getUserInfo(userId?: string): Promise<SlackUserInfo | null> {
    try {
      const response = await fetch(`${this.baseUrl}/users.info${userId ? `?user=${userId}` : ''}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      const data = await response.json();

      if (!data.ok || !data.user) {
        logger.error('사용자 정보 조회 실패', { error: data.error, userId });
        return null;
      }

      return {
        id: data.user.id,
        name: data.user.name,
        real_name: data.user.real_name,
        email: data.user.profile?.email,
      };

    } catch (error) {
      logger.error('사용자 정보 API 요청 실패', { error, userId });
      return null;
    }
  }

  // 채널 정보 조회
  async getChannelInfo(channel: string): Promise<any> {
    try {
      const response = await fetch(`${this.baseUrl}/conversations.info?channel=${channel}`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      const data = await response.json();

      if (!data.ok) {
        logger.error('채널 정보 조회 실패', { error: data.error, channel });
        return null;
      }

      return data.channel;

    } catch (error) {
      logger.error('채널 정보 API 요청 실패', { error, channel });
      return null;
    }
  }

  // 토큰 검증
  async testAuth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth.test`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
      });

      const data = await response.json();
      return data.ok;

    } catch (error) {
      logger.error('토큰 검증 실패', error);
      return false;
    }
  }
}

export class SlackBotClient {
  private readonly baseUrl = 'https://slack.com/api';

  constructor(private readonly botToken: string) {}

  // Bot token으로 기본 메시지 전송
  async postBotMessage(channel: string, message: SlackMessage): Promise<SlackApiResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          channel,
          as_user: false, // Bot으로 메시지 전송
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        logger.error('Bot 메시지 전송 실패', { 
          error: data.error, 
          channel 
        });
      }

      return data;

    } catch (error) {
      logger.error('Bot API 요청 실패', { error, endpoint: 'chat.postMessage' });
      return { 
        ok: false, 
        error: 'Bot 메시지 전송 중 오류가 발생했습니다' 
      };
    }
  }

  // 인증 안내 메시지 전송
  async sendAuthPrompt(channel: string, authUrl: string): Promise<SlackApiResponse> {
    const message: SlackMessage = {
      channel,
      text: '🔐 AI 기능을 사용하려면 인증이 필요합니다.',
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

    return this.postBotMessage(channel, message);
  }

  // 에러 메시지 전송
  async sendErrorMessage(channel: string, error: string): Promise<SlackApiResponse> {
    const message: SlackMessage = {
      channel,
      text: `❌ ${error}`,
      attachments: [{
        color: '#ff6b35',
        text: '문제가 지속되면 관리자에게 문의하세요.'
      }]
    };

    return this.postBotMessage(channel, message);
  }

  // Bot 토큰 검증
  async testAuth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth.test`, {
        headers: {
          'Authorization': `Bearer ${this.botToken}`,
        },
      });

      const data = await response.json();
      return data.ok;

    } catch (error) {
      logger.error('Bot 토큰 검증 실패', error);
      return false;
    }
  }
}

export class SlackUserClient {
  private readonly baseUrl = 'https://slack.com/api';

  constructor(private readonly userToken: string) {}

  // User token으로 사용자 대신 메시지 전송
  async postAsUser(channel: string, message: SlackMessage): Promise<SlackApiResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat.postMessage`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.userToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...message,
          channel,
          as_user: true, // 사용자 대신 메시지 전송
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        logger.error('사용자 메시지 전송 실패', { 
          error: data.error, 
          channel 
        });
      }

      return data;

    } catch (error) {
      logger.error('사용자 API 요청 실패', { error, endpoint: 'chat.postMessage' });
      return { 
        ok: false, 
        error: '사용자 메시지 전송 중 오류가 발생했습니다' 
      };
    }
  }

  // User 토큰 검증
  async testAuth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/auth.test`, {
        headers: {
          'Authorization': `Bearer ${this.userToken}`,
        },
      });

      const data = await response.json();
      return data.ok;

    } catch (error) {
      logger.error('User 토큰 검증 실패', error);
      return false;
    }
  }
}

export class SlackService {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;

  constructor(clientId: string, clientSecret: string, redirectUri: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;
  }

  // OAuth URL 생성
  getAuthorizeUrl(state?: string): string {
    if (!this.clientId) {
      throw new Error('OAuth 설정 오류');
    }

    const scopes = [
      'users:read',
      'chat:write',
      'chat:write.public',
      'channels:history',
      'groups:history',
      'im:history',
      'mpim:history'
    ].join(',');

    const params = new URLSearchParams({
      client_id: this.clientId,
      scope: scopes,
      redirect_uri: this.redirectUri,
      user_scope: 'chat:write',
    });

    if (state) {
      params.set('state', state);
    }

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  // 코드를 토큰으로 교환
  async exchangeCodeForToken(code: string): Promise<SlackOAuthResponse> {
    try {
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          code,
          redirect_uri: this.redirectUri,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        throw new Error(`OAuth 토큰 교환 실패: ${data.error}`);
      }

      return {
        access_token: data.access_token,
        team: {
          id: data.team.id,
          name: data.team.name,
        },
        authed_user: {
          id: data.authed_user.id,
        },
        scope: data.scope,
      };

    } catch (error) {
      logger.error('OAuth 토큰 교환 실패', error);
      throw error;
    }
  }

  // 사용자 정보 조회
  async getUserInfo(token: string): Promise<SlackUserInfo> {
    const client = new SlackWebApiClient(token);
    const userInfo = await client.getUserInfo();

    if (!userInfo) {
      throw new Error('사용자 정보를 가져올 수 없습니다');
    }

    return userInfo;
  }

  // Web API 클라이언트 생성
  createWebApiClient(accessToken: string): SlackWebApiClient {
    return new SlackWebApiClient(accessToken);
  }
}