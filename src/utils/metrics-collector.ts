/**
 * Google Cloud Monitoring 커스텀 메트릭 수집기
 * 비즈니스 로직 관련 메트릭을 Google Cloud Monitoring으로 전송
 */

import { Monitoring } from '@google-cloud/monitoring';
import { logger } from './logger.js';

// =================================
// 타입 정의
// =================================
interface MetricValue {
  value: number;
  timestamp?: Date;
  labels?: Record<string, string>;
}

interface AIRequestMetric {
  requestId: string;
  teamId: string;
  status: 'success' | 'error' | 'timeout';
  duration: number;
  inputTokens: number;
  outputTokens: number;
  commandType: string;
}

interface BusinessMetrics {
  activeTeams: number;
  totalRequests: number;
  successRate: number;
  averageResponseTime: number;
}

// =================================
// 메트릭 수집기 클래스
// =================================
export class MetricsCollector {
  private monitoring: Monitoring;
  private projectId: string;
  private enabled: boolean;
  private metricPrefix = 'custom.googleapis.com/writerly';

  constructor(projectId?: string) {
    this.projectId = projectId || process.env.VERTEX_AI_PROJECT_ID || 'unknown-project';
    this.enabled = process.env.ENABLE_MONITORING === 'true';
    
    if (this.enabled) {
      this.monitoring = new Monitoring();
      logger.info('메트릭 수집기 초기화 완료', { projectId: this.projectId });
    } else {
      logger.info('메트릭 수집 비활성화');
    }
  }

  // =================================
  // AI 요청 메트릭 기록
  // =================================
  async recordAIRequest(metric: AIRequestMetric): Promise<void> {
    if (!this.enabled) return;

    try {
      const timestamp = new Date();
      
      // AI 요청 총 수 메트릭
      await this.writeMetric('ai_requests_total', {
        value: 1,
        timestamp,
        labels: {
          status: metric.status,
          command_type: metric.commandType,
          team_id: metric.teamId,
        }
      });

      // AI 응답 시간 메트릭
      await this.writeMetric('ai_response_duration', {
        value: metric.duration,
        timestamp,
        labels: {
          status: metric.status,
          command_type: metric.commandType,
        }
      });

      // 토큰 사용량 메트릭 (입력)
      await this.writeMetric('tokens_used', {
        value: metric.inputTokens,
        timestamp,
        labels: {
          type: 'input',
          command_type: metric.commandType,
          team_id: metric.teamId,
        }
      });

      // 토큰 사용량 메트릭 (출력)
      await this.writeMetric('tokens_used', {
        value: metric.outputTokens,
        timestamp,
        labels: {
          type: 'output',
          command_type: metric.commandType,
          team_id: metric.teamId,
        }
      });

      logger.debug('AI 요청 메트릭 기록 완료', {
        requestId: metric.requestId,
        status: metric.status,
        duration: metric.duration,
      });

    } catch (error) {
      logger.error('AI 요청 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        requestId: metric.requestId,
      });
    }
  }

  // =================================
  // 비즈니스 메트릭 기록
  // =================================
  async recordBusinessMetrics(metrics: BusinessMetrics): Promise<void> {
    if (!this.enabled) return;

    try {
      const timestamp = new Date();

      // 활성 팀 수
      await this.writeMetric('active_teams', {
        value: metrics.activeTeams,
        timestamp,
      });

      // 총 요청 수
      await this.writeMetric('total_requests', {
        value: metrics.totalRequests,
        timestamp,
      });

      // 성공률
      await this.writeMetric('success_rate', {
        value: metrics.successRate,
        timestamp,
      });

      // 평균 응답 시간
      await this.writeMetric('average_response_time', {
        value: metrics.averageResponseTime,
        timestamp,
      });

      logger.debug('비즈니스 메트릭 기록 완료', metrics);

    } catch (error) {
      logger.error('비즈니스 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        metrics,
      });
    }
  }

  // =================================
  // 에러 메트릭 기록
  // =================================
  async recordError(errorType: string, errorCode?: string, details?: Record<string, string>): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.writeMetric('error_count', {
        value: 1,
        timestamp: new Date(),
        labels: {
          error_type: errorType,
          error_code: errorCode || 'unknown',
          ...details,
        }
      });

      logger.debug('에러 메트릭 기록 완료', {
        errorType,
        errorCode,
        details,
      });

    } catch (error) {
      logger.error('에러 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        errorType,
        errorCode,
      });
    }
  }

  // =================================
  // 성능 메트릭 기록
  // =================================
  async recordPerformanceMetric(metricName: string, value: number, labels?: Record<string, string>): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.writeMetric(`performance_${metricName}`, {
        value,
        timestamp: new Date(),
        labels,
      });

      logger.debug('성능 메트릭 기록 완료', {
        metricName,
        value,
        labels,
      });

    } catch (error) {
      logger.error('성능 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        metricName,
        value,
      });
    }
  }

  // =================================
  // 사용자 활동 메트릭 기록
  // =================================
  async recordUserActivity(teamId: string, userId: string, activityType: string): Promise<void> {
    if (!this.enabled) return;

    try {
      await this.writeMetric('user_activity', {
        value: 1,
        timestamp: new Date(),
        labels: {
          team_id: teamId,
          user_id: userId,
          activity_type: activityType,
        }
      });

      logger.debug('사용자 활동 메트릭 기록 완료', {
        teamId,
        userId,
        activityType,
      });

    } catch (error) {
      logger.error('사용자 활동 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        teamId,
        userId,
        activityType,
      });
    }
  }

  // =================================
  // 시스템 헬스 메트릭 기록
  // =================================
  async recordHealthMetric(component: string, status: 'healthy' | 'unhealthy' | 'degraded'): Promise<void> {
    if (!this.enabled) return;

    try {
      const statusValue = status === 'healthy' ? 1 : status === 'degraded' ? 0.5 : 0;

      await this.writeMetric('component_health', {
        value: statusValue,
        timestamp: new Date(),
        labels: {
          component,
          status,
        }
      });

      logger.debug('헬스 메트릭 기록 완료', {
        component,
        status,
        statusValue,
      });

    } catch (error) {
      logger.error('헬스 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
        component,
        status,
      });
    }
  }

  // =================================
  // 메트릭 쓰기 (내부 메소드)
  // =================================
  private async writeMetric(metricType: string, metric: MetricValue): Promise<void> {
    if (!this.monitoring) {
      throw new Error('Monitoring client가 초기화되지 않았습니다');
    }

    const projectPath = this.monitoring.projectPath(this.projectId);
    const timestamp = metric.timestamp || new Date();

    const request = {
      name: projectPath,
      timeSeries: [{
        metric: {
          type: `${this.metricPrefix}/${metricType}`,
          labels: metric.labels || {},
        },
        resource: {
          type: 'global',
          labels: {
            project_id: this.projectId,
          },
        },
        points: [{
          interval: {
            endTime: {
              seconds: Math.floor(timestamp.getTime() / 1000),
            },
          },
          value: {
            doubleValue: metric.value,
          },
        }],
      }],
    };

    await this.monitoring.createTimeSeries(request);
  }

  // =================================
  // 헬퍼 메소드들
  // =================================
  
  /**
   * 요청 시간 측정을 위한 타이머 시작
   */
  startTimer(): () => number {
    const startTime = Date.now();
    return () => Date.now() - startTime;
  }

  /**
   * 메트릭 수집 상태 확인
   */
  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * 메트릭 수집기 상태 정보
   */
  getStatus(): Record<string, any> {
    return {
      enabled: this.enabled,
      projectId: this.projectId,
      metricPrefix: this.metricPrefix,
      monitoringInitialized: !!this.monitoring,
    };
  }
}

// =================================
// 싱글톤 인스턴스 및 헬퍼 함수들
// =================================
export const metricsCollector = new MetricsCollector();

/**
 * AI 요청 메트릭 기록 (편의 함수)
 */
export const recordAIRequest = (metric: AIRequestMetric) => 
  metricsCollector.recordAIRequest(metric);

/**
 * 에러 메트릭 기록 (편의 함수)
 */
export const recordError = (errorType: string, errorCode?: string, details?: Record<string, string>) => 
  metricsCollector.recordError(errorType, errorCode, details);

/**
 * 성능 메트릭 기록 (편의 함수)
 */
export const recordPerformance = (metricName: string, value: number, labels?: Record<string, string>) => 
  metricsCollector.recordPerformanceMetric(metricName, value, labels);

/**
 * 사용자 활동 기록 (편의 함수)
 */
export const recordUserActivity = (teamId: string, userId: string, activityType: string) => 
  metricsCollector.recordUserActivity(teamId, userId, activityType);

/**
 * 헬스 상태 기록 (편의 함수)
 */
export const recordHealth = (component: string, status: 'healthy' | 'unhealthy' | 'degraded') => 
  metricsCollector.recordHealthMetric(component, status);

/**
 * 타이머 시작 (편의 함수)
 */
export const startTimer = () => metricsCollector.startTimer();