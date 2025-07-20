/**
 * 모니터링 미들웨어
 * 모든 요청에 대한 메트릭 수집 및 성능 모니터링
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger.js';
import { metricsCollector, startTimer, recordPerformance, recordError } from '../utils/metrics-collector.js';
import { healthMonitor } from '../utils/health-monitor.js';

// =================================
// 타입 정의
// =================================
interface MonitoringRequest extends Request {
  requestId?: string;
  startTime?: number;
  timer?: () => number;
}

interface RequestMetrics {
  method: string;
  path: string;
  statusCode: number;
  duration: number;
  userAgent: string;
  ip: string;
}

// =================================
// 요청 메트릭 수집 미들웨어
// =================================
export const requestMetricsMiddleware = (req: MonitoringRequest, res: Response, next: NextFunction): void => {
  // 요청 시작 시간 기록
  req.startTime = Date.now();
  req.timer = startTimer();
  req.requestId = `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  logger.debug('요청 시작', {
    requestId: req.requestId,
    method: req.method,
    path: req.path,
    userAgent: req.get('User-Agent'),
    ip: req.ip,
  });

  // 응답 완료 시 메트릭 기록
  res.on('finish', async () => {
    try {
      const duration = req.timer ? req.timer() : Date.now() - (req.startTime || Date.now());
      
      const metrics: RequestMetrics = {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userAgent: req.get('User-Agent') || 'unknown',
        ip: req.ip || 'unknown',
      };

      // 성능 메트릭 기록
      await recordPerformance('request_duration', duration, {
        method: req.method,
        status_code: res.statusCode.toString(),
        endpoint: req.path,
      });

      // HTTP 상태 코드별 메트릭
      await recordPerformance('http_requests_total', 1, {
        method: req.method,
        status_code: res.statusCode.toString(),
        endpoint: req.path,
      });

      logger.debug('요청 완료', {
        requestId: req.requestId,
        duration,
        statusCode: res.statusCode,
      });

      // 에러 상태 코드인 경우 에러 메트릭 기록
      if (res.statusCode >= 400) {
        await recordError('http_error', res.statusCode.toString(), {
          method: req.method,
          path: req.path,
          user_agent: req.get('User-Agent') || 'unknown',
        });
      }

    } catch (error) {
      logger.error('요청 메트릭 기록 실패', {
        requestId: req.requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  next();
};

// =================================
// AI 요청 모니터링 미들웨어
// =================================
export const aiRequestMonitoringMiddleware = (req: MonitoringRequest, res: Response, next: NextFunction): void => {
  // AI 관련 엔드포인트에서만 동작
  if (!req.path.includes('/slack/commands') && !req.path.includes('/ai/')) {
    return next();
  }

  const originalJson = res.json;
  res.json = function(body: any) {
    // AI 응답 완료 시 메트릭 기록
    setImmediate(async () => {
      try {
        const duration = req.timer ? req.timer() : Date.now() - (req.startTime || Date.now());
        const isSuccess = res.statusCode < 400;
        
        // AI 요청 상태 확인
        const status = isSuccess ? 'success' : 'error';
        const commandType = req.body?.command || 'unknown';
        const teamId = req.body?.team_id || 'unknown';

        // 토큰 사용량 추정 (실제 구현에서는 AI 응답에서 가져올 수 있음)
        const inputText = req.body?.text || '';
        const outputText = typeof body === 'object' && body.text ? body.text : '';
        
        const estimatedInputTokens = Math.ceil(inputText.length / 4); // 대략적인 토큰 수
        const estimatedOutputTokens = Math.ceil(outputText.length / 4);

        await metricsCollector.recordAIRequest({
          requestId: req.requestId || 'unknown',
          teamId,
          status,
          duration,
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
          commandType,
        });

        logger.info('AI 요청 메트릭 기록', {
          requestId: req.requestId,
          status,
          duration,
          inputTokens: estimatedInputTokens,
          outputTokens: estimatedOutputTokens,
        });

      } catch (error) {
        logger.error('AI 요청 메트릭 기록 실패', {
          requestId: req.requestId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    return originalJson.call(this, body);
  };

  next();
};

// =================================
// 에러 모니터링 미들웨어
// =================================
export const errorMonitoringMiddleware = (error: Error, req: MonitoringRequest, res: Response, next: NextFunction): void => {
  const errorType = error.constructor.name;
  const errorMessage = error.message;
  const stack = error.stack;

  logger.error('미들웨어에서 에러 감지', {
    requestId: req.requestId,
    errorType,
    errorMessage,
    method: req.method,
    path: req.path,
    stack,
  });

  // 에러 메트릭 기록
  recordError(errorType, 'middleware_error', {
    method: req.method,
    path: req.path,
    message: errorMessage,
  }).catch((metricsError) => {
    logger.error('에러 메트릭 기록 실패', {
      requestId: req.requestId,
      originalError: errorMessage,
      metricsError: metricsError instanceof Error ? metricsError.message : String(metricsError),
    });
  });

  next(error);
};

// =================================
// 헬스 체크 라우트 설정
// =================================
export const setupHealthRoutes = (app: any): void => {
  // 상세 헬스 체크
  app.get('/health', async (req: Request, res: Response) => {
    await healthMonitor.healthCheckHandler(req, res);
  });

  // 빠른 헬스 체크 (로드밸런서용)
  app.get('/health/quick', async (req: Request, res: Response) => {
    await healthMonitor.quickHealthCheck(req, res);
  });

  // 준비 상태 체크 (Kubernetes readiness probe용)
  app.get('/ready', async (req: Request, res: Response) => {
    const lastHealth = healthMonitor.getLastHealthCheck();
    
    if (lastHealth && lastHealth.status !== 'unhealthy') {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
      });
    } else {
      res.status(503).json({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        reason: '시스템 헬스체크 실패',
      });
    }
  });

  // 활성 상태 체크 (Kubernetes liveness probe용)
  app.get('/live', (req: Request, res: Response) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // 메트릭 엔드포인트 (Prometheus 스타일)
  app.get('/metrics', async (req: Request, res: Response) => {
    try {
      const memUsage = process.memoryUsage();
      const lastHealth = healthMonitor.getLastHealthCheck();
      
      const metrics = [
        `# HELP writerly_uptime_seconds 서비스 가동 시간`,
        `# TYPE writerly_uptime_seconds gauge`,
        `writerly_uptime_seconds ${process.uptime()}`,
        '',
        `# HELP writerly_memory_usage_bytes 메모리 사용량`,
        `# TYPE writerly_memory_usage_bytes gauge`,
        `writerly_memory_usage_bytes{type="rss"} ${memUsage.rss}`,
        `writerly_memory_usage_bytes{type="heap_used"} ${memUsage.heapUsed}`,
        `writerly_memory_usage_bytes{type="heap_total"} ${memUsage.heapTotal}`,
        '',
        `# HELP writerly_health_status 컴포넌트 헬스 상태`,
        `# TYPE writerly_health_status gauge`,
      ];

      if (lastHealth) {
        for (const [component, status] of Object.entries(lastHealth.components)) {
          const value = status.status === 'healthy' ? 1 : status.status === 'degraded' ? 0.5 : 0;
          metrics.push(`writerly_health_status{component="${component}"} ${value}`);
        }
      }

      res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
      res.send(metrics.join('\n'));

    } catch (error) {
      logger.error('메트릭 엔드포인트 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: 'metrics endpoint error' });
    }
  });
};

// =================================
// 모니터링 상태 정보 미들웨어
// =================================
export const monitoringStatusMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  // 모니터링 관련 헤더 추가
  res.set({
    'X-Monitoring-Enabled': metricsCollector.isEnabled().toString(),
    'X-Service-Version': process.env.npm_package_version || '1.0.0',
    'X-Node-Version': process.version,
  });

  next();
};

// =================================
// 비즈니스 메트릭 수집 헬퍼
// =================================
export class BusinessMetricsCollector {
  private static activeTeams = new Set<string>();
  private static requestCounts = new Map<string, number>();

  static recordTeamActivity(teamId: string): void {
    this.activeTeams.add(teamId);
    
    const currentCount = this.requestCounts.get(teamId) || 0;
    this.requestCounts.set(teamId, currentCount + 1);
  }

  static async publishBusinessMetrics(): Promise<void> {
    try {
      const totalRequests = Array.from(this.requestCounts.values()).reduce((sum, count) => sum + count, 0);
      const successRate = 0.95; // 실제로는 에러율을 바탕으로 계산
      const averageResponseTime = 2000; // 실제로는 응답 시간 통계에서 계산

      await metricsCollector.recordBusinessMetrics({
        activeTeams: this.activeTeams.size,
        totalRequests,
        successRate,
        averageResponseTime,
      });

      logger.debug('비즈니스 메트릭 발행 완료', {
        activeTeams: this.activeTeams.size,
        totalRequests,
      });

      // 주기적으로 데이터 초기화 (매시간)
      if (new Date().getMinutes() === 0) {
        this.activeTeams.clear();
        this.requestCounts.clear();
      }

    } catch (error) {
      logger.error('비즈니스 메트릭 발행 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  static startPeriodicCollection(): void {
    // 5분마다 비즈니스 메트릭 발행
    setInterval(() => {
      this.publishBusinessMetrics();
    }, 5 * 60 * 1000);
  }
}

// =================================
// 모니터링 미들웨어 통합 설정
// =================================
export const setupMonitoring = (app: any): void => {
  // 기본 모니터링 미들웨어 적용
  app.use(monitoringStatusMiddleware);
  app.use(requestMetricsMiddleware);
  app.use(aiRequestMonitoringMiddleware);

  // 헬스 체크 라우트 설정
  setupHealthRoutes(app);

  // 에러 모니터링 미들웨어 (마지막에 적용)
  app.use(errorMonitoringMiddleware);

  // 비즈니스 메트릭 수집 시작
  BusinessMetricsCollector.startPeriodicCollection();

  logger.info('모니터링 시스템 초기화 완료', {
    metricsEnabled: metricsCollector.isEnabled(),
    healthMonitorEnabled: true,
    businessMetricsEnabled: true,
  });
};