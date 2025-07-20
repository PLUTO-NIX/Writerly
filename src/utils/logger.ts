import { Logging, LogSync } from '@google-cloud/logging';

export interface LogMetadata {
  requestId?: string;
  userId?: string;
  workspaceId?: string;
  action?: string;
  duration?: number;
  statusCode?: number;
  error?: string | Error;
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  [key: string]: any;
}

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

export interface StructuredLog {
  timestamp: string;
  level: string;
  message: string;
  metadata?: LogMetadata;
  service: string;
  version: string;
  environment: string;
}

class EnhancedLogger {
  private googleLogging?: Logging;
  private log?: LogSync;
  private readonly service = 'slack-ai-bot';
  private readonly version = process.env.npm_package_version || '1.0.0';
  private readonly environment = process.env.NODE_ENV || 'development';
  private readonly logLevel: LogLevel;

  constructor() {
    // 로그 레벨 설정 (환경변수 또는 기본값)
    const levelString = process.env.LOG_LEVEL?.toUpperCase() || 'INFO';
    this.logLevel = LogLevel[levelString as keyof typeof LogLevel] ?? LogLevel.INFO;

    // 프로덕션 환경에서만 Google Cloud Logging 초기화
    if (this.environment === 'production') {
      try {
        this.googleLogging = new Logging({
          projectId: process.env.GOOGLE_CLOUD_PROJECT,
        });
        this.log = this.googleLogging.logSync('slack-ai-bot');
      } catch (error) {
        console.warn('Google Cloud Logging 초기화 실패, 콘솔 로깅으로 폴백:', error);
      }
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.logLevel;
  }

  private formatMessage(message: string, metadata?: LogMetadata): StructuredLog {
    return {
      timestamp: new Date().toISOString(),
      level: LogLevel[this.logLevel],
      message,
      metadata: metadata ? this.sanitizeMetadata(metadata) : undefined,
      service: this.service,
      version: this.version,
      environment: this.environment,
    };
  }

  private sanitizeMetadata(metadata: LogMetadata): LogMetadata {
    const sanitized = { ...metadata };
    
    // 민감한 정보 마스킹
    if (sanitized.token) {
      sanitized.token = this.maskSensitiveData(sanitized.token as string);
    }
    if (sanitized.accessToken) {
      sanitized.accessToken = this.maskSensitiveData(sanitized.accessToken as string);
    }
    
    // 에러 객체 직렬화
    if (sanitized.error instanceof Error) {
      sanitized.error = {
        name: sanitized.error.name,
        message: sanitized.error.message,
        stack: sanitized.error.stack,
      };
    }

    return sanitized;
  }

  private maskSensitiveData(data: string): string {
    if (!data || data.length < 8) return '***';
    return `${data.substring(0, 4)}***${data.substring(data.length - 4)}`;
  }

  private writeLog(level: LogLevel, message: string, metadata?: LogMetadata): void {
    if (!this.shouldLog(level)) return;

    const structuredLog = this.formatMessage(message, metadata);

    if (this.environment === 'production' && this.log) {
      // Google Cloud Logging에 구조화된 로그 전송
      try {
        const entry = this.log.entry(
          {
            severity: LogLevel[level],
            timestamp: structuredLog.timestamp,
          },
          structuredLog
        );
        this.log.write(entry);
      } catch (error) {
        // Cloud Logging 실패 시 콘솔로 폴백
        console.error('Cloud Logging 전송 실패:', error);
        this.writeToConsole(level, structuredLog);
      }
    } else {
      // 개발/테스트 환경에서는 콘솔 출력
      this.writeToConsole(level, structuredLog);
    }
  }

  private writeToConsole(level: LogLevel, log: StructuredLog): void {
    const coloredMessage = this.addColors(level, log.message);
    const output = this.environment === 'development' 
      ? `[${log.level}] ${coloredMessage}${log.metadata ? ' ' + JSON.stringify(log.metadata, null, 2) : ''}`
      : JSON.stringify(log);

    switch (level) {
      case LogLevel.DEBUG:
        console.debug(output);
        break;
      case LogLevel.INFO:
        console.log(output);
        break;
      case LogLevel.WARN:
        console.warn(output);
        break;
      case LogLevel.ERROR:
        console.error(output);
        break;
    }
  }

  private addColors(level: LogLevel, message: string): string {
    if (this.environment !== 'development') return message;

    const colors = {
      [LogLevel.DEBUG]: '\x1b[36m', // Cyan
      [LogLevel.INFO]: '\x1b[32m',  // Green
      [LogLevel.WARN]: '\x1b[33m',  // Yellow
      [LogLevel.ERROR]: '\x1b[31m', // Red
    };
    const reset = '\x1b[0m';
    return `${colors[level]}${message}${reset}`;
  }

  debug(message: string, metadata?: LogMetadata): void {
    this.writeLog(LogLevel.DEBUG, message, metadata);
  }

  info(message: string, metadata?: LogMetadata): void {
    this.writeLog(LogLevel.INFO, message, metadata);
  }

  warn(message: string, metadata?: LogMetadata): void {
    this.writeLog(LogLevel.WARN, message, metadata);
  }

  error(message: string, metadata?: LogMetadata): void {
    this.writeLog(LogLevel.ERROR, message, metadata);
  }

  // 성능 측정을 위한 헬퍼 메서드
  startTimer(requestId: string, action: string): () => void {
    const startTime = Date.now();
    return () => {
      const duration = Date.now() - startTime;
      this.info(`작업 완료: ${action}`, {
        requestId,
        action,
        duration,
      });
    };
  }

  // 에러 로깅을 위한 헬퍼 메서드
  logError(error: Error | string, metadata?: LogMetadata): void {
    const errorMessage = error instanceof Error ? error.message : error;
    this.error(`오류 발생: ${errorMessage}`, {
      ...metadata,
      error,
    });
  }

  // 사용자 작업 로깅을 위한 헬퍼 메서드
  logUserAction(action: string, metadata: LogMetadata): void {
    this.info(`사용자 작업: ${action}`, {
      ...metadata,
      action,
    });
  }

  // 토큰 사용량 로깅을 위한 헬퍼 메서드
  logTokenUsage(requestId: string, tokenUsage: LogMetadata['tokenUsage'], metadata?: LogMetadata): void {
    this.info('토큰 사용량 기록', {
      ...metadata,
      requestId,
      tokenUsage,
    });
  }

  // API 요청/응답 로깅을 위한 헬퍼 메서드
  logApiCall(method: string, url: string, statusCode: number, duration: number, metadata?: LogMetadata): void {
    const level = statusCode >= 400 ? LogLevel.ERROR : LogLevel.INFO;
    const message = `API 호출: ${method} ${url} - ${statusCode}`;
    
    this.writeLog(level, message, {
      ...metadata,
      method,
      url,
      statusCode,
      duration,
    });
  }
}

// 싱글톤 인스턴스 생성 및 export
export const logger = new EnhancedLogger();