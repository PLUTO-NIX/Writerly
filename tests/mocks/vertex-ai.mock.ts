/**
 * Vertex AI 서비스 모킹
 * 테스트 픽스처를 사용한 현실적인 모킹
 */

import { jest } from '@jest/globals';
import { AIGenerationRequest, AIGenerationResponse } from '../../src/models/vertexai.model';
import {
  vertexAISuccessResponse,
  vertexAIShortResponse,
  vertexAILongResponse,
  vertexAITranslationResponse,
  vertexAISafetyBlockedResponse,
  vertexAIErrorResponses,
  vertexAIResponsesByScenario,
  createVertexAIResponse,
  createVertexAIError
} from '../fixtures/vertex-ai-responses';

// 모킹 상태 관리
interface MockState {
  shouldFail: boolean;
  failureType: keyof typeof vertexAIErrorResponses | null;
  customResponse: AIGenerationResponse | null;
  responseDelay: number;
  callCount: number;
  lastRequest: AIGenerationRequest | null;
}

class VertexAIMockService {
  private state: MockState = {
    shouldFail: false,
    failureType: null,
    customResponse: null,
    responseDelay: 0,
    callCount: 0,
    lastRequest: null
  };

  // 성공 응답 설정
  mockSuccess(response?: Partial<AIGenerationResponse>): void {
    this.state.shouldFail = false;
    this.state.failureType = null;
    this.state.customResponse = response ? createVertexAIResponse(response) : null;
  }

  // 실패 응답 설정
  mockFailure(
    failureType: keyof typeof vertexAIErrorResponses,
    customMessage?: string
  ): void {
    this.state.shouldFail = true;
    this.state.failureType = failureType;
    this.state.customResponse = null;
  }

  // 응답 지연 설정
  mockDelay(delayMs: number): void {
    this.state.responseDelay = delayMs;
  }

  // 상태 초기화
  reset(): void {
    this.state = {
      shouldFail: false,
      failureType: null,
      customResponse: null,
      responseDelay: 0,
      callCount: 0,
      lastRequest: null
    };
  }

  // 호출 통계
  getCallCount(): number {
    return this.state.callCount;
  }

  getLastRequest(): AIGenerationRequest | null {
    return this.state.lastRequest;
  }

  // 실제 모킹 구현
  async generateResponse(request: AIGenerationRequest): Promise<AIGenerationResponse> {
    this.state.callCount++;
    this.state.lastRequest = { ...request };

    // 지연 시뮬레이션
    if (this.state.responseDelay > 0) {
      await new Promise(resolve => setTimeout(resolve, this.state.responseDelay));
    }

    // 실패 시뮬레이션
    if (this.state.shouldFail && this.state.failureType) {
      const error = createVertexAIError(this.state.failureType);
      throw new Error(JSON.stringify(error));
    }

    // 커스텀 응답이 있으면 사용
    if (this.state.customResponse) {
      return {
        ...this.state.customResponse,
        metadata: {
          ...this.state.customResponse.metadata,
          requestId: request.requestId,
          timestamp: new Date()
        }
      };
    }

    // 프롬프트 내용에 따른 응답 선택
    const response = this.selectResponseByPrompt(request.prompt);
    
    return {
      ...response,
      metadata: {
        ...response.metadata,
        requestId: request.requestId,
        timestamp: new Date(),
        processingTimeMs: Math.random() * 3000 + 1000 // 1-4초 랜덤
      }
    };
  }

  // 프롬프트 내용에 따른 지능적 응답 선택
  private selectResponseByPrompt(prompt: string): AIGenerationResponse {
    const lowerPrompt = prompt.toLowerCase();

    // 번역 요청
    if (lowerPrompt.includes('번역') || lowerPrompt.includes('translate')) {
      return vertexAITranslationResponse;
    }

    // 요약 요청
    if (lowerPrompt.includes('요약') || lowerPrompt.includes('summarize')) {
      return vertexAISuccessResponse;
    }

    // 분석 요청
    if (lowerPrompt.includes('분석') || lowerPrompt.includes('analyze')) {
      return vertexAILongResponse;
    }

    // 짧은 질문
    if (prompt.length < 50) {
      return vertexAIShortResponse;
    }

    // 안전성 위반 내용 감지 (테스트용)
    if (lowerPrompt.includes('harmful') || lowerPrompt.includes('dangerous')) {
      return vertexAISafetyBlockedResponse;
    }

    // 기본 응답
    return vertexAISuccessResponse;
  }

  // 연결 해제 (실제 서비스에서는 정리 작업)
  async disconnect(): Promise<void> {
    // 모킹에서는 아무 작업 안 함
    return Promise.resolve();
  }
}

// 전역 모킹 인스턴스
export const mockVertexAIService = new VertexAIMockService();

// Jest mock 설정
export const createVertexAIMock = () => {
  const mockGenerateResponse = jest.fn<
    (request: AIGenerationRequest) => Promise<AIGenerationResponse>
  >().mockImplementation((request) => mockVertexAIService.generateResponse(request));

  const mockDisconnect = jest.fn().mockImplementation(() => 
    mockVertexAIService.disconnect()
  );

  return {
    generateResponse: mockGenerateResponse,
    disconnect: mockDisconnect,
    // 테스트 헬퍼 메서드들
    mockSuccess: (response?: Partial<AIGenerationResponse>) => 
      mockVertexAIService.mockSuccess(response),
    mockFailure: (
      failureType: keyof typeof vertexAIErrorResponses,
      customMessage?: string
    ) => mockVertexAIService.mockFailure(failureType, customMessage),
    mockDelay: (delayMs: number) => mockVertexAIService.mockDelay(delayMs),
    reset: () => mockVertexAIService.reset(),
    getCallCount: () => mockVertexAIService.getCallCount(),
    getLastRequest: () => mockVertexAIService.getLastRequest()
  };
};

// 시나리오별 사전 설정된 모킹
export const vertexAIScenarios = {
  // 정상 작동
  normal: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockSuccess();
  },

  // 느린 응답
  slow: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockSuccess();
    mockVertexAIService.mockDelay(5000); // 5초 지연
  },

  // 할당량 초과
  quotaExceeded: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockFailure('quotaExceeded');
  },

  // 서비스 불가
  serviceUnavailable: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockFailure('serviceUnavailable');
  },

  // 인증 오류
  authError: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockFailure('authenticationError');
  },

  // 입력 오류
  invalidInput: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockFailure('invalidInput');
  },

  // 안전성 필터
  safetyBlocked: () => {
    mockVertexAIService.reset();
    mockVertexAIService.mockSuccess(vertexAISafetyBlockedResponse);
  },

  // 커스텀 응답
  custom: (response: Partial<AIGenerationResponse>) => {
    mockVertexAIService.reset();
    mockVertexAIService.mockSuccess(response);
  }
};

// VertexAI 클래스 모킹을 위한 팩토리
export const mockVertexAIClass = () => {
  return jest.fn().mockImplementation(() => createVertexAIMock());
};

// 전역 모킹 설정 (jest.mock에서 사용)
export const setupVertexAIMocking = () => {
  // @google-cloud/vertexai 모킹
  jest.doMock('@google-cloud/vertexai', () => ({
    VertexAI: mockVertexAIClass(),
    // 다른 필요한 exports가 있다면 여기에 추가
  }));
};

// 성능 테스트용 응답 시간 시뮬레이션
export const performanceScenarios = {
  fast: () => mockVertexAIService.mockDelay(500),      // 0.5초
  normal: () => mockVertexAIService.mockDelay(2000),   // 2초
  slow: () => mockVertexAIService.mockDelay(8000),     // 8초
  timeout: () => mockVertexAIService.mockDelay(31000), // 31초 (타임아웃)
};

// 토큰 사용량 테스트용 응답
export const tokenUsageScenarios = {
  small: () => mockVertexAIService.mockSuccess({
    tokenUsage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 }
  }),
  medium: () => mockVertexAIService.mockSuccess({
    tokenUsage: { inputTokens: 100, outputTokens: 200, totalTokens: 300 }
  }),
  large: () => mockVertexAIService.mockSuccess({
    tokenUsage: { inputTokens: 1000, outputTokens: 2000, totalTokens: 3000 }
  }),
  excessive: () => mockVertexAIService.mockSuccess({
    tokenUsage: { inputTokens: 5000, outputTokens: 5000, totalTokens: 10000 }
  })
};

// 연속 실패 테스트용 시나리오
export const reliabilityScenarios = {
  // 처음 2번 실패, 3번째 성공
  eventualSuccess: () => {
    let callCount = 0;
    const originalGenerateResponse = mockVertexAIService.generateResponse.bind(mockVertexAIService);
    
    mockVertexAIService.generateResponse = async (request: AIGenerationRequest) => {
      callCount++;
      if (callCount <= 2) {
        throw new Error(JSON.stringify(createVertexAIError('serviceUnavailable')));
      }
      return originalGenerateResponse(request);
    };
  },

  // 간헐적 실패 (30% 확률)
  intermittentFailure: () => {
    const originalGenerateResponse = mockVertexAIService.generateResponse.bind(mockVertexAIService);
    
    mockVertexAIService.generateResponse = async (request: AIGenerationRequest) => {
      if (Math.random() < 0.3) {
        throw new Error(JSON.stringify(createVertexAIError('serviceUnavailable')));
      }
      return originalGenerateResponse(request);
    };
  }
};