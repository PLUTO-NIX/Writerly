import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { logger, LogMetadata } from '../utils/logger';

export interface RequestWithId extends Request {
  id?: string;
  startTime?: number;
}

export interface RequestLogData {
  method: string;
  url: string;
  userAgent?: string;
  ip: string;
  body?: any;
  query?: any;
  params?: any;
  userId?: string;
  workspaceId?: string;
}

export interface ResponseLogData {
  statusCode: number;
  duration: number;
  contentLength?: number;
  error?: string;
}

/**
 * 요청/응답 로깅 미들웨어
 * - 모든 HTTP 요청에 추적 ID 할당
 * - 요청 정보 로깅 (민감한 정보 제외)
 * - 응답 시간 측정 및 로깅
 * - 에러 발생 시 상세 로깅
 */
export function loggingMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  // 요청 ID 생성 및 할당
  req.id = req.headers['x-request-id'] as string || uuidv4();
  req.startTime = Date.now();

  // 응답 헤더에 요청 ID 추가
  res.setHeader('X-Request-ID', req.id);

  // 요청 정보 로깅
  logIncomingRequest(req);

  // 원본 응답 메서드들을 오버라이드하여 로깅 추가
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // res.send 오버라이드
  res.send = function(body?: any) {
    logOutgoingResponse(req, res, body);
    return originalSend.call(this, body);
  };

  // res.json 오버라이드
  res.json = function(body?: any) {
    logOutgoingResponse(req, res, body);
    return originalJson.call(this, body);
  };

  // res.end 오버라이드
  res.end = function(chunk?: any, encoding?: any) {
    logOutgoingResponse(req, res, chunk);
    return originalEnd.call(this, chunk, encoding);
  };

  next();
}

/**
 * 들어오는 요청 로깅
 */
function logIncomingRequest(req: RequestWithId): void {
  const requestData: RequestLogData = {
    method: req.method,
    url: req.url,
    userAgent: req.headers['user-agent'],
    ip: getClientIp(req),
    query: req.query,
    params: req.params,
  };

  // Slack 요청의 경우 사용자 정보 추가
  if (req.body) {
    if (req.body.user_id) {
      requestData.userId = req.body.user_id;
    }
    if (req.body.team_id) {
      requestData.workspaceId = req.body.team_id;
    }

    // 민감한 정보 제외하고 body 로깅
    requestData.body = sanitizeRequestBody(req.body);
  }

  const metadata: LogMetadata = {
    requestId: req.id,
    userId: requestData.userId,
    workspaceId: requestData.workspaceId,
    action: 'request_received',
  };

  logger.info(`요청 수신: ${req.method} ${req.url}`, metadata);
}

/**
 * 나가는 응답 로깅
 */
function logOutgoingResponse(req: RequestWithId, res: Response, body?: any): void {
  if (!req.startTime || !req.id) return;

  const duration = Date.now() - req.startTime;
  const responseData: ResponseLogData = {
    statusCode: res.statusCode,
    duration,
    contentLength: res.get('Content-Length') ? parseInt(res.get('Content-Length')!) : undefined,
  };

  const metadata: LogMetadata = {
    requestId: req.id,
    userId: extractUserIdFromRequest(req),
    workspaceId: extractWorkspaceIdFromRequest(req),
    action: 'response_sent',
    duration,
    statusCode: res.statusCode,
  };

  // 에러 응답인 경우 에러 정보 추가
  if (res.statusCode >= 400) {
    responseData.error = extractErrorFromBody(body);
    metadata.error = responseData.error;
    
    logger.error(`응답 전송 (오류): ${req.method} ${req.url} - ${res.statusCode}`, metadata);
  } else {
    logger.info(`응답 전송: ${req.method} ${req.url} - ${res.statusCode}`, metadata);
  }

  // 느린 요청 경고 (5초 이상)
  if (duration > 5000) {
    logger.warn(`느린 응답: ${req.method} ${req.url}`, {
      ...metadata,
      warningType: 'slow_response',
    });
  }
}

/**
 * 요청 body에서 민감한 정보 제거
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') return body;

  const sensitiveFields = [
    'token', 'access_token', 'refresh_token', 'password', 
    'client_secret', 'api_key', 'authorization'
  ];

  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  // Slack 서명도 제거
  if (sanitized['X-Slack-Signature']) {
    sanitized['X-Slack-Signature'] = '[REDACTED]';
  }

  return sanitized;
}

/**
 * 클라이언트 IP 주소 추출
 */
function getClientIp(req: Request): string {
  return (
    req.headers['x-forwarded-for'] as string ||
    req.headers['x-real-ip'] as string ||
    req.socket.remoteAddress ||
    'unknown'
  );
}

/**
 * 요청에서 사용자 ID 추출
 */
function extractUserIdFromRequest(req: RequestWithId): string | undefined {
  return req.body?.user_id || req.query?.user_id as string;
}

/**
 * 요청에서 워크스페이스 ID 추출
 */
function extractWorkspaceIdFromRequest(req: RequestWithId): string | undefined {
  return req.body?.team_id || req.query?.team_id as string;
}

/**
 * 응답 body에서 에러 메시지 추출
 */
function extractErrorFromBody(body: any): string | undefined {
  if (!body) return undefined;
  
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed.error || parsed.message;
    } catch {
      return body.substring(0, 200); // 긴 문자열은 자르기
    }
  }
  
  if (typeof body === 'object') {
    return body.error || body.message;
  }
  
  return undefined;
}

/**
 * 에러 처리 미들웨어
 * Express 에러 핸들러 - 모든 에러를 로깅하고 사용자 친화적 응답 제공
 */
export function errorLoggingMiddleware(
  error: Error,
  req: RequestWithId,
  res: Response,
  next: NextFunction
): void {
  const requestId = req.id || 'unknown';
  
  // 에러 상세 로깅
  logger.logError(error, {
    requestId,
    userId: extractUserIdFromRequest(req),
    workspaceId: extractWorkspaceIdFromRequest(req),
    action: 'error_handled',
    url: req.url,
    method: req.method,
    stack: error.stack,
  });

  // 이미 응답이 시작된 경우 다음 에러 핸들러로 전달
  if (res.headersSent) {
    return next(error);
  }

  // 에러 타입에 따른 상태 코드 결정
  let statusCode = 500;
  let userMessage = '서버 내부 오류가 발생했습니다.';

  if (error.name === 'ValidationError') {
    statusCode = 400;
    userMessage = '입력 데이터가 올바르지 않습니다.';
  } else if (error.name === 'UnauthorizedError') {
    statusCode = 401;
    userMessage = '인증이 필요합니다.';
  } else if (error.name === 'ForbiddenError') {
    statusCode = 403;
    userMessage = '접근 권한이 없습니다.';
  } else if (error.name === 'NotFoundError') {
    statusCode = 404;
    userMessage = '요청한 리소스를 찾을 수 없습니다.';
  }

  // 사용자 친화적 에러 응답
  res.status(statusCode).json({
    error: userMessage,
    requestId,
    timestamp: new Date().toISOString(),
    // 개발 환경에서만 스택 트레이스 포함
    ...(process.env.NODE_ENV === 'development' && {
      stack: error.stack,
      details: error.message,
    }),
  });
}

/**
 * 404 에러 처리 미들웨어
 */
export function notFoundMiddleware(req: RequestWithId, res: Response): void {
  const requestId = req.id || 'unknown';
  
  logger.warn(`404 오류: 경로를 찾을 수 없습니다`, {
    requestId,
    action: 'not_found',
    url: req.url,
    method: req.method,
  });

  res.status(404).json({
    error: '요청한 경로를 찾을 수 없습니다.',
    requestId,
    timestamp: new Date().toISOString(),
    path: req.url,
    method: req.method,
  });
}

/**
 * 성능 모니터링을 위한 메트릭 수집 미들웨어
 */
export function metricsMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // 메트릭 데이터 로깅
    logger.info('요청 메트릭', {
      requestId: req.id,
      action: 'metrics_collected',
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration,
      contentLength: res.get('Content-Length'),
      userAgent: req.headers['user-agent'],
    });
  });

  next();
}