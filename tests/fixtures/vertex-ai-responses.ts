/**
 * Vertex AI API 응답 테스트 픽스처
 * 실제 Vertex AI API 응답을 기반으로 한 Mock 데이터
 */

import { AIGenerationResponse, TokenUsage } from '../../src/models/vertexai.model';

// 표준 성공 응답
export const vertexAISuccessResponse: AIGenerationResponse = {
  content: `다음은 요청하신 내용에 대한 AI 응답입니다:

**요약 결과:**

주요 내용을 분석한 결과, 다음과 같은 핵심 포인트들을 확인할 수 있습니다:
- 첫 번째 주요 내용
- 두 번째 중요한 사항  
- 세 번째 결론

이러한 내용들을 종합해볼 때, 전반적으로 긍정적인 방향성을 보이고 있습니다.`,
  
  tokenUsage: {
    inputTokens: 42,
    outputTokens: 156,
    totalTokens: 198
  },
  
  metadata: {
    modelId: 'gemini-2.5-flash',
    timestamp: new Date('2025-01-19T10:30:00Z'),
    requestId: 'req_12345',
    processingTimeMs: 2340,
    safety: {
      blocked: false,
      categories: [],
      reason: null
    }
  }
};

// 짧은 응답
export const vertexAIShortResponse: AIGenerationResponse = {
  content: '네, 알겠습니다. 요청하신 작업을 완료했습니다.',
  
  tokenUsage: {
    inputTokens: 15,
    outputTokens: 23,
    totalTokens: 38
  },
  
  metadata: {
    modelId: 'gemini-2.5-flash',
    timestamp: new Date('2025-01-19T10:30:00Z'),
    requestId: 'req_12346',
    processingTimeMs: 890,
    safety: {
      blocked: false,
      categories: [],
      reason: null
    }
  }
};

// 긴 응답 (마크다운 포함)
export const vertexAILongResponse: AIGenerationResponse = {
  content: `# 상세 분석 리포트

## 📊 데이터 분석 결과

### 1. 주요 지표 분석

**핵심 메트릭스:**
- 사용자 참여도: 85.3% ↗️
- 완료율: 92.1% ↗️
- 만족도 점수: 4.7/5.0 ⭐

### 2. 트렌드 분석

#### 📈 성장 지표
1. **월별 성장률**: 12.4% 증가
2. **사용자 활성도**: 주간 대비 8.7% 향상
3. **기능 활용도**: 신규 기능 도입률 67%

#### 🔍 세부 분석
- **지역별 분포**: 서울(45%), 부산(23%), 기타(32%)
- **연령대별 사용패턴**: 
  - 20-30대: 활발한 사용 (68%)
  - 40-50대: 안정적 사용 (28%)
  - 기타: 탐색 단계 (4%)

### 3. 개선 권장사항

\`\`\`
우선순위 1: UX 개선
우선순위 2: 성능 최적화  
우선순위 3: 신규 기능 추가
\`\`\`

**결론**: 전반적으로 양호한 성과를 보이고 있으며, 지속적인 개선을 통해 더 나은 결과를 기대할 수 있습니다.

---
*분석 완료 시간: ${new Date().toLocaleString('ko-KR')}*`,
  
  tokenUsage: {
    inputTokens: 234,
    outputTokens: 445,
    totalTokens: 679
  },
  
  metadata: {
    modelId: 'gemini-2.5-flash',
    timestamp: new Date('2025-01-19T10:30:00Z'),
    requestId: 'req_12347',
    processingTimeMs: 4560,
    safety: {
      blocked: false,
      categories: [],
      reason: null
    }
  }
};

// 번역 응답 예시
export const vertexAITranslationResponse: AIGenerationResponse = {
  content: `**Translation Result:**

Original Text: "Hello, how are you today?"
Korean Translation: "안녕하세요, 오늘 기분은 어떠세요?"

**Additional Notes:**
- This is a casual greeting commonly used in both languages
- The tone is friendly and informal`,
  
  tokenUsage: {
    inputTokens: 28,
    outputTokens: 67,
    totalTokens: 95
  },
  
  metadata: {
    modelId: 'gemini-2.5-flash',
    timestamp: new Date('2025-01-19T10:30:00Z'),
    requestId: 'req_12348',
    processingTimeMs: 1240,
    safety: {
      blocked: false,
      categories: [],
      reason: null
    }
  }
};

// 안전성 필터에 걸린 응답
export const vertexAISafetyBlockedResponse: AIGenerationResponse = {
  content: '죄송합니다. 요청하신 내용은 안전 정책에 위배되어 응답을 제공할 수 없습니다. 다른 주제로 도움이 필요하시면 언제든 말씀해 주세요.',
  
  tokenUsage: {
    inputTokens: 45,
    outputTokens: 42,
    totalTokens: 87
  },
  
  metadata: {
    modelId: 'gemini-2.5-flash',
    timestamp: new Date('2025-01-19T10:30:00Z'),
    requestId: 'req_12349',
    processingTimeMs: 560,
    safety: {
      blocked: true,
      categories: ['HARM_CATEGORY_HARASSMENT'],
      reason: 'Content blocked due to safety policy violation'
    }
  }
};

// 토큰 사용량 예시들
export const tokenUsageExamples: TokenUsage[] = [
  { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
  { inputTokens: 50, outputTokens: 100, totalTokens: 150 },
  { inputTokens: 200, outputTokens: 300, totalTokens: 500 },
  { inputTokens: 1000, outputTokens: 1500, totalTokens: 2500 }
];

// 에러 응답들
export const vertexAIErrorResponses = {
  quotaExceeded: {
    error: {
      code: 429,
      message: 'Quota exceeded for requests per minute per region.',
      status: 'RESOURCE_EXHAUSTED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'RATE_LIMIT_EXCEEDED',
          domain: 'googleapis.com',
          metadata: {
            quota_metric: 'aiplatform.googleapis.com/generate_content_requests',
            quota_location: 'us-central1'
          }
        }
      ]
    }
  },
  
  invalidInput: {
    error: {
      code: 400,
      message: 'Request contains an invalid argument.',
      status: 'INVALID_ARGUMENT',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.BadRequest',
          fieldViolations: [
            {
              field: 'contents',
              description: 'Input text is too long'
            }
          ]
        }
      ]
    }
  },
  
  serviceUnavailable: {
    error: {
      code: 503,
      message: 'The service is currently unavailable.',
      status: 'UNAVAILABLE',
      details: []
    }
  },
  
  authenticationError: {
    error: {
      code: 401,
      message: 'Request had invalid authentication credentials.',
      status: 'UNAUTHENTICATED',
      details: [
        {
          '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
          reason: 'ACCESS_TOKEN_EXPIRED',
          domain: 'googleapis.com'
        }
      ]
    }
  }
};

// 실제 Vertex AI API 원시 응답 형식 (Google AI Platform 응답)
export const rawVertexAIResponse = {
  candidates: [
    {
      content: {
        parts: [
          {
            text: "다음은 요청하신 내용에 대한 AI 응답입니다:\n\n**요약 결과:**\n\n주요 내용을 분석한 결과, 다음과 같은 핵심 포인트들을 확인할 수 있습니다:\n- 첫 번째 주요 내용\n- 두 번째 중요한 사항\n- 세 번째 결론\n\n이러한 내용들을 종합해볼 때, 전반적으로 긍정적인 방향성을 보이고 있습니다."
          }
        ],
        role: "model"
      },
      finishReason: "STOP",
      index: 0,
      safetyRatings: [
        {
          category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HATE_SPEECH",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_HARASSMENT",
          probability: "NEGLIGIBLE"
        },
        {
          category: "HARM_CATEGORY_DANGEROUS_CONTENT",
          probability: "NEGLIGIBLE"
        }
      ]
    }
  ],
  usageMetadata: {
    promptTokenCount: 42,
    candidatesTokenCount: 156,
    totalTokenCount: 198
  }
};

// 다양한 프롬프트 시나리오별 응답
export const vertexAIResponsesByScenario = {
  summarization: vertexAISuccessResponse,
  translation: vertexAITranslationResponse,
  analysis: vertexAILongResponse,
  simple_question: vertexAIShortResponse,
  safety_violation: vertexAISafetyBlockedResponse
};

// 성능 테스트용 다양한 크기의 응답
export const vertexAIResponsesBySizeCategory = {
  tiny: { ...vertexAIShortResponse, tokenUsage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 } },
  small: { ...vertexAIShortResponse, tokenUsage: { inputTokens: 25, outputTokens: 50, totalTokens: 75 } },
  medium: vertexAISuccessResponse,
  large: vertexAILongResponse,
  xlarge: {
    ...vertexAILongResponse,
    content: vertexAILongResponse.content.repeat(3),
    tokenUsage: { inputTokens: 500, outputTokens: 1200, totalTokens: 1700 }
  }
};

// 테스트 헬퍼: 커스텀 응답 생성기
export function createVertexAIResponse(
  overrides: Partial<AIGenerationResponse> = {}
): AIGenerationResponse {
  return {
    ...vertexAISuccessResponse,
    ...overrides,
    metadata: {
      ...vertexAISuccessResponse.metadata,
      ...overrides.metadata,
      timestamp: new Date(),
      requestId: `req_${Date.now()}`
    }
  };
}

// 테스트 헬퍼: 에러 응답 생성기
export function createVertexAIError(
  errorType: keyof typeof vertexAIErrorResponses,
  customMessage?: string
): any {
  const baseError = vertexAIErrorResponses[errorType];
  return {
    ...baseError,
    ...(customMessage && {
      error: {
        ...baseError.error,
        message: customMessage
      }
    })
  };
}