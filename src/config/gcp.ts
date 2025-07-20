/**
 * GCP 관련 설정
 * ADR-007: Vertex AI Gemini 2.5 Flash 전용 모델 사용
 */

export interface GCPConfig {
  projectId: string;
  location: string;
  serviceUrl: string;
}

export interface VertexAIConfig {
  projectId: string;
  location: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number;
  topK: number;
}

export interface CloudTasksConfig {
  projectId: string;
  location: string;
  queueName: string;
  serviceUrl: string;
  serviceAccount: string;
}

export interface SecretManagerConfig {
  projectId: string;
  secrets: {
    slackClientSecret: string;
    slackSigningSecret: string;
    encryptionKey: string;
  };
}

export class GCPConfigManager {
  private static instance: GCPConfigManager;
  
  private constructor() {}

  public static getInstance(): GCPConfigManager {
    if (!GCPConfigManager.instance) {
      GCPConfigManager.instance = new GCPConfigManager();
    }
    return GCPConfigManager.instance;
  }

  /**
   * 기본 GCP 설정
   */
  public getGCPConfig(): GCPConfig {
    return {
      projectId: this.getRequiredEnv('GCP_PROJECT_ID'),
      location: this.getEnvWithDefault('GCP_LOCATION', 'us-central1'),
      serviceUrl: this.getRequiredEnv('GCP_SERVICE_URL')
    };
  }

  /**
   * Vertex AI 설정 (ADR-007: Gemini 2.5 Flash)
   */
  public getVertexAIConfig(): VertexAIConfig {
    return {
      projectId: this.getRequiredEnv('GCP_PROJECT_ID'),
      location: this.getEnvWithDefault('GCP_LOCATION', 'us-central1'),
      model: 'gemini-2.5-flash', // ADR-007: 전용 모델
      maxTokens: parseInt(this.getEnvWithDefault('VERTEX_AI_MAX_TOKENS', '8192')),
      temperature: parseFloat(this.getEnvWithDefault('VERTEX_AI_TEMPERATURE', '0.7')),
      topP: parseFloat(this.getEnvWithDefault('VERTEX_AI_TOP_P', '0.8')),
      topK: parseInt(this.getEnvWithDefault('VERTEX_AI_TOP_K', '40'))
    };
  }

  /**
   * Cloud Tasks 설정
   */
  public getCloudTasksConfig(): CloudTasksConfig {
    const projectId = this.getRequiredEnv('GCP_PROJECT_ID');
    return {
      projectId,
      location: this.getEnvWithDefault('GCP_LOCATION', 'us-central1'),
      queueName: this.getEnvWithDefault('CLOUD_TASKS_QUEUE_NAME', 'ai-processing-queue'),
      serviceUrl: this.getRequiredEnv('GCP_SERVICE_URL'),
      serviceAccount: `slack-ai-bot-sa@${projectId}.iam.gserviceaccount.com`
    };
  }

  /**
   * Secret Manager 설정
   */
  public getSecretManagerConfig(): SecretManagerConfig {
    return {
      projectId: this.getRequiredEnv('GCP_PROJECT_ID'),
      secrets: {
        slackClientSecret: this.getEnvWithDefault('SECRET_SLACK_CLIENT_SECRET', 'slack-client-secret'),
        slackSigningSecret: this.getEnvWithDefault('SECRET_SLACK_SIGNING_SECRET', 'slack-signing-secret'),
        encryptionKey: this.getEnvWithDefault('SECRET_ENCRYPTION_KEY', 'encryption-key')
      }
    };
  }

  /**
   * 전체 GCP 환경 검증
   */
  public validateGCPEnvironment(): { valid: boolean; missing: string[]; warnings: string[] } {
    const requiredVars = [
      'GCP_PROJECT_ID',
      'GCP_SERVICE_URL'
    ];

    const optionalVars = [
      'GCP_LOCATION',
      'VERTEX_AI_MAX_TOKENS',
      'VERTEX_AI_TEMPERATURE',
      'CLOUD_TASKS_QUEUE_NAME'
    ];

    const missing = requiredVars.filter(varName => !process.env[varName]);
    const warnings = optionalVars.filter(varName => !process.env[varName]);
    
    return {
      valid: missing.length === 0,
      missing,
      warnings
    };
  }

  /**
   * Vertex AI 모델 URL 생성
   */
  public getVertexAIEndpoint(): string {
    const config = this.getVertexAIConfig();
    return `https://${config.location}-aiplatform.googleapis.com/v1/projects/${config.projectId}/locations/${config.location}/publishers/google/models/${config.model}:generateContent`;
  }

  /**
   * Cloud Tasks 큐 경로 생성
   */
  public getCloudTasksQueuePath(): string {
    const config = this.getCloudTasksConfig();
    return `projects/${config.projectId}/locations/${config.location}/queues/${config.queueName}`;
  }

  /**
   * OIDC 토큰 생성을 위한 audience URL
   */
  public getOIDCAudience(): string {
    return this.getRequiredEnv('GCP_SERVICE_URL');
  }

  /**
   * 비용 제어 설정 (ADR-008)
   */
  public getCostControlConfig() {
    return {
      maxInputTokens: 10000, // 입력 토큰 제한
      maxOutputTokens: 2048, // 출력 토큰 제한
      dailyBudgetUSD: parseFloat(this.getEnvWithDefault('DAILY_BUDGET_USD', '10.0')),
      monthlyBudgetUSD: parseFloat(this.getEnvWithDefault('MONTHLY_BUDGET_USD', '300.0')),
      alertThresholds: [0.5, 0.8, 0.9] // 50%, 80%, 90% 임계값에서 알림
    };
  }

  /**
   * 환경별 리전 설정
   */
  public getRegionConfig() {
    const environment = process.env.NODE_ENV || 'development';
    
    switch (environment) {
      case 'production':
        return {
          primary: 'us-central1',
          backup: 'us-east1'
        };
      case 'staging':
        return {
          primary: 'us-central1',
          backup: null
        };
      default:
        return {
          primary: 'us-central1',
          backup: null
        };
    }
  }

  private getRequiredEnv(key: string): string {
    const value = process.env[key];
    if (!value) {
      throw new Error(`Required environment variable ${key} is not set`);
    }
    return value;
  }

  private getEnvWithDefault(key: string, defaultValue: string): string {
    return process.env[key] || defaultValue;
  }
}

// 싱글톤 인스턴스 내보내기
export const gcpConfig = GCPConfigManager.getInstance();