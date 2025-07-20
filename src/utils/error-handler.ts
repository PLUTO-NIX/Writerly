import { logger, LogMetadata } from './logger';

/**
 * 애플리케이션 에러 타입 정의
 */
export enum ErrorType {
  VALIDATION = 'VALIDATION_ERROR',
  AUTHENTICATION = 'AUTHENTICATION_ERROR',
  AUTHORIZATION = 'AUTHORIZATION_ERROR',
  NOT_FOUND = 'NOT_FOUND_ERROR',
  RATE_LIMIT = 'RATE_LIMIT_ERROR',
  EXTERNAL_API = 'EXTERNAL_API_ERROR',
  VERTEX_AI = 'VERTEX_AI_ERROR',
  SLACK_API = 'SLACK_API_ERROR',
  REDIS = 'REDIS_ERROR',
  QUEUE = 'QUEUE_ERROR',
  INTERNAL = 'INTERNAL_ERROR',
}

/**
 * 에러 심각도 레벨
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * 구조화된 애플리케이션 에러 클래스
 */
export class AppError extends Error {
  public readonly type: ErrorType;
  public readonly statusCode: number;
  public readonly userMessage: string; // 사용자에게 표시될 한국어 메시지
  public readonly severity: ErrorSeverity;
  public readonly isOperational: boolean;
  public readonly timestamp: Date;
  public readonly metadata?: LogMetadata;

  constructor(
    type: ErrorType,
    message: string,
    userMessage: string,
    statusCode: number = 500,
    severity: ErrorSeverity = ErrorSeverity.MEDIUM,
    isOperational: boolean = true,
    metadata?: LogMetadata
  ) {
    super(message);
    
    this.name = 'AppError';
    this.type = type;
    this.statusCode = statusCode;
    this.userMessage = userMessage;
    this.severity = severity;
    this.isOperational = isOperational;
    this.timestamp = new Date();
    this.metadata = metadata;

    // V8 스택 트레이스 캡처
    Error.captureStackTrace(this, AppError);
  }
}

/**
 * 한국어 에러 메시지 매핑
 */
export const ErrorMessages = {
  // 입력 검증 에러
  INVALID_INPUT: '입력 데이터가 올바르지 않습니다.',
  MISSING_REQUIRED_FIELD: '필수 입력 항목이 누락되었습니다.',
  INPUT_TOO_LONG: '입력 텍스트가 너무 깁니다. 10,000자 이하로 입력해주세요.',
  INVALID_COMMAND_FORMAT: '명령어 형식이 올바르지 않습니다. "/ai "프롬프트" "데이터"" 형식으로 입력해주세요.',
  EMPTY_PROMPT: '프롬프트가 비어있습니다. 처리할 내용을 입력해주세요.',

  // 인증/권한 에러
  AUTHENTICATION_REQUIRED: '인증이 필요합니다. Slack 앱을 먼저 설치해주세요.',
  SESSION_EXPIRED: '세션이 만료되었습니다. 다시 로그인해주세요.',
  INVALID_SIGNATURE: '유효하지 않은 요청입니다. 올바른 Slack 앱에서 요청해주세요.',
  WORKSPACE_NOT_AUTHORIZED: '이 워크스페이스는 인증되지 않았습니다.',
  INSUFFICIENT_PERMISSIONS: '이 작업을 수행할 권한이 없습니다.',

  // 외부 API 에러
  SLACK_API_ERROR: 'Slack 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
  VERTEX_AI_ERROR: 'AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
  VERTEX_AI_QUOTA_EXCEEDED: 'AI 서비스 사용량이 초과되었습니다. 관리자에게 문의해주세요.',
  EXTERNAL_SERVICE_TIMEOUT: '외부 서비스 응답 시간이 초과되었습니다. 다시 시도해주세요.',

  // 시스템 에러
  REDIS_CONNECTION_ERROR: '세션 저장소 연결에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
  QUEUE_SERVICE_ERROR: '작업 큐 서비스에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
  INTERNAL_SERVER_ERROR: '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',

  // 사용률 제한 에러
  RATE_LIMIT_EXCEEDED: '요청 횟수가 제한을 초과했습니다. 잠시 후 다시 시도해주세요.',
  DAILY_LIMIT_EXCEEDED: '일일 사용량을 초과했습니다. 내일 다시 이용해주세요.',

  // 리소스 에러
  NOT_FOUND: '요청한 리소스를 찾을 수 없습니다.',
  RESOURCE_CONFLICT: '리소스 충돌이 발생했습니다.',

  // 일반적인 에러
  SERVICE_UNAVAILABLE: '서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해주세요.',
  MAINTENANCE_MODE: '현재 시스템 점검 중입니다. 잠시 후 다시 이용해주세요.',
  UNKNOWN_ERROR: '알 수 없는 오류가 발생했습니다. 관리자에게 문의해주세요.',
} as const;

/**
 * 에러 생성 헬퍼 함수들
 */
export class ErrorFactory {
  /**
   * 입력 검증 에러 생성
   */
  static createValidationError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.VALIDATION,
      message,
      userMessage || ErrorMessages.INVALID_INPUT,
      400,
      ErrorSeverity.LOW,
      true,
      metadata
    );
  }

  /**
   * 인증 에러 생성
   */
  static createAuthenticationError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.AUTHENTICATION,
      message,
      userMessage || ErrorMessages.AUTHENTICATION_REQUIRED,
      401,
      ErrorSeverity.MEDIUM,
      true,
      metadata
    );
  }

  /**
   * 권한 에러 생성
   */
  static createAuthorizationError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.AUTHORIZATION,
      message,
      userMessage || ErrorMessages.INSUFFICIENT_PERMISSIONS,
      403,
      ErrorSeverity.MEDIUM,
      true,
      metadata
    );
  }

  /**
   * 리소스 찾을 수 없음 에러 생성
   */
  static createNotFoundError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.NOT_FOUND,
      message,
      userMessage || ErrorMessages.NOT_FOUND,
      404,
      ErrorSeverity.LOW,
      true,
      metadata
    );
  }

  /**
   * 사용률 제한 에러 생성
   */
  static createRateLimitError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.RATE_LIMIT,
      message,
      userMessage || ErrorMessages.RATE_LIMIT_EXCEEDED,
      429,
      ErrorSeverity.MEDIUM,
      true,
      metadata
    );
  }

  /**
   * 외부 API 에러 생성
   */
  static createExternalApiError(
    service: string,
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    const type = service.toLowerCase().includes('slack') 
      ? ErrorType.SLACK_API 
      : service.toLowerCase().includes('vertex') 
      ? ErrorType.VERTEX_AI 
      : ErrorType.EXTERNAL_API;

    return new AppError(
      type,
      `${service}: ${message}`,
      userMessage || ErrorMessages.EXTERNAL_SERVICE_TIMEOUT,
      502,
      ErrorSeverity.HIGH,
      true,
      { ...metadata, service }
    );
  }

  /**
   * Redis 에러 생성
   */
  static createRedisError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.REDIS,
      message,
      userMessage || ErrorMessages.REDIS_CONNECTION_ERROR,
      503,
      ErrorSeverity.HIGH,
      true,
      metadata
    );
  }

  /**
   * 큐 서비스 에러 생성
   */
  static createQueueError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.QUEUE,
      message,
      userMessage || ErrorMessages.QUEUE_SERVICE_ERROR,
      503,
      ErrorSeverity.HIGH,
      true,
      metadata
    );
  }

  /**
   * 내부 서버 에러 생성
   */
  static createInternalError(
    message: string,
    userMessage?: string,
    metadata?: LogMetadata
  ): AppError {
    return new AppError(
      ErrorType.INTERNAL,
      message,
      userMessage || ErrorMessages.INTERNAL_SERVER_ERROR,
      500,
      ErrorSeverity.CRITICAL,
      false, // 내부 에러는 일반적으로 프로그래밍 에러
      metadata
    );
  }
}

/**
 * 에러 로깅 및 처리 유틸리티
 */
export class ErrorHandler {
  /**
   * 에러 로깅 및 모니터링
   */
  static logAndMonitor(error: AppError | Error, metadata?: LogMetadata): void {
    const logMetadata: LogMetadata = {
      ...metadata,
      timestamp: new Date().toISOString(),
    };

    if (error instanceof AppError) {
      logMetadata.errorType = error.type;
      logMetadata.severity = error.severity;
      logMetadata.statusCode = error.statusCode;
      logMetadata.isOperational = error.isOperational;
      
      // 심각도에 따른 로깅 레벨 결정
      switch (error.severity) {
        case ErrorSeverity.LOW:
          logger.info(`처리된 에러: ${error.message}`, logMetadata);
          break;
        case ErrorSeverity.MEDIUM:
          logger.warn(`주의 에러: ${error.message}`, logMetadata);
          break;
        case ErrorSeverity.HIGH:
        case ErrorSeverity.CRITICAL:
          logger.error(`심각한 에러: ${error.message}`, logMetadata);
          break;
      }
    } else {
      // 일반 에러는 내부 에러로 처리
      logger.error(`처리되지 않은 에러: ${error.message}`, {
        ...logMetadata,
        errorType: ErrorType.INTERNAL,
        severity: ErrorSeverity.CRITICAL,
        stack: error.stack,
      });
    }
  }

  /**
   * 에러를 사용자 친화적 응답으로 변환
   */
  static toUserResponse(error: AppError | Error, requestId?: string): {
    error: string;
    requestId?: string;
    timestamp: string;
    code?: string;
  } {
    const timestamp = new Date().toISOString();

    if (error instanceof AppError) {
      return {
        error: error.userMessage,
        requestId,
        timestamp,
        code: error.type,
      };
    }

    // 일반 에러는 기본 메시지로 변환
    return {
      error: ErrorMessages.INTERNAL_SERVER_ERROR,
      requestId,
      timestamp,
      code: ErrorType.INTERNAL,
    };
  }

  /**
   * Slack 응답 형식으로 에러 변환
   */
  static toSlackResponse(error: AppError | Error): {
    response_type: 'ephemeral';
    text: string;
    blocks?: any[];
  } {
    const userMessage = error instanceof AppError 
      ? error.userMessage 
      : ErrorMessages.INTERNAL_SERVER_ERROR;

    return {
      response_type: 'ephemeral',
      text: `❌ ${userMessage}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ **오류 발생**\n\n${userMessage}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: '_문제가 지속되면 관리자에게 문의해주세요._',
            },
          ],
        },
      ],
    };
  }

  /**
   * 에러 복구 시도
   */
  static async attemptRecovery<T>(
    operation: () => Promise<T>,
    fallback: () => Promise<T>,
    errorContext: string,
    metadata?: LogMetadata
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      logger.warn(`에러 복구 시도: ${errorContext}`, {
        ...metadata,
        originalError: error instanceof Error ? error.message : String(error),
      });

      try {
        return await fallback();
      } catch (fallbackError) {
        logger.error(`에러 복구 실패: ${errorContext}`, {
          ...metadata,
          originalError: error instanceof Error ? error.message : String(error),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        });
        throw fallbackError;
      }
    }
  }
}

/**
 * 비동기 작업 래퍼 - 에러 처리 자동화
 */
export function withErrorHandling<T extends any[], R>(
  fn: (...args: T) => Promise<R>,
  context: string
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      const appError = error instanceof AppError 
        ? error 
        : ErrorFactory.createInternalError(
            `${context}: ${error instanceof Error ? error.message : String(error)}`,
            ErrorMessages.INTERNAL_SERVER_ERROR,
            { context, originalError: String(error) }
          );

      ErrorHandler.logAndMonitor(appError);
      throw appError;
    }
  };
}