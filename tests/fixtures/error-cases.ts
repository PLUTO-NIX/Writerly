/**
 * 에러 케이스 테스트 픽스처
 * 실제 에러 상황을 기반으로 한 Mock 데이터
 */

import { AppError, ErrorType, ErrorSeverity } from '../../src/utils/error-handler';

// 입력 검증 에러 케이스들
export const validationErrorCases = {
  emptyPrompt: {
    input: {
      requestId: 'req_empty_prompt',
      prompt: '',
      userId: 'U2147483697',
      responseUrl: 'https://hooks.slack.com/commands/1234/5678',
      workspaceId: 'T0001'
    },
    expectedError: new AppError(
      ErrorType.VALIDATION,
      'Empty prompt provided',
      '프롬프트가 비어있습니다. 처리할 내용을 입력해주세요.',
      400,
      ErrorSeverity.LOW
    )
  },

  missingRequiredField: {
    input: {
      requestId: 'req_missing_field',
      // prompt 필드 누락
      userId: 'U2147483697',
      responseUrl: 'https://hooks.slack.com/commands/1234/5678',
      workspaceId: 'T0001'
    },
    expectedError: new AppError(
      ErrorType.VALIDATION,
      'Missing required field: prompt',
      '필수 입력 항목이 누락되었습니다.',
      400,
      ErrorSeverity.LOW
    )
  },

  inputTooLong: {
    input: {
      requestId: 'req_too_long',
      prompt: 'a'.repeat(10001), // 10,001자 - 제한 초과
      userId: 'U2147483697',
      responseUrl: 'https://hooks.slack.com/commands/1234/5678',
      workspaceId: 'T0001'
    },
    expectedError: new AppError(
      ErrorType.VALIDATION,
      'Prompt length 10001 exceeds maximum 10000',
      '입력 텍스트가 너무 깁니다. 10,000자 이하로 입력해주세요.',
      400,
      ErrorSeverity.LOW
    )
  },

  invalidCommandFormat: {
    input: {
      slackText: '"incomplete quote',
      command: '/ai'
    },
    expectedError: new AppError(
      ErrorType.VALIDATION,
      'Invalid command format',
      '명령어 형식이 올바르지 않습니다. "/ai "프롬프트" "데이터"" 형식으로 입력해주세요.',
      400,
      ErrorSeverity.LOW
    )
  }
};

// 인증/권한 에러 케이스들
export const authenticationErrorCases = {
  noSession: {
    scenario: 'User not authenticated',
    userId: 'U_UNAUTHENTICATED',
    workspaceId: 'T0001',
    expectedError: new AppError(
      ErrorType.AUTHENTICATION,
      'No valid session found',
      '인증이 필요합니다. Slack 앱을 먼저 설치해주세요.',
      401,
      ErrorSeverity.MEDIUM
    )
  },

  expiredSession: {
    scenario: 'Session expired',
    sessionData: {
      userId: 'U2147483697',
      token: 'expired_token',
      workspaceId: 'T0001',
      expiresAt: new Date(Date.now() - 3600000) // 1시간 전 만료
    },
    expectedError: new AppError(
      ErrorType.AUTHENTICATION,
      'Session expired',
      '세션이 만료되었습니다. 다시 로그인해주세요.',
      401,
      ErrorSeverity.MEDIUM
    )
  },

  invalidSignature: {
    scenario: 'Invalid Slack signature',
    headers: {
      'x-slack-signature': 'v0=invalid_signature',
      'x-slack-request-timestamp': Math.floor(Date.now() / 1000).toString()
    },
    expectedError: new AppError(
      ErrorType.AUTHENTICATION,
      'Invalid Slack signature',
      '유효하지 않은 요청입니다. 올바른 Slack 앱에서 요청해주세요.',
      401,
      ErrorSeverity.HIGH
    )
  },

  workspaceMismatch: {
    scenario: 'User session from different workspace',
    sessionWorkspaceId: 'T0001',
    requestWorkspaceId: 'T0002',
    expectedError: new AppError(
      ErrorType.AUTHORIZATION,
      'Workspace mismatch',
      '이 워크스페이스는 인증되지 않았습니다.',
      403,
      ErrorSeverity.MEDIUM
    )
  }
};

// 외부 API 에러 케이스들
export const externalApiErrorCases = {
  vertexAIQuotaExceeded: {
    scenario: 'Vertex AI quota exceeded',
    apiResponse: {
      error: {
        code: 429,
        message: 'Quota exceeded for requests per minute per region.',
        status: 'RESOURCE_EXHAUSTED'
      }
    },
    expectedError: new AppError(
      ErrorType.VERTEX_AI,
      'Vertex AI quota exceeded',
      'AI 서비스 사용량이 초과되었습니다. 관리자에게 문의해주세요.',
      429,
      ErrorSeverity.HIGH
    )
  },

  vertexAIServiceUnavailable: {
    scenario: 'Vertex AI service unavailable',
    apiResponse: {
      error: {
        code: 503,
        message: 'The service is currently unavailable.',
        status: 'UNAVAILABLE'
      }
    },
    expectedError: new AppError(
      ErrorType.VERTEX_AI,
      'Vertex AI service unavailable',
      'AI 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      503,
      ErrorSeverity.HIGH
    )
  },

  vertexAITimeout: {
    scenario: 'Vertex AI request timeout',
    timeout: 30000, // 30초
    expectedError: new AppError(
      ErrorType.VERTEX_AI,
      'Request timeout',
      'AI 서비스 응답 시간이 초과되었습니다. 다시 시도해주세요.',
      504,
      ErrorSeverity.MEDIUM
    )
  },

  slackWebhookFailed: {
    scenario: 'Slack webhook delivery failed',
    webhookResponse: {
      status: 400,
      statusText: 'Bad Request',
      body: { ok: false, error: 'channel_not_found' }
    },
    expectedError: new AppError(
      ErrorType.SLACK_API,
      'Slack webhook failed: 400 Bad Request',
      '결과 전송에 실패했습니다.',
      502,
      ErrorSeverity.HIGH
    )
  },

  slackWebhookTimeout: {
    scenario: 'Slack webhook timeout',
    timeout: 10000, // 10초
    expectedError: new AppError(
      ErrorType.SLACK_API,
      'Slack webhook timeout',
      '네트워크 문제로 결과 전송에 실패했습니다.',
      504,
      ErrorSeverity.MEDIUM
    )
  }
};

// Redis 에러 케이스들
export const redisErrorCases = {
  connectionError: {
    scenario: 'Redis connection failed',
    error: new Error('connect ECONNREFUSED 127.0.0.1:6379'),
    expectedError: new AppError(
      ErrorType.REDIS,
      'Redis connection failed',
      '세션 저장소 연결에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      503,
      ErrorSeverity.HIGH
    )
  },

  memoryLimitExceeded: {
    scenario: 'Redis memory limit exceeded',
    error: new Error('OOM command not allowed when used memory > \'maxmemory\''),
    expectedError: new AppError(
      ErrorType.REDIS,
      'Redis memory limit exceeded',
      '시스템 리소스 부족으로 일시적으로 서비스를 사용할 수 없습니다.',
      503,
      ErrorSeverity.CRITICAL
    )
  },

  operationTimeout: {
    scenario: 'Redis operation timeout',
    error: new Error('Command timed out'),
    expectedError: new AppError(
      ErrorType.REDIS,
      'Redis operation timeout',
      '세션 저장소 응답 시간이 초과되었습니다. 다시 시도해주세요.',
      504,
      ErrorSeverity.MEDIUM
    )
  }
};

// 큐 서비스 에러 케이스들
export const queueErrorCases = {
  enqueueFailed: {
    scenario: 'Failed to enqueue task',
    error: new Error('Cloud Tasks API error'),
    expectedError: new AppError(
      ErrorType.QUEUE,
      'Failed to enqueue AI task',
      '작업 큐 서비스에 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
      503,
      ErrorSeverity.HIGH
    )
  },

  queueFull: {
    scenario: 'Queue is full',
    error: new Error('Queue capacity exceeded'),
    expectedError: new AppError(
      ErrorType.QUEUE,
      'Queue capacity exceeded',
      '현재 요청이 많아 처리가 지연되고 있습니다. 잠시 후 다시 시도해주세요.',
      503,
      ErrorSeverity.MEDIUM
    )
  },

  taskProcessingFailed: {
    scenario: 'Task processing failed',
    taskId: 'task_123',
    error: new Error('Task execution failed'),
    expectedError: new AppError(
      ErrorType.QUEUE,
      'Task processing failed',
      '작업 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      500,
      ErrorSeverity.HIGH
    )
  }
};

// 내부 서버 에러 케이스들
export const internalErrorCases = {
  unexpectedError: {
    scenario: 'Unexpected application error',
    error: new Error('Unexpected error occurred'),
    expectedError: new AppError(
      ErrorType.INTERNAL,
      'Unexpected error occurred',
      '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      500,
      ErrorSeverity.CRITICAL
    )
  },

  nullPointerError: {
    scenario: 'Null pointer exception',
    error: new TypeError('Cannot read property of null'),
    expectedError: new AppError(
      ErrorType.INTERNAL,
      'Null pointer exception',
      '서버 내부 오류가 발생했습니다. 잠시 후 다시 시도해주세요.',
      500,
      ErrorSeverity.CRITICAL
    )
  },

  configurationError: {
    scenario: 'Missing configuration',
    missingConfig: 'VERTEX_AI_PROJECT_ID',
    expectedError: new AppError(
      ErrorType.INTERNAL,
      'Missing required configuration: VERTEX_AI_PROJECT_ID',
      '서비스 설정에 문제가 있습니다. 관리자에게 문의해주세요.',
      500,
      ErrorSeverity.CRITICAL
    )
  }
};

// 레이트 리밋 에러 케이스들
export const rateLimitErrorCases = {
  dailyLimitExceeded: {
    scenario: 'Daily request limit exceeded',
    userId: 'U2147483697',
    dailyCount: 101,
    dailyLimit: 100,
    expectedError: new AppError(
      ErrorType.RATE_LIMIT,
      'Daily limit exceeded',
      '일일 사용량을 초과했습니다. 내일 다시 이용해주세요.',
      429,
      ErrorSeverity.MEDIUM
    )
  },

  hourlyLimitExceeded: {
    scenario: 'Hourly request limit exceeded',
    userId: 'U2147483697',
    hourlyCount: 21,
    hourlyLimit: 20,
    expectedError: new AppError(
      ErrorType.RATE_LIMIT,
      'Hourly limit exceeded',
      '시간당 요청 횟수가 제한을 초과했습니다. 잠시 후 다시 시도해주세요.',
      429,
      ErrorSeverity.MEDIUM
    )
  },

  concurrentRequestLimit: {
    scenario: 'Too many concurrent requests',
    userId: 'U2147483697',
    concurrentCount: 6,
    concurrentLimit: 5,
    expectedError: new AppError(
      ErrorType.RATE_LIMIT,
      'Concurrent request limit exceeded',
      '동시 요청 횟수가 제한을 초과했습니다. 잠시 후 다시 시도해주세요.',
      429,
      ErrorSeverity.MEDIUM
    )
  }
};

// 복합 에러 시나리오들
export const complexErrorScenarios = {
  cascadingFailure: {
    description: 'Redis down -> Session check fails -> Fallback to auth fails',
    steps: [
      {
        service: 'Redis',
        error: redisErrorCases.connectionError.error,
        expectedError: redisErrorCases.connectionError.expectedError
      },
      {
        service: 'Auth Fallback',
        error: new Error('OAuth service also unavailable'),
        expectedError: new AppError(
          ErrorType.AUTHENTICATION,
          'Authentication services unavailable',
          '인증 서비스에 일시적인 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
          503,
          ErrorSeverity.CRITICAL
        )
      }
    ]
  },

  partialServiceFailure: {
    description: 'AI generation succeeds but Slack webhook fails',
    aiResponse: {
      content: 'AI 응답 내용',
      success: true
    },
    webhookError: externalApiErrorCases.slackWebhookFailed.expectedError,
    expectedBehavior: 'Return partial success with warning'
  },

  retryExhaustion: {
    description: 'All retry attempts failed',
    maxRetries: 3,
    attempts: [
      { error: externalApiErrorCases.vertexAITimeout.expectedError },
      { error: externalApiErrorCases.vertexAIServiceUnavailable.expectedError },
      { error: externalApiErrorCases.vertexAIQuotaExceeded.expectedError }
    ],
    finalError: new AppError(
      ErrorType.VERTEX_AI,
      'Max retries exceeded',
      'AI 서비스에 연결할 수 없습니다. 잠시 후 다시 시도해주세요.',
      503,
      ErrorSeverity.HIGH
    )
  }
};

// 테스트용 에러 생성 헬퍼 함수들
export function createValidationError(
  field: string,
  value: any,
  constraint: string
): AppError {
  return new AppError(
    ErrorType.VALIDATION,
    `Invalid ${field}: ${constraint}`,
    '입력 데이터가 올바르지 않습니다.',
    400,
    ErrorSeverity.LOW,
    true,
    { field, value, constraint }
  );
}

export function createTimeoutError(
  service: string,
  timeoutMs: number
): AppError {
  const serviceType = service.toLowerCase().includes('vertex') 
    ? ErrorType.VERTEX_AI 
    : service.toLowerCase().includes('slack')
    ? ErrorType.SLACK_API
    : ErrorType.EXTERNAL_API;

  return new AppError(
    serviceType,
    `${service} timeout after ${timeoutMs}ms`,
    '외부 서비스 응답 시간이 초과되었습니다. 다시 시도해주세요.',
    504,
    ErrorSeverity.MEDIUM,
    true,
    { service, timeoutMs }
  );
}

export function createNetworkError(
  service: string,
  statusCode: number,
  statusText: string
): AppError {
  const serviceType = service.toLowerCase().includes('vertex') 
    ? ErrorType.VERTEX_AI 
    : service.toLowerCase().includes('slack')
    ? ErrorType.SLACK_API
    : ErrorType.EXTERNAL_API;

  return new AppError(
    serviceType,
    `${service} network error: ${statusCode} ${statusText}`,
    '네트워크 문제가 발생했습니다. 잠시 후 다시 시도해주세요.',
    502,
    ErrorSeverity.HIGH,
    true,
    { service, statusCode, statusText }
  );
}

// Express 에러 핸들러 테스트용 에러 객체들
export const expressErrorScenarios = {
  validationError: {
    name: 'ValidationError',
    message: 'Validation failed',
    expectedStatus: 400,
    expectedMessage: '입력 데이터가 올바르지 않습니다.'
  },

  unauthorizedError: {
    name: 'UnauthorizedError',
    message: 'Authentication required',
    expectedStatus: 401,
    expectedMessage: '인증이 필요합니다.'
  },

  forbiddenError: {
    name: 'ForbiddenError',
    message: 'Access denied',
    expectedStatus: 403,
    expectedMessage: '접근 권한이 없습니다.'
  },

  notFoundError: {
    name: 'NotFoundError',
    message: 'Resource not found',
    expectedStatus: 404,
    expectedMessage: '요청한 리소스를 찾을 수 없습니다.'
  },

  genericError: {
    name: 'Error',
    message: 'Something went wrong',
    expectedStatus: 500,
    expectedMessage: '서버 내부 오류가 발생했습니다.'
  }
};

// 모든 에러 케이스를 하나의 객체로 export
export const allErrorCases = {
  validation: validationErrorCases,
  authentication: authenticationErrorCases,
  externalApi: externalApiErrorCases,
  redis: redisErrorCases,
  queue: queueErrorCases,
  internal: internalErrorCases,
  rateLimit: rateLimitErrorCases,
  complex: complexErrorScenarios,
  express: expressErrorScenarios
};