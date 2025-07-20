/**
 * 시스템 헬스 체크 및 모니터링
 * 모든 시스템 컴포넌트의 상태를 종합적으로 모니터링
 */

import { Request, Response } from 'express';
import Redis from 'ioredis';
import { logger } from './logger.js';
import { recordHealth } from './metrics-collector.js';

// =================================
// 타입 정의
// =================================
interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  timestamp: string;
  uptime: number;
  version: string;
  components: ComponentHealth;
  summary: HealthSummary;
}

interface ComponentHealth {
  redis: ComponentStatus;
  vertexAI: ComponentStatus;
  cloudTasks: ComponentStatus;
  database: ComponentStatus;
  memory: ComponentStatus;
  disk: ComponentStatus;
}

interface ComponentStatus {
  status: 'healthy' | 'unhealthy' | 'degraded';
  message: string;
  responseTime?: number;
  lastCheck: string;
  details?: Record<string, any>;
}

interface HealthSummary {
  healthy: number;
  unhealthy: number;
  degraded: number;
  total: number;
}

// =================================
// 헬스 모니터 클래스
// =================================
export class HealthMonitor {
  private redis?: Redis;
  private healthCheckInterval?: NodeJS.Timeout;
  private lastHealthCheck: HealthStatus | null = null;
  private readonly version: string;

  constructor() {
    this.version = process.env.npm_package_version || '1.0.0';
    this.initializeRedis();
    this.startPeriodicHealthChecks();
  }

  // =================================
  // Redis 초기화
  // =================================
  private initializeRedis(): void {
    try {
      const redisUrl = process.env.REDIS_URL;
      if (redisUrl) {
        this.redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 1,
          lazyConnect: true,
        });
        
        this.redis.on('error', (error) => {
          logger.warn('Redis 연결 오류 (헬스체크)', { error: error.message });
        });
      }
    } catch (error) {
      logger.error('Redis 초기화 실패 (헬스체크)', { 
        error: error instanceof Error ? error.message : String(error) 
      });
    }
  }

  // =================================
  // 주기적 헬스 체크 시작
  // =================================
  private startPeriodicHealthChecks(): void {
    // 5분마다 헬스 체크 실행
    this.healthCheckInterval = setInterval(async () => {
      try {
        const health = await this.checkSystemHealth();
        this.lastHealthCheck = health;
        
        // 메트릭으로 전송
        await this.recordHealthMetrics(health);
        
        logger.debug('주기적 헬스체크 완료', {
          status: health.status,
          healthyComponents: health.summary.healthy,
          totalComponents: health.summary.total,
        });
      } catch (error) {
        logger.error('주기적 헬스체크 실패', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }, 5 * 60 * 1000); // 5분
  }

  // =================================
  // 전체 시스템 헬스 체크
  // =================================
  async checkSystemHealth(): Promise<HealthStatus> {
    const startTime = Date.now();
    const timestamp = new Date().toISOString();

    logger.info('시스템 헬스체크 시작');

    // 병렬로 모든 컴포넌트 체크
    const [redis, vertexAI, cloudTasks, database, memory, disk] = await Promise.allSettled([
      this.checkRedisHealth(),
      this.checkVertexAIHealth(),
      this.checkCloudTasksHealth(),
      this.checkDatabaseHealth(),
      this.checkMemoryHealth(),
      this.checkDiskHealth(),
    ]);

    const components: ComponentHealth = {
      redis: this.getComponentResult(redis, 'Redis'),
      vertexAI: this.getComponentResult(vertexAI, 'Vertex AI'),
      cloudTasks: this.getComponentResult(cloudTasks, 'Cloud Tasks'),
      database: this.getComponentResult(database, 'Database'),
      memory: this.getComponentResult(memory, 'Memory'),
      disk: this.getComponentResult(disk, 'Disk'),
    };

    const summary = this.calculateHealthSummary(components);
    const overallStatus = this.determineOverallStatus(summary);

    const totalTime = Date.now() - startTime;

    const health: HealthStatus = {
      status: overallStatus,
      timestamp,
      uptime: process.uptime(),
      version: this.version,
      components,
      summary,
    };

    logger.info('시스템 헬스체크 완료', {
      status: overallStatus,
      duration: totalTime,
      summary,
    });

    return health;
  }

  // =================================
  // Redis 헬스 체크
  // =================================
  private async checkRedisHealth(): Promise<ComponentStatus> {
    const startTime = Date.now();
    
    try {
      if (!this.redis) {
        return {
          status: 'unhealthy',
          message: 'Redis 클라이언트가 초기화되지 않음',
          lastCheck: new Date().toISOString(),
        };
      }

      // Ping 테스트
      const pingResult = await this.redis.ping();
      const responseTime = Date.now() - startTime;

      if (pingResult !== 'PONG') {
        return {
          status: 'unhealthy',
          message: 'Redis ping 실패',
          responseTime,
          lastCheck: new Date().toISOString(),
        };
      }

      // 메모리 정보 가져오기
      const info = await this.redis.info('memory');
      const memoryMatch = info.match(/used_memory:(\d+)/);
      const usedMemory = memoryMatch ? parseInt(memoryMatch[1]) : 0;

      return {
        status: responseTime < 100 ? 'healthy' : 'degraded',
        message: responseTime < 100 ? 'Redis 정상 동작' : 'Redis 응답 지연',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          usedMemory,
          connected: true,
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Redis 연결 실패: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // =================================
  // Vertex AI 헬스 체크
  // =================================
  private async checkVertexAIHealth(): Promise<ComponentStatus> {
    const startTime = Date.now();
    
    try {
      // 환경 변수 확인
      const projectId = process.env.VERTEX_AI_PROJECT_ID;
      const location = process.env.VERTEX_AI_LOCATION;
      
      if (!projectId || !location) {
        return {
          status: 'unhealthy',
          message: 'Vertex AI 환경 변수 누락',
          lastCheck: new Date().toISOString(),
          details: { projectId: !!projectId, location: !!location },
        };
      }

      // 간단한 API 가용성 체크 (실제 요청은 하지 않음)
      // 실제 운영에서는 간단한 테스트 요청을 보낼 수 있음
      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        message: 'Vertex AI 설정 정상',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          projectId: projectId.substring(0, 8) + '***',
          location,
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Vertex AI 체크 실패: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // =================================
  // Cloud Tasks 헬스 체크
  // =================================
  private async checkCloudTasksHealth(): Promise<ComponentStatus> {
    const startTime = Date.now();
    
    try {
      const projectId = process.env.CLOUD_TASKS_PROJECT_ID;
      const location = process.env.CLOUD_TASKS_LOCATION;
      const queueName = process.env.CLOUD_TASKS_QUEUE;
      
      if (!projectId || !location || !queueName) {
        return {
          status: 'unhealthy',
          message: 'Cloud Tasks 환경 변수 누락',
          lastCheck: new Date().toISOString(),
          details: { 
            projectId: !!projectId, 
            location: !!location, 
            queueName: !!queueName 
          },
        };
      }

      const responseTime = Date.now() - startTime;

      return {
        status: 'healthy',
        message: 'Cloud Tasks 설정 정상',
        responseTime,
        lastCheck: new Date().toISOString(),
        details: {
          queueName,
          location,
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `Cloud Tasks 체크 실패: ${error instanceof Error ? error.message : String(error)}`,
        responseTime: Date.now() - startTime,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // =================================
  // 데이터베이스 헬스 체크 (현재는 Redis만)
  // =================================
  private async checkDatabaseHealth(): Promise<ComponentStatus> {
    // 현재는 Redis가 주 데이터베이스 역할을 하므로 Redis 상태 참조
    return this.checkRedisHealth();
  }

  // =================================
  // 메모리 헬스 체크
  // =================================
  private async checkMemoryHealth(): Promise<ComponentStatus> {
    try {
      const memUsage = process.memoryUsage();
      const totalMB = Math.round(memUsage.rss / 1024 / 1024);
      const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
      const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
      
      const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      let status: 'healthy' | 'unhealthy' | 'degraded' = 'healthy';
      let message = '메모리 사용량 정상';
      
      if (heapUsagePercent > 90) {
        status = 'unhealthy';
        message = '메모리 사용량 위험 수준 (>90%)';
      } else if (heapUsagePercent > 80) {
        status = 'degraded';
        message = '메모리 사용량 주의 수준 (>80%)';
      }

      return {
        status,
        message,
        lastCheck: new Date().toISOString(),
        details: {
          rss: `${totalMB}MB`,
          heapUsed: `${heapUsedMB}MB`,
          heapTotal: `${heapTotalMB}MB`,
          heapUsagePercent: `${heapUsagePercent.toFixed(1)}%`,
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `메모리 체크 실패: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // =================================
  // 디스크 헬스 체크
  // =================================
  private async checkDiskHealth(): Promise<ComponentStatus> {
    try {
      const fs = await import('fs');
      const stats = fs.statSync(process.cwd());
      
      return {
        status: 'healthy',
        message: '디스크 접근 정상',
        lastCheck: new Date().toISOString(),
        details: {
          accessTime: stats.atime.toISOString(),
          modifyTime: stats.mtime.toISOString(),
        },
      };

    } catch (error) {
      return {
        status: 'unhealthy',
        message: `디스크 체크 실패: ${error instanceof Error ? error.message : String(error)}`,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  // =================================
  // 유틸리티 메소드들
  // =================================
  
  private getComponentResult(result: PromiseSettledResult<ComponentStatus>, componentName: string): ComponentStatus {
    if (result.status === 'fulfilled') {
      return result.value;
    } else {
      return {
        status: 'unhealthy',
        message: `${componentName} 체크 중 오류 발생: ${result.reason}`,
        lastCheck: new Date().toISOString(),
      };
    }
  }

  private calculateHealthSummary(components: ComponentHealth): HealthSummary {
    const statuses = Object.values(components).map(c => c.status);
    
    return {
      healthy: statuses.filter(s => s === 'healthy').length,
      unhealthy: statuses.filter(s => s === 'unhealthy').length,
      degraded: statuses.filter(s => s === 'degraded').length,
      total: statuses.length,
    };
  }

  private determineOverallStatus(summary: HealthSummary): 'healthy' | 'unhealthy' | 'degraded' {
    if (summary.unhealthy > 0) {
      return 'unhealthy';
    } else if (summary.degraded > 0) {
      return 'degraded';
    } else {
      return 'healthy';
    }
  }

  private async recordHealthMetrics(health: HealthStatus): Promise<void> {
    try {
      // 전체 시스템 상태
      await recordHealth('system_overall', health.status);
      
      // 각 컴포넌트 상태
      for (const [componentName, componentStatus] of Object.entries(health.components)) {
        await recordHealth(componentName, componentStatus.status);
      }
    } catch (error) {
      logger.warn('헬스 메트릭 기록 실패', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // =================================
  // 퍼블릭 메소드들
  // =================================
  
  /**
   * Express 미들웨어용 헬스체크 핸들러
   */
  async healthCheckHandler(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.checkSystemHealth();
      const httpStatus = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;
      
      res.status(httpStatus).json(health);
    } catch (error) {
      logger.error('헬스체크 핸들러 오류', {
        error: error instanceof Error ? error.message : String(error),
      });
      
      res.status(503).json({
        status: 'unhealthy',
        message: '헬스체크 실행 중 오류 발생',
        timestamp: new Date().toISOString(),
      });
    }
  }

  /**
   * 간단한 헬스체크 (빠른 응답)
   */
  async quickHealthCheck(req: Request, res: Response): Promise<void> {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: this.version,
    };
    
    res.status(200).json(health);
  }

  /**
   * 마지막 헬스체크 결과 반환
   */
  getLastHealthCheck(): HealthStatus | null {
    return this.lastHealthCheck;
  }

  /**
   * 정리 작업
   */
  cleanup(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.redis) {
      this.redis.disconnect();
    }
  }
}

// =================================
// 싱글톤 인스턴스
// =================================
export const healthMonitor = new HealthMonitor();

// 프로세스 종료 시 정리
process.on('SIGTERM', () => {
  healthMonitor.cleanup();
});

process.on('SIGINT', () => {
  healthMonitor.cleanup();
});