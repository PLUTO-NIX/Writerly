import { Request, Response } from 'express';
import { SessionService, OAuthTokens } from '../services/session.service';
import { logger } from '../utils/logger';

export class AuthController {
  private sessionService: SessionService;
  private readonly slackClientId: string;
  private readonly slackClientSecret: string;
  private readonly redirectUri: string;

  constructor() {
    this.sessionService = new SessionService();
    this.slackClientId = process.env.SLACK_CLIENT_ID || '';
    this.slackClientSecret = process.env.SLACK_CLIENT_SECRET || '';
    this.redirectUri = `${process.env.BASE_URL || 'https://writerly-slack-ai-177365346300.us-central1.run.app'}/auth/slack/callback`;

    if (!this.slackClientId || !this.slackClientSecret) {
      logger.error('Slack OAuth 환경변수가 설정되지 않았습니다');
    }
  }

  // OAuth 인증 시작 - Slack 로그인 페이지로 리디렉션
  async initiateAuth(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, team_id } = req.query;

      if (!user_id || !team_id) {
        res.status(400).json({ 
          error: 'user_id와 team_id가 필요합니다' 
        });
        return;
      }

      // State parameter에 user_id와 team_id 포함 (CSRF 방지)
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
      authUrl.searchParams.set('client_id', this.slackClientId);
      authUrl.searchParams.set('scope', scopes);
      authUrl.searchParams.set('redirect_uri', this.redirectUri);
      authUrl.searchParams.set('state', state);
      authUrl.searchParams.set('user_scope', 'chat:write');

      logger.info('OAuth 인증 시작', { user_id, team_id });

      res.redirect(authUrl.toString());
    } catch (error) {
      logger.error('OAuth 인증 시작 실패', error as any);
      res.status(500).json({ 
        error: '인증 시작 중 오류가 발생했습니다' 
      });
    }
  }

  // OAuth 콜백 처리 - Slack에서 인증 후 돌아오는 지점
  async handleCallback(req: Request, res: Response): Promise<void> {
    try {
      const { code, state, error } = req.query;

      if (error) {
        logger.error('OAuth 인증 거부됨', { error });
        res.status(400).send(`
          <html>
            <body>
              <h2>❌ 인증이 취소되었습니다</h2>
              <p>Slack 인증을 완료하려면 다시 시도해주세요.</p>
              <script>window.close();</script>
            </body>
          </html>
        `);
        return;
      }

      if (!code || !state) {
        res.status(400).json({ 
          error: '인증 코드 또는 상태 정보가 없습니다' 
        });
        return;
      }

      // State 검증
      let stateData;
      try {
        stateData = JSON.parse(Buffer.from(state as string, 'base64').toString());
      } catch {
        res.status(400).json({ 
          error: '잘못된 상태 정보입니다' 
        });
        return;
      }

      const { user_id, team_id, timestamp } = stateData;

      // State 만료 확인 (10분)
      if (Date.now() - timestamp > 10 * 60 * 1000) {
        res.status(400).json({ 
          error: '인증 요청이 만료되었습니다' 
        });
        return;
      }

      // Access token 교환
      const tokenResponse = await this.exchangeCodeForToken(code as string);
      if (!tokenResponse) {
        res.status(500).json({ 
          error: '토큰 교환에 실패했습니다' 
        });
        return;
      }

      // 세션 생성
      const sessionId = await this.sessionService.createOAuthSession(
        user_id,
        team_id,
        tokenResponse
      );

      logger.info('OAuth 인증 완료', { 
        user_id, 
        team_id, 
        sessionId: sessionId.substring(0, 20) + '...' 
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
      logger.error('OAuth 콜백 처리 실패', error);
      res.status(500).json({ 
        error: '인증 처리 중 오류가 발생했습니다' 
      });
    }
  }

  // Access token으로 코드 교환
  private async exchangeCodeForToken(code: string): Promise<OAuthTokens | null> {
    try {
      const tokenUrl = 'https://slack.com/api/oauth.v2.access';
      
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.slackClientId,
          client_secret: this.slackClientSecret,
          code,
          redirect_uri: this.redirectUri,
        }),
      });

      const data = await response.json() as any;

      if (!data.ok) {
        logger.error('토큰 교환 실패', { error: data.error });
        return null;
      }

      return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_in ? 
          new Date(Date.now() + data.expires_in * 1000) : 
          undefined,
        scope: data.scope
      };

    } catch (error) {
      logger.error('토큰 교환 요청 실패', error);
      return null;
    }
  }

  // 사용자 인증 상태 확인
  async checkAuthStatus(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, team_id } = req.query;

      if (!user_id || !team_id) {
        res.status(400).json({ 
          error: 'user_id와 team_id가 필요합니다' 
        });
        return;
      }

      const hasSession = await this.sessionService.hasOAuthSession(
        user_id as string, 
        team_id as string
      );

      res.json({
        authenticated: hasSession,
        user_id,
        team_id
      });

    } catch (error) {
      logger.error('인증 상태 확인 실패', error);
      res.status(500).json({ 
        error: '인증 상태 확인 중 오류가 발생했습니다' 
      });
    }
  }

  // 인증 해제 (로그아웃)
  async revokeAuth(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, team_id } = req.body;

      if (!user_id || !team_id) {
        res.status(400).json({ 
          error: 'user_id와 team_id가 필요합니다' 
        });
        return;
      }

      const deleted = await this.sessionService.deleteOAuthSession(
        user_id, 
        team_id
      );

      res.json({
        success: deleted,
        message: deleted ? '인증이 해제되었습니다' : '세션을 찾을 수 없습니다'
      });

    } catch (error) {
      logger.error('인증 해제 실패', error);
      res.status(500).json({ 
        error: '인증 해제 중 오류가 발생했습니다' 
      });
    }
  }

  // OAuth 토큰 갱신
  async refreshToken(req: Request, res: Response): Promise<void> {
    try {
      const { user_id, team_id } = req.body;

      if (!user_id || !team_id) {
        res.status(400).json({ 
          error: 'user_id와 team_id가 필요합니다' 
        });
        return;
      }

      const session = await this.sessionService.getOAuthSession(user_id, team_id);
      if (!session?.oauthTokens?.refresh_token) {
        res.status(404).json({ 
          error: '갱신할 토큰을 찾을 수 없습니다' 
        });
        return;
      }

      // Slack refresh token 요청
      const refreshUrl = 'https://slack.com/api/oauth.v2.access';
      const response = await fetch(refreshUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.slackClientId,
          client_secret: this.slackClientSecret,
          grant_type: 'refresh_token',
          refresh_token: session.oauthTokens.refresh_token,
        }),
      });

      const data = await response.json() as any;

      if (!data.ok) {
        logger.error('토큰 갱신 실패', { error: data.error });
        res.status(400).json({ 
          error: '토큰 갱신에 실패했습니다' 
        });
        return;
      }

      const newTokens: OAuthTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || session.oauthTokens.refresh_token,
        expires_at: data.expires_in ? 
          new Date(Date.now() + data.expires_in * 1000) : 
          undefined,
        scope: data.scope
      };

      const updated = await this.sessionService.updateOAuthTokens(
        user_id, 
        team_id, 
        newTokens
      );

      res.json({
        success: updated,
        message: updated ? '토큰이 갱신되었습니다' : '토큰 갱신에 실패했습니다'
      });

    } catch (error) {
      logger.error('토큰 갱신 실패', error);
      res.status(500).json({ 
        error: '토큰 갱신 중 오류가 발생했습니다' 
      });
    }
  }
}