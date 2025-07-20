import { logger, LogMetadata } from '../utils/logger';

export interface TokenUsageMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  model: string;
  timestamp: Date;
  cost?: number; // 추후 계산용
}

export interface RequestMetrics {
  requestId: string;
  userId: string;
  workspaceId: string;
  endpoint: string;
  method: string;
  statusCode: number;
  duration: number;
  timestamp: Date;
  userAgent?: string;
  success: boolean;
}

export interface ErrorMetrics {
  errorType: string;
  errorMessage: string;
  stackTrace?: string;
  requestId: string;
  userId?: string;
  workspaceId?: string;
  endpoint: string;
  timestamp: Date;
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface BusinessMetrics {
  dailyActiveUsers: number;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgResponseTime: number;
  totalTokensUsed: number;
  date: string;
}

/**
 * 모니터링 및 메트릭 수집 서비스
 * - 토큰 사용량 추적
 * - 요청/응답 메트릭 수집
 * - 에러 발생률 모니터링
 * - 비즈니스 메트릭 집계
 */
export class MonitoringService {
  private static instance: MonitoringService;
  private dailyMetrics: Map<string, BusinessMetrics> = new Map();

  constructor() {
    if (MonitoringService.instance) {
      return MonitoringService.instance;
    }
    MonitoringService.instance = this;
  }

  /**
   * 토큰 사용량 로깅
   */
  logTokenUsage(
    requestId: string,
    userId: string,
    workspaceId: string,
    tokenUsage: TokenUsageMetrics
  ): void {
    const metadata: LogMetadata = {
      requestId,
      userId,
      workspaceId,
      action: 'token_usage',
      tokenUsage: {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
      },
    };

    logger.logTokenUsage(requestId, metadata.tokenUsage, {
      ...metadata,
      model: tokenUsage.model,
      cost: tokenUsage.cost,
    });

    // 일일 메트릭 업데이트
    this.updateDailyTokenUsage(tokenUsage.totalTokens);
  }

  /**
   * 요청 메트릭 로깅
   */
  logRequestMetrics(metrics: RequestMetrics): void {
    const metadata: LogMetadata = {
      requestId: metrics.requestId,
      userId: metrics.userId,
      workspaceId: metrics.workspaceId,
      action: 'request_metrics',
      duration: metrics.duration,
      statusCode: metrics.statusCode,
    };

    logger.info('요청 메트릭 수집', metadata);

    // 일일 메트릭 업데이트
    this.updateDailyRequestMetrics(metrics);
  }

  /**
   * 에러 메트릭 로깅
   */
  logErrorMetrics(error: ErrorMetrics): void {
    const metadata: LogMetadata = {
      requestId: error.requestId,
      userId: error.userId,
      workspaceId: error.workspaceId,
      action: 'error_metrics',
      errorInfo: {
        type: error.errorType,
        message: error.errorMessage,
        severity: error.severity,
      },
    };

    logger.error(`에러 발생: ${error.errorType}`, metadata);

    // 심각한 에러의 경우 즉시 알림 (추후 알림 시스템 연동 시)
    if (error.severity === 'critical') {
      this.handleCriticalError(error);
    }
  }

  /**
   * 사용자 활동 로깅
   */
  logUserActivity(
    userId: string,
    workspaceId: string,
    activity: string,
    metadata?: Record<string, any>
  ): void {
    logger.logUserAction(activity, {
      userId,
      workspaceId,
      action: 'user_activity',
      activity,
      ...metadata,
    });

    // 일일 활성 사용자 업데이트
    this.updateDailyActiveUsers(userId);
  }

  /**
   * API 성능 모니터링
   */
  logApiPerformance(
    requestId: string,
    endpoint: string,
    method: string,
    duration: number,
    statusCode: number,
    userId?: string
  ): void {
    const isSlowRequest = duration > 3000; // 3초 이상
    const isError = statusCode >= 400;

    const metadata: LogMetadata = {
      requestId,
      userId,
      action: 'api_performance',
      duration,
      statusCode,
    };

    if (isSlowRequest) {
      logger.warn(`느린 API 응답: ${method} ${endpoint}`, {
        ...metadata,
        performanceIssue: 'slow_response',
        threshold: 3000,
      });
    }

    if (isError) {
      logger.error(`API 에러 응답: ${method} ${endpoint}`, {
        ...metadata,
        performanceIssue: 'error_response',
      });
    } else {
      logger.debug(`API 성능: ${method} ${endpoint}`, metadata);
    }
  }

  /**
   * Slack 웹훅 성능 모니터링
   */
  logSlackWebhookPerformance(
    requestId: string,
    webhookUrl: string,
    duration: number,
    statusCode: number,
    success: boolean
  ): void {
    const metadata: LogMetadata = {
      requestId,
      action: 'slack_webhook_performance',
      duration,
      statusCode,
    };

    if (!success) {
      logger.error('Slack 웹훅 실패', {
        ...metadata,
        webhookUrl: this.maskUrl(webhookUrl),
        issue: 'webhook_failure',
      });
    } else if (duration > 5000) {
      logger.warn('Slack 웹훅 응답 지연', {
        ...metadata,
        webhookUrl: this.maskUrl(webhookUrl),
        issue: 'webhook_slow',
      });
    } else {
      logger.debug('Slack 웹훅 성공', {
        ...metadata,
        webhookUrl: this.maskUrl(webhookUrl),
      });
    }
  }

  /**
   * Vertex AI 성능 모니터링
   */
  logVertexAIPerformance(
    requestId: string,
    model: string,
    promptLength: number,
    responseLength: number,
    tokenUsage: TokenUsageMetrics,
    duration: number,
    success: boolean
  ): void {
    const metadata: LogMetadata = {
      requestId,
      action: 'vertexai_performance',
      duration,
      tokenUsage: {
        inputTokens: tokenUsage.inputTokens,
        outputTokens: tokenUsage.outputTokens,
        totalTokens: tokenUsage.totalTokens,
      },
    };

    if (!success) {
      logger.error('Vertex AI 호출 실패', {
        ...metadata,
        model,
        promptLength,
        issue: 'ai_failure',
      });
    } else if (duration > 10000) {
      logger.warn('Vertex AI 응답 지연', {
        ...metadata,
        model,
        promptLength,
        responseLength,
        issue: 'ai_slow',
      });
    } else {
      logger.info('Vertex AI 호출 성공', {
        ...metadata,
        model,
        promptLength,
        responseLength,
      });
    }
  }

  /**
   * 비즈니스 메트릭 조회
   */
  getDailyMetrics(date: string): BusinessMetrics | undefined {
    return this.dailyMetrics.get(date);
  }

  /**
   * 전체 메트릭 요약 조회
   */
  getMetricsSummary(): {
    totalDays: number;
    totalUsers: number;
    totalRequests: number;
    avgSuccessRate: number;
    avgResponseTime: number;
    totalTokens: number;
  } {
    const metrics = Array.from(this.dailyMetrics.values());
    
    if (metrics.length === 0) {
      return {
        totalDays: 0,
        totalUsers: 0,
        totalRequests: 0,
        avgSuccessRate: 0,
        avgResponseTime: 0,
        totalTokens: 0,
      };
    }

    const totalRequests = metrics.reduce((sum, m) => sum + m.totalRequests, 0);
    const totalSuccessful = metrics.reduce((sum, m) => sum + m.successfulRequests, 0);
    const avgResponseTime = metrics.reduce((sum, m) => sum + m.avgResponseTime, 0) / metrics.length;
    const totalTokens = metrics.reduce((sum, m) => sum + m.totalTokensUsed, 0);

    return {
      totalDays: metrics.length,
      totalUsers: Math.max(...metrics.map(m => m.dailyActiveUsers)),
      totalRequests,
      avgSuccessRate: totalRequests > 0 ? (totalSuccessful / totalRequests) * 100 : 0,
      avgResponseTime,
      totalTokens,
    };
  }

  /**
   * 일일 토큰 사용량 업데이트
   */
  private updateDailyTokenUsage(tokens: number): void {
    const today = new Date().toISOString().split('T')[0];
    const metrics = this.getOrCreateDailyMetrics(today);
    metrics.totalTokensUsed += tokens;
    this.dailyMetrics.set(today, metrics);
  }

  /**
   * 일일 요청 메트릭 업데이트
   */
  private updateDailyRequestMetrics(request: RequestMetrics): void {
    const today = new Date().toISOString().split('T')[0];
    const metrics = this.getOrCreateDailyMetrics(today);
    
    metrics.totalRequests += 1;
    if (request.success) {
      metrics.successfulRequests += 1;
    } else {
      metrics.failedRequests += 1;
    }
    
    // 평균 응답 시간 계산
    const totalDuration = metrics.avgResponseTime * (metrics.totalRequests - 1) + request.duration;
    metrics.avgResponseTime = totalDuration / metrics.totalRequests;
    
    this.dailyMetrics.set(today, metrics);
  }

  /**
   * 일일 활성 사용자 업데이트
   */
  private updateDailyActiveUsers(userId: string): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${today}_users`;
    
    if (!this.dailyActiveUsersSets) {
      this.dailyActiveUsersSets = new Map();
    }
    
    if (!this.dailyActiveUsersSets.has(key)) {
      this.dailyActiveUsersSets.set(key, new Set());
    }
    
    this.dailyActiveUsersSets.get(key)!.add(userId);
    
    const metrics = this.getOrCreateDailyMetrics(today);
    metrics.dailyActiveUsers = this.dailyActiveUsersSets.get(key)!.size;
    this.dailyMetrics.set(today, metrics);
  }
  
  private dailyActiveUsersSets: Map<string, Set<string>> = new Map();

  /**
   * 일일 메트릭 조회 또는 생성
   */
  private getOrCreateDailyMetrics(date: string): BusinessMetrics {
    if (!this.dailyMetrics.has(date)) {
      this.dailyMetrics.set(date, {
        dailyActiveUsers: 0,
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        totalTokensUsed: 0,
        date,
      });
    }
    return this.dailyMetrics.get(date)!;
  }

  /**
   * 중요한 에러 처리
   */
  private handleCriticalError(error: ErrorMetrics): void {
    logger.error('🚨 중요한 오류 발생', {
      requestId: error.requestId,
      action: 'critical_error_alert',
      errorType: error.errorType,
      errorMessage: error.errorMessage,
      endpoint: error.endpoint,
      severity: error.severity,
    });

    // 추후 알림 시스템 연동 시 이메일/슬랙 알림 발송
    // await this.sendAlert(error);
  }

  /**
   * URL 마스킹 (보안을 위해 웹훅 URL 일부 숨김)
   */
  private maskUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      const pathParts = urlObj.pathname.split('/');
      if (pathParts.length > 3) {
        pathParts[pathParts.length - 1] = '***';
        urlObj.pathname = pathParts.join('/');
      }
      return urlObj.toString();
    } catch {
      return '***';
    }
  }

  /**
   * 서비스 종료 시 정리
   */
  async disconnect(): Promise<void> {
    // 최종 메트릭 로깅
    const summary = this.getMetricsSummary();
    logger.info('모니터링 서비스 종료', {
      action: 'monitoring_shutdown',
      finalMetrics: summary,
    });
  }
}

// 싱글톤 인스턴스 export
export const monitoringService = new MonitoringService();