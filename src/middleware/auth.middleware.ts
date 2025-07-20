import { Request, Response, NextFunction } from 'express';
import { SessionService } from '../services/session.service';
import { logger } from '../utils/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    workspaceId: string;
    accessToken: string;
  };
}

export class AuthMiddleware {
  private sessionService: SessionService;
  private readonly baseUrl: string;

  constructor() {
    this.sessionService = new SessionService();
    this.baseUrl = process.env.BASE_URL || 'https://writerly-slack-ai-177365346300.us-central1.run.app';
  }

  // Slack 명령어에서 사용자 인증 확인
  requireSlackAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, team_id } = req.body;

      if (!user_id || !team_id) {
        res.json({
          response_type: 'ephemeral',
          text: '❌ 사용자 정보를 확인할 수 없습니다.'
        });
        return;
      }

      // OAuth 세션 확인
      const session = await this.sessionService.getOAuthSession(user_id, team_id);

      if (!session || !session.oauthTokens) {
        // 인증이 필요한 경우 OAuth 플로우 시작
        const authUrl = `${this.baseUrl}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
        
        res.json({
          response_type: 'ephemeral',
          text: '🔐 AI를 사용하려면 먼저 인증이 필요합니다.',
          attachments: [{
            color: '#007ac7',
            text: '아래 버튼을 클릭하여 Writerly를 인증하세요.',
            actions: [{
              type: 'button',
              text: '🔗 Writerly 인증하기',
              url: authUrl,
              style: 'primary'
            }]
          }]
        });
        return;
      }

      // 토큰 만료 확인
      if (session.oauthTokens.expires_at && session.oauthTokens.expires_at <= new Date()) {
        // 토큰이 만료된 경우 refresh token으로 갱신 시도
        if (session.oauthTokens.refresh_token) {
          try {
            const refreshed = await this.refreshAccessToken(user_id, team_id, session.oauthTokens.refresh_token);
            if (refreshed) {
              const updatedSession = await this.sessionService.getOAuthSession(user_id, team_id);
              if (updatedSession?.oauthTokens) {
                // 갱신된 토큰으로 요청 계속 진행
                req.user = {
                  userId: user_id,
                  workspaceId: team_id,
                  accessToken: updatedSession.oauthTokens.access_token
                };
                next();
                return;
              }
            }
          } catch (error) {
            logger.error('토큰 갱신 실패', { error, user_id, team_id });
          }
        }

        // 토큰 갱신에 실패한 경우 재인증 요구
        const authUrl = `${this.baseUrl}/auth/slack?user_id=${encodeURIComponent(user_id)}&team_id=${encodeURIComponent(team_id)}`;
        
        res.json({
          response_type: 'ephemeral',
          text: '🔐 인증이 만료되었습니다. 다시 인증해주세요.',
          attachments: [{
            color: '#ff6b35',
            text: '아래 버튼을 클릭하여 Writerly를 다시 인증하세요.',
            actions: [{
              type: 'button',
              text: '🔗 다시 인증하기',
              url: authUrl,
              style: 'primary'
            }]
          }]
        });
        return;
      }

      // 인증 성공 - 사용자 정보를 요청에 추가
      req.user = {
        userId: user_id,
        workspaceId: team_id,
        accessToken: session.oauthTokens.access_token
      };

      // 세션 TTL 연장
      await this.sessionService.extendOAuthSession(user_id, team_id);

      next();

    } catch (error) {
      logger.error('인증 미들웨어 오류', { error, body: req.body });
      
      res.json({
        response_type: 'ephemeral',
        text: '❌ 인증 확인 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      });
    }
  };

  // OAuth 토큰 갱신
  private async refreshAccessToken(userId: string, workspaceId: string, refreshToken: string): Promise<boolean> {
    try {
      const response = await fetch('https://slack.com/api/oauth.v2.access', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: process.env.SLACK_CLIENT_ID || '',
          client_secret: process.env.SLACK_CLIENT_SECRET || '',
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
        }),
      });

      const data = await response.json();

      if (!data.ok) {
        logger.error('토큰 갱신 실패', { error: data.error, userId, workspaceId });
        return false;
      }

      const newTokens = {
        access_token: data.access_token,
        refresh_token: data.refresh_token || refreshToken,
        expires_at: data.expires_in ? 
          new Date(Date.now() + data.expires_in * 1000) : 
          undefined,
        scope: data.scope
      };

      const updated = await this.sessionService.updateOAuthTokens(userId, workspaceId, newTokens);
      
      if (updated) {
        logger.info('토큰 갱신 성공', { userId, workspaceId });
      }

      return updated;

    } catch (error) {
      logger.error('토큰 갱신 요청 실패', { error, userId, workspaceId });
      return false;
    }
  }

  // API 엔드포인트용 인증 미들웨어 (쿼리 파라미터 기반)
  requireAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const { user_id, team_id } = req.query;

      if (!user_id || !team_id) {
        res.status(401).json({ 
          error: 'user_id와 team_id가 필요합니다' 
        });
        return;
      }

      const session = await this.sessionService.getOAuthSession(
        user_id as string, 
        team_id as string
      );

      if (!session || !session.oauthTokens) {
        res.status(401).json({ 
          error: '인증이 필요합니다',
          auth_url: `${this.baseUrl}/auth/slack?user_id=${encodeURIComponent(user_id as string)}&team_id=${encodeURIComponent(team_id as string)}`
        });
        return;
      }

      // 토큰 만료 확인
      if (session.oauthTokens.expires_at && session.oauthTokens.expires_at <= new Date()) {
        res.status(401).json({ 
          error: '토큰이 만료되었습니다',
          auth_url: `${this.baseUrl}/auth/slack?user_id=${encodeURIComponent(user_id as string)}&team_id=${encodeURIComponent(team_id as string)}`
        });
        return;
      }

      req.user = {
        userId: user_id as string,
        workspaceId: team_id as string,
        accessToken: session.oauthTokens.access_token
      };

      next();

    } catch (error) {
      logger.error('API 인증 미들웨어 오류', error);
      res.status(500).json({ 
        error: '인증 확인 중 오류가 발생했습니다' 
      });
    }
  };

  // Slack 요청 서명 검증 미들웨어
  verifySlackSignature = (req: Request, res: Response, next: NextFunction): void => {
    try {
      const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
      
      if (!slackSigningSecret) {
        logger.error('SLACK_SIGNING_SECRET이 설정되지 않았습니다');
        res.status(500).json({ error: '서버 설정 오류' });
        return;
      }

      const signature = req.headers['x-slack-signature'] as string;
      const timestamp = req.headers['x-slack-request-timestamp'] as string;
      const body = JSON.stringify(req.body);

      if (!signature || !timestamp) {
        res.status(400).json({ error: '잘못된 Slack 요청입니다' });
        return;
      }

      // 타임스탬프 검증 (5분 이내)
      const currentTime = Math.floor(Date.now() / 1000);
      if (Math.abs(currentTime - parseInt(timestamp)) > 300) {
        res.status(400).json({ error: '요청이 만료되었습니다' });
        return;
      }

      // 서명 검증
      const crypto = require('crypto');
      const hmac = crypto.createHmac('sha256', slackSigningSecret);
      hmac.update(`v0:${timestamp}:${body}`);
      const expectedSignature = `v0=${hmac.digest('hex')}`;

      if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) {
        res.status(400).json({ error: '잘못된 서명입니다' });
        return;
      }

      next();

    } catch (error) {
      logger.error('Slack 서명 검증 실패', error);
      res.status(400).json({ error: 'Slack 서명 검증에 실패했습니다' });
    }
  };
}

// 싱글톤 인스턴스 생성
export const authMiddleware = new AuthMiddleware();