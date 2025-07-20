/**
 * Slack 관련 설정
 * ADR-010: 포괄적인 도움말 시스템 통합
 */

export interface SlackConfig {
  clientId: string;
  clientSecret: string;
  signingSecret: string;
  scopes: string[];
  redirectUri: string;
  botToken?: string;
  userToken?: string;
}

export interface SlashCommandConfig {
  command: string;
  description: string;
  usage: string;
  maxInputLength: number;
  helpText: string;
}

export class SlackConfigManager {
  private static instance: SlackConfigManager;
  
  private constructor() {}

  public static getInstance(): SlackConfigManager {
    if (!SlackConfigManager.instance) {
      SlackConfigManager.instance = new SlackConfigManager();
    }
    return SlackConfigManager.instance;
  }

  /**
   * Slack OAuth 설정
   */
  public getOAuthConfig(): SlackConfig {
    const config: SlackConfig = {
      clientId: this.getRequiredEnv('SLACK_CLIENT_ID'),
      clientSecret: this.getRequiredEnv('SLACK_CLIENT_SECRET'),
      signingSecret: this.getRequiredEnv('SLACK_SIGNING_SECRET'),
      scopes: [
        'commands',
        'chat:write',
        'users:read',
        'team:read'
      ],
      redirectUri: this.getRequiredEnv('SLACK_REDIRECT_URI')
    };

    return config;
  }

  /**
   * 슬래시 커맨드 설정
   */
  public getSlashCommandConfig(): SlashCommandConfig {
    return {
      command: '/ai',
      description: 'AI 어시스턴트를 사용하여 다양한 작업을 수행합니다',
      usage: '/ai "프롬프트" "데이터"',
      maxInputLength: 10000,
      helpText: this.generateHelpText()
    };
  }

  /**
   * 도움말 텍스트 생성 (ADR-010)
   */
  private generateHelpText(): string {
    const maxLength = 10000;
    
    return `🤖 *AI Assistant 사용법*

*기본 사용법:*
\`/ai "프롬프트" "데이터"\`

*예시:*
• \`/ai "요약해줘" "긴 텍스트..."\`
• \`/ai "번역해줘" "Hello world"\`
• \`/ai "분석해줘" "매출 데이터..."\`

*주의사항:*
• 최대 ${maxLength.toLocaleString()}자까지 입력 가능
• 큰따옴표(")로 프롬프트와 데이터를 구분
• 처리 시간은 보통 5-30초 소요

*도움이 필요하신가요?*
관리자에게 문의하세요.`;
  }

  /**
   * Slack 인증 URL 생성
   */
  public generateAuthUrl(state?: string): string {
    const config = this.getOAuthConfig();
    const params = new URLSearchParams({
      client_id: config.clientId,
      scope: config.scopes.join(','),
      redirect_uri: config.redirectUri,
      response_type: 'code'
    });

    if (state) {
      params.append('state', state);
    }

    return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
  }

  /**
   * 요청 서명 검증
   */
  public verifySignature(timestamp: string, body: string, signature: string): boolean {
    const crypto = require('crypto');
    const signingSecret = this.getRequiredEnv('SLACK_SIGNING_SECRET');
    
    // 타임스탬프 검증 (재생 공격 방지)
    const currentTime = Math.floor(Date.now() / 1000);
    if (Math.abs(currentTime - parseInt(timestamp)) > 60 * 5) { // 5분 제한
      return false;
    }

    // 서명 검증
    const sigBasestring = `v0:${timestamp}:${body}`;
    const mySignature = 'v0=' + crypto
      .createHmac('sha256', signingSecret)
      .update(sigBasestring, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(mySignature, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  }

  /**
   * 환경 변수 검증
   */
  public validateEnvironment(): { valid: boolean; missing: string[] } {
    const requiredVars = [
      'SLACK_CLIENT_ID',
      'SLACK_CLIENT_SECRET', 
      'SLACK_SIGNING_SECRET',
      'SLACK_REDIRECT_URI'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    
    return {
      valid: missing.length === 0,
      missing
    };
  }

  private getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }
}

// 싱글톤 인스턴스 내보내기
export const slackConfig = SlackConfigManager.getInstance();