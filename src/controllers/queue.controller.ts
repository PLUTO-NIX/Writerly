import { Request, Response } from 'express';
import { VertexAIService } from '../services/vertexai.service';
import { logger } from '../utils/logger';
import { monitoringService } from '../services/monitoring.service';
import { 
  AppError, 
  ErrorFactory, 
  ErrorHandler, 
  ErrorMessages,
  withErrorHandling 
} from '../utils/error-handler';
import { AIGenerationRequest } from '../models/vertexai.model';
import { v4 as uuidv4 } from 'uuid';

export interface QueueTaskRequest {
  requestId: string;
  prompt: string;
  data?: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  responseUrl: string;
  priority?: string;
  createdAt: string;
  metadata?: {
    userName?: string;
    teamName?: string;
    originalCommand?: string;
    retryCount?: number;
  };
}

export class QueueController {
  private vertexAIService: VertexAIService;

  constructor() {
    this.vertexAIService = new VertexAIService();
  }

  async processTask(req: Request, res: Response): Promise<void> {
    const startTime = Date.now();
    let requestData: QueueTaskRequest | undefined;

    try {
      requestData = req.body as QueueTaskRequest;
      
      // Validate required fields with enhanced error handling
      this.validateTaskRequestEnhanced(requestData);

      // Start performance timer
      const endTimer = logger.startTimer(requestData.requestId, 'ai_task_processing');

      // Log AI task start with structured logging
      logger.logUserAction('AI 작업 처리 시작', {
        requestId: requestData.requestId,
        userId: requestData.userId,
        workspaceId: requestData.workspaceId,
        action: 'ai_task_start',
        promptLength: requestData.prompt.length,
        hasData: !!requestData.data,
        priority: requestData.priority || 'NORMAL',
      });

      // Create AI generation request
      const aiRequest: AIGenerationRequest = {
        prompt: requestData.prompt,
        data: requestData.data,
        requestId: requestData.requestId,
        userId: requestData.userId,
        contextMetadata: {
          channelId: requestData.channelId,
          workspaceId: requestData.workspaceId,
          userName: requestData.metadata?.userName || 'Unknown',
          timestamp: new Date(requestData.createdAt),
        },
      };

      // Process with Vertex AI with enhanced monitoring
      const aiStartTime = Date.now();
      const aiResponse = await ErrorHandler.attemptRecovery(
        () => this.vertexAIService.generateResponse(aiRequest),
        () => this.retryAIGeneration(aiRequest),
        'vertex_ai_generation',
        { 
          requestId: requestData.requestId,
          userId: requestData.userId,
          promptLength: requestData.prompt.length 
        }
      );
      const aiDuration = Date.now() - aiStartTime;

      // Enhanced token usage and performance monitoring
      monitoringService.logTokenUsage(
        requestData.requestId,
        requestData.userId,
        requestData.workspaceId,
        {
          inputTokens: aiResponse.tokenUsage.inputTokens,
          outputTokens: aiResponse.tokenUsage.outputTokens,
          totalTokens: aiResponse.tokenUsage.totalTokens,
          model: aiResponse.metadata.modelId,
          timestamp: new Date(),
          cost: this.calculateCost(aiResponse.tokenUsage), // 비용 계산
        }
      );

      // Vertex AI 성능 모니터링
      monitoringService.logVertexAIPerformance(
        requestData.requestId,
        aiResponse.metadata.modelId,
        requestData.prompt.length,
        aiResponse.content.length,
        aiResponse.tokenUsage,
        aiDuration,
        true
      );

      // Post result to Slack with enhanced error handling and monitoring
      const slackStartTime = Date.now();
      try {
        await this.postToSlackEnhanced(requestData.responseUrl, aiResponse.content, requestData.requestId);
        
        const slackDuration = Date.now() - slackStartTime;
        monitoringService.logSlackWebhookPerformance(
          requestData.requestId,
          requestData.responseUrl,
          slackDuration,
          200,
          true
        );
      } catch (slackError) {
        const slackDuration = Date.now() - slackStartTime;
        
        // Enhanced Slack webhook error handling
        const appError = slackError instanceof AppError ? slackError : 
          ErrorFactory.createExternalApiError(
            'Slack',
            slackError instanceof Error ? slackError.message : String(slackError),
            '결과 전송에 일시적인 문제가 발생했습니다.',
            { 
              requestId: requestData.requestId,
              webhookUrl: requestData.responseUrl,
              action: 'slack_webhook_failed' 
            }
          );

        ErrorHandler.logAndMonitor(appError);
        
        monitoringService.logSlackWebhookPerformance(
          requestData.requestId,
          requestData.responseUrl,
          slackDuration,
          500,
          false
        );

        // Return partial success response
        const processingTime = Date.now() - startTime;
        endTimer(); // 타이머 종료
        
        res.status(200).json({
          success: true,
          requestId: requestData.requestId,
          processingTimeMs: processingTime,
          tokenUsage: aiResponse.tokenUsage,
          priority: requestData.priority,
          warning: '결과 생성에는 성공했으나 Slack 전송에 실패했습니다.',
          aiResponse: {
            contentLength: aiResponse.content.length,
            modelUsed: aiResponse.metadata.modelId,
          },
        });
        return;
      }

      const processingTime = Date.now() - startTime;
      res.status(200).json({
        success: true,
        requestId: requestData.requestId,
        processingTimeMs: processingTime,
        tokenUsage: aiResponse.tokenUsage,
        priority: requestData.priority,
      });

      logger.info('AI 작업 처리 완료', {
        requestId: requestData.requestId,
        processingTimeMs: processingTime,
        success: true,
      });

    } catch (error) {
      this.handleTaskProcessingError(
        error,
        requestData?.requestId || 'unknown',
        req,
        res,
        startTime
      );
    }
  }

  private validateTaskRequest(request: QueueTaskRequest): void {
    const requiredFields = ['requestId', 'prompt', 'userId', 'responseUrl'];
    
    for (const field of requiredFields) {
      if (!request[field as keyof QueueTaskRequest] || 
          String(request[field as keyof QueueTaskRequest]).trim() === '') {
        throw new Error(`${field} is required`);
      }
    }

    // Additional validation
    if (request.prompt.length === 0) {
      throw new Error('Prompt cannot be empty');
    }

    if (request.requestId.length === 0) {
      throw new Error('Request ID cannot be empty');
    }
  }

  private async postToSlack(responseUrl: string, content: string): Promise<void> {
    const slackMessage = {
      response_type: 'in_channel',
      text: `✅ AI 응답:\n\n${content}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ **AI 응답:**\n\n${content}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_생성 시간: ${new Date().toLocaleString('ko-KR')}_`,
            },
          ],
        },
      ],
    };

    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      throw new Error(`Slack webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  private async postErrorToSlack(responseUrl: string, errorMessage: string): Promise<void> {
    const slackMessage = {
      response_type: 'ephemeral',
      text: `❌ ${errorMessage}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `❌ **오류 발생:**\n\n${errorMessage}`,
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

    const response = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(slackMessage),
    });

    if (!response.ok) {
      throw new Error(`Slack error webhook failed: ${response.status} ${response.statusText}`);
    }
  }

  /**
   * 강화된 요청 검증
   */
  private validateTaskRequestEnhanced(request: QueueTaskRequest): void {
    const requiredFields: (keyof QueueTaskRequest)[] = [
      'requestId', 'prompt', 'userId', 'responseUrl', 'workspaceId'
    ];
    
    for (const field of requiredFields) {
      if (!request[field] || String(request[field]).trim() === '') {
        throw ErrorFactory.createValidationError(
          `Missing required field: ${field}`,
          ErrorMessages.MISSING_REQUIRED_FIELD,
          { field, requestId: request.requestId || 'unknown' }
        );
      }
    }

    // 프롬프트 검증
    if (!request.prompt || request.prompt.trim() === '') {
      throw ErrorFactory.createValidationError(
        'Empty prompt provided',
        ErrorMessages.EMPTY_PROMPT,
        { requestId: request.requestId }
      );
    }

    // 프롬프트 길이 검증
    if (request.prompt.length > 10000) {
      throw ErrorFactory.createValidationError(
        `Prompt length ${request.prompt.length} exceeds maximum 10000`,
        ErrorMessages.INPUT_TOO_LONG,
        { requestId: request.requestId, promptLength: request.prompt.length }
      );
    }

    // Request ID 형식 검증
    if (request.requestId.length === 0) {
      throw ErrorFactory.createValidationError(
        'Request ID cannot be empty',
        '요청 ID가 유효하지 않습니다.',
        { requestId: request.requestId }
      );
    }
  }

  /**
   * AI 생성 재시도 로직
   */
  private async retryAIGeneration(aiRequest: AIGenerationRequest): Promise<any> {
    logger.warn('AI 생성 재시도 시도', {
      requestId: aiRequest.requestId,
      action: 'ai_generation_retry',
    });

    // 간단한 재시도 로직 (실제로는 더 정교한 백오프 전략 필요)
    await new Promise(resolve => setTimeout(resolve, 1000));
    return this.vertexAIService.generateResponse(aiRequest);
  }

  /**
   * 토큰 사용량 기반 비용 계산
   */
  private calculateCost(tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }): number {
    // Gemini 2.5 Flash 가격 (예시)
    const INPUT_TOKEN_COST = 0.000075 / 1000; // $0.000075 per 1K tokens
    const OUTPUT_TOKEN_COST = 0.0003 / 1000;  // $0.0003 per 1K tokens
    
    const inputCost = tokenUsage.inputTokens * INPUT_TOKEN_COST;
    const outputCost = tokenUsage.outputTokens * OUTPUT_TOKEN_COST;
    
    return inputCost + outputCost;
  }

  /**
   * 강화된 Slack 메시지 전송
   */
  private async postToSlackEnhanced(
    responseUrl: string, 
    content: string, 
    requestId: string
  ): Promise<void> {
    const slackMessage = {
      response_type: 'in_channel',
      text: `✅ AI 응답:\n\n${content}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `✅ **AI 응답:**\n\n${content}`,
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: `_생성 시간: ${new Date().toLocaleString('ko-KR')} | 요청 ID: ${requestId.substring(0, 8)}_`,
            },
          ],
        },
      ],
    };

    try {
      const response = await fetch(responseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(slackMessage),
        signal: AbortSignal.timeout(10000), // 10초 타임아웃
      });

      if (!response.ok) {
        throw ErrorFactory.createExternalApiError(
          'Slack',
          `Webhook failed: ${response.status} ${response.statusText}`,
          '결과 전송에 실패했습니다.',
          { 
            requestId, 
            webhookUrl: responseUrl,
            statusCode: response.status,
            statusText: response.statusText 
          }
        );
      }

      logger.info('Slack 웹훅 전송 성공', {
        requestId,
        action: 'slack_webhook_success',
        webhookUrl: responseUrl.substring(0, 50) + '...',
        contentLength: content.length,
      });

    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      
      throw ErrorFactory.createExternalApiError(
        'Slack',
        error instanceof Error ? error.message : String(error),
        '네트워크 문제로 결과 전송에 실패했습니다.',
        { 
          requestId, 
          webhookUrl: responseUrl,
          originalError: String(error) 
        }
      );
    }
  }

  /**
   * 강화된 에러 처리를 위한 메서드
   */
  private handleTaskProcessingError(
    error: unknown,
    requestId: string,
    req: Request,
    res: Response,
    startTime: number
  ): void {
    const duration = Date.now() - startTime;
    const requestData = req.body as QueueTaskRequest;

    // 에러 로깅 및 모니터링
    if (error instanceof AppError) {
      ErrorHandler.logAndMonitor(error, {
        requestId,
        userId: requestData?.userId,
        workspaceId: requestData?.workspaceId,
        action: 'task_processing_error',
        duration,
      });

      // Vertex AI 실패 모니터링
      if (error.type.includes('VERTEX_AI')) {
        monitoringService.logVertexAIPerformance(
          requestId,
          'unknown',
          requestData?.prompt?.length || 0,
          0,
          { inputTokens: 0, outputTokens: 0, totalTokens: 0, model: 'unknown', timestamp: new Date() },
          duration,
          false
        );
      }

      res.status(error.statusCode).json(ErrorHandler.toUserResponse(error, requestId));
    } else {
      // 예상치 못한 에러
      const internalError = ErrorFactory.createInternalError(
        `Unexpected error in task processing: ${error instanceof Error ? error.message : String(error)}`,
        ErrorMessages.INTERNAL_SERVER_ERROR,
        {
          requestId,
          userId: requestData?.userId,
          workspaceId: requestData?.workspaceId,
          action: 'unexpected_task_error',
          duration,
          originalError: String(error),
        }
      );

      ErrorHandler.logAndMonitor(internalError);
      res.status(500).json(ErrorHandler.toUserResponse(internalError, requestId));
    }
  }

  async disconnect(): Promise<void> {
    await this.vertexAIService.disconnect();
  }
}