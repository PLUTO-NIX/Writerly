import { VertexAI, HarmCategory, HarmBlockThreshold } from '@google-cloud/vertexai';
import { logger } from '../utils/logger';
import {
  VertexAIConfig,
  AIGenerationRequest,
  AIResponse,
  VertexAIException,
  ValidationException,
  ProcessingTimer,
  GenerationConfig,
  TokenUsage,
  ResponseMetadata,
} from '../models/vertexai.model';

export class VertexAIService {
  private vertexAI: VertexAI;
  private readonly config: VertexAIConfig;

  constructor(userConfig?: Partial<VertexAIConfig>) {
    this.config = this.createConfig(userConfig);
    this.validateConfig(this.config);
    this.vertexAI = this.initializeVertexAI();
  }

  async generateResponse(request: AIGenerationRequest): Promise<AIResponse> {
    this.validateRequest(request);

    const processingTimer = new ProcessingTimer();

    try {
      const fullPrompt = this.buildPrompt(request);
      const model = this.createModel();
      const result = await model.generateContent(fullPrompt);

      return this.buildResponse(result, processingTimer.getElapsed(), request);
    } catch (error) {
      this.logError(error, request.prompt);
      
      // If it's already a VertexAIException, re-throw it as is
      if (error instanceof VertexAIException) {
        throw error;
      }
      
      throw new VertexAIException(
        'AI 모델 처리 중 오류가 발생했습니다.',
        error instanceof Error ? error : new Error(String(error))
      );
    }
  }

  // Clean Code: Parameter Object pattern으로 설정 생성
  private createConfig(userConfig?: Partial<VertexAIConfig>): VertexAIConfig {
    return {
      projectId:
        userConfig?.projectId ||
        process.env.GCP_PROJECT_ID ||
        'default-project',
      location:
        userConfig?.location || process.env.GCP_LOCATION || 'us-central1',
      modelId:
        userConfig?.modelId ||
        process.env.VERTEX_AI_MODEL_ID ||
        'gemini-2.5-flash-001',
      generationConfig:
        userConfig?.generationConfig || this.getDefaultGenerationConfig(),
    };
  }

  // Clean Code: 작은 함수로 분해
  private getDefaultGenerationConfig(): GenerationConfig {
    return {
      maxOutputTokens: 2048,
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    };
  }

  private validateConfig(config: VertexAIConfig): void {
    const { generationConfig } = config;

    if (
      generationConfig.temperature < 0 ||
      generationConfig.temperature > 1
    ) {
      throw new ValidationException(
        'Temperature must be between 0 and 1'
      );
    }

    if (generationConfig.maxOutputTokens <= 0) {
      throw new ValidationException(
        'MaxOutputTokens must be positive'
      );
    }

    if (generationConfig.topP < 0 || generationConfig.topP > 1) {
      throw new ValidationException('TopP must be between 0 and 1');
    }

    if (generationConfig.topK <= 0) {
      throw new ValidationException('TopK must be positive');
    }
  }

  private initializeVertexAI(): VertexAI {
    return new VertexAI({
      project: this.config.projectId,
      location: this.config.location,
    });
  }

  // Clean Code: 입력 검증을 별도 함수로 분리
  private validateRequest(request: AIGenerationRequest): void {
    if (!request.prompt || request.prompt.trim().length === 0) {
      throw new ValidationException('프롬프트가 비어있습니다.');
    }

    const MAX_PROMPT_LENGTH = 10000;
    if (request.prompt.length > MAX_PROMPT_LENGTH) {
      throw new ValidationException(
        `프롬프트가 너무 깁니다. 최대 ${MAX_PROMPT_LENGTH}자까지 입력 가능합니다.`
      );
    }
  }

  // Clean Code: 프롬프트 빌드 로직 분리
  private buildPrompt(request: AIGenerationRequest): string {
    let fullPrompt = `프롬프트: ${request.prompt}`;

    if (request.data && request.data.trim().length > 0) {
      fullPrompt += `\n\n데이터: ${request.data}`;
    }

    return fullPrompt;
  }

  private createModel() {
    return this.vertexAI.preview.getGenerativeModel({
      model: this.config.modelId,
      generationConfig: this.config.generationConfig,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE,
        },
      ],
    });
  }

  // Clean Code: 응답 생성 로직 분리
  private buildResponse(
    result: any,
    processingTimeMs: number,
    request: AIGenerationRequest
  ): AIResponse {
    const response = result.response;

    if (!response.candidates || response.candidates.length === 0) {
      throw new VertexAIException(
        'AI 응답을 생성할 수 없습니다. 다시 시도해주세요.'
      );
    }

    const candidate = response.candidates[0];
    const content = candidate.content.parts
      .map((part: any) => part.text)
      .join('');

    const tokenUsage: TokenUsage = {
      inputTokens: response.usageMetadata?.promptTokenCount || 0,
      outputTokens: response.usageMetadata?.candidatesTokenCount || 0,
      totalTokens: response.usageMetadata?.totalTokenCount || 0,
    };

    const metadata: ResponseMetadata = {
      modelId: this.config.modelId,
      finishReason: candidate.finishReason || 'UNKNOWN',
      safetyRatings: candidate.safetyRatings || [],
      generatedAt: new Date(),
    };

    return {
      content,
      tokenUsage,
      processingTimeMs,
      requestId: request.requestId,
      metadata,
    };
  }

  // Clean Code: 에러 로깅 분리
  private logError(error: unknown, prompt: string): void {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorCode = (error as any)?.code;

    logger.error('Vertex AI 호출 실패 - Fail Fast 정책', {
      error: errorMessage,
      errorCode,
      prompt: prompt.substring(0, 100), // Only log first 100 chars for privacy
      timestamp: new Date().toISOString(),
      service: 'VertexAIService',
    });
  }

  // Utility method for testing and monitoring
  getConfig(): VertexAIConfig {
    return { ...this.config };
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    // Vertex AI SDK doesn't require explicit disconnection
    // but we can log the shutdown for monitoring
    logger.info('VertexAI Service disconnected', {
      timestamp: new Date().toISOString(),
    });
  }
}