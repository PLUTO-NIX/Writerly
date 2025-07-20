import { Request, Response } from 'express';
import { SessionService } from '../services/session.service';
import { logger } from '../utils/logger';

export interface HealthStatus {
  status: 'healthy' | 'unhealthy' | 'warning';
  timestamp: string;
  uptime: number;
  version: string;
  environment: string;
  responseTime?: number;
  services: {
    redis: {
      status: 'healthy' | 'unhealthy' | 'warning';
      latency?: number;
      error?: string;
      lastPing?: string;
    };
    memory: {
      status: 'healthy' | 'unhealthy' | 'warning';
      usage: {
        rss: string;
        heapTotal: string;
        heapUsed: string;
        external: string;
        heapUtilization: number;
      };
    };
  };
  checks: {
    database: 'pass' | 'fail' | 'warning';
    memory: 'pass' | 'fail' | 'warning';
    disk: 'pass' | 'fail' | 'warning';
  };
  detailed?: boolean;
  system?: {
    platform: string;
    nodeVersion: string;
    pid: number;
    loadAverage: number[];
  };
  requestInfo?: {
    userAgent?: string;
    clientIp?: string;
    timestamp: string;
  };
  error?: string;
}

export class HealthController {
  private sessionService: SessionService;
  private startTime: number;

  constructor() {
    this.sessionService = new SessionService({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_AUTH_TOKEN,
    });
    this.startTime = Date.now();
  }

  /**
   * 헬스체크 엔드포인트
   */
  async checkHealth(req: Request, res: Response): Promise<void> {
    const requestStartTime = Date.now();
    
    try {
      const detailed = req.query.detailed === 'true';
      const healthStatus = await this.performHealthChecks(detailed);
      
      // Add request timing
      healthStatus.responseTime = Date.now() - requestStartTime;
      
      // Add request metadata if headers present
      if (req.headers['user-agent'] || req.headers['x-forwarded-for']) {
        healthStatus.requestInfo = {
          userAgent: req.headers['user-agent'] as string,
          clientIp: (req.headers['x-forwarded-for'] as string) || req.ip,
          timestamp: new Date().toISOString(),
        };
      }

      const statusCode = healthStatus.status === 'healthy' ? 200 : 503;
      res.status(statusCode).json(healthStatus);

    } catch (error) {
      logger.error('Health check error', {
        error: error instanceof Error ? error.message : String(error),
        action: 'health_check_error',
        requestId: 'health-check',
      });

      const errorResponse: HealthStatus = {
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        uptime: this.getUptime(),
        version: this.getVersion(),
        environment: process.env.NODE_ENV || 'development',
        error: `Health check failed: ${error instanceof Error ? error.message : String(error)}`,
        services: {
          redis: { status: 'unhealthy' },
          memory: { status: 'unhealthy', usage: { rss: '', heapTotal: '', heapUsed: '', external: '', heapUtilization: 0 } },
        },
        checks: {
          database: 'fail',
          memory: 'fail',
          disk: 'fail',
        },
      };

      res.status(503).json(errorResponse);
    }
  }

  /**
   * 모든 헬스체크 수행
   */
  private async performHealthChecks(detailed: boolean = false): Promise<HealthStatus> {
    const timestamp = new Date().toISOString();
    
    // Redis 헬스체크
    const redisHealth = await this.checkRedisHealth();
    
    // 메모리 헬스체크
    const memoryHealth = this.checkMemoryHealth();
    
    // 전체 상태 결정
    const overallStatus = this.determineOverallStatus(redisHealth, memoryHealth);
    
    const healthStatus: HealthStatus = {
      status: overallStatus,
      timestamp,
      uptime: this.getUptime(),
      version: this.getVersion(),
      environment: process.env.NODE_ENV || 'development',
      services: {
        redis: redisHealth,
        memory: memoryHealth,
      },
      checks: {
        database: redisHealth.status === 'healthy' ? 'pass' : redisHealth.status === 'warning' ? 'warning' : 'fail',
        memory: memoryHealth.status === 'healthy' ? 'pass' : memoryHealth.status === 'warning' ? 'warning' : 'fail',
        disk: 'pass', // 기본적으로 pass (실제 디스크 체크는 선택사항)
      },
    };

    // 상세 정보 추가
    if (detailed) {
      healthStatus.detailed = true;
      healthStatus.system = {
        platform: process.platform,
        nodeVersion: process.version,
        pid: process.pid,
        loadAverage: require('os').loadavg(),
      };
    }

    return healthStatus;
  }

  /**
   * Redis 연결 상태 확인
   */
  private async checkRedisHealth(): Promise<{
    status: 'healthy' | 'unhealthy' | 'warning';
    latency?: number;
    error?: string;
    lastPing?: string;
  }> {
    try {
      const pingStart = Date.now();
      
      // Redis ping with timeout
      const pingPromise = this.sessionService.ping();
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Redis ping timeout')), 3000);
      });
      
      await Promise.race([pingPromise, timeoutPromise]);
      
      const latency = Date.now() - pingStart;
      const connectionStatus = this.sessionService.getConnectionStatus();
      
      if (!connectionStatus.connected) {
        return {
          status: 'unhealthy',
          error: connectionStatus.error || 'Not connected',
          lastPing: connectionStatus.lastPing?.toISOString(),
        };
      }
      
      return {
        status: 'healthy',
        latency,
        lastPing: connectionStatus.lastPing?.toISOString() || new Date().toISOString(),
      };
      
    } catch (error) {
      const connectionStatus = this.sessionService.getConnectionStatus();
      
      return {
        status: 'unhealthy',
        error: error instanceof Error ? error.message : String(error),
        lastPing: connectionStatus.lastPing?.toISOString(),
      };
    }
  }

  /**
   * 메모리 사용량 확인
   */
  private checkMemoryHealth(): {
    status: 'healthy' | 'unhealthy' | 'warning';
    usage: {
      rss: string;
      heapTotal: string;
      heapUsed: string;
      external: string;
      heapUtilization: number;
    };
  } {
    const memUsage = process.memoryUsage();
    const heapUtilization = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    let status: 'healthy' | 'unhealthy' | 'warning' = 'healthy';
    
    // 메모리 사용량 임계값 체크
    if (heapUtilization > 95) {
      status = 'unhealthy';
    } else if (heapUtilization > 85) {
      status = 'warning';
    }
    
    return {
      status,
      usage: {
        rss: this.formatBytes(memUsage.rss),
        heapTotal: this.formatBytes(memUsage.heapTotal),
        heapUsed: this.formatBytes(memUsage.heapUsed),
        external: this.formatBytes(memUsage.external),
        heapUtilization: Math.round(heapUtilization * 100) / 100,
      },
    };
  }

  /**
   * 전체 상태 결정
   */
  private determineOverallStatus(
    redisHealth: { status: string },
    memoryHealth: { status: string }
  ): 'healthy' | 'unhealthy' | 'warning' {
    const statuses = [redisHealth.status, memoryHealth.status];
    
    if (statuses.includes('unhealthy')) {
      return 'unhealthy';
    }
    
    if (statuses.includes('warning')) {
      return 'warning';
    }
    
    return 'healthy';
  }

  /**
   * 바이트를 읽기 쉬운 형태로 변환
   */
  private formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    
    if (bytes === 0) return '0.00 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const size = bytes / Math.pow(1024, i);
    
    return `${size.toFixed(2)} ${sizes[i]}`;
  }

  /**
   * 업타임 계산 (초 단위)
   */
  private getUptime(): number {
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  /**
   * 앱 버전 조회
   */
  private getVersion(): string {
    return process.env.npm_package_version || '1.0.0';
  }
}