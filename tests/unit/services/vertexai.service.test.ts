import { VertexAIService } from '../../../src/services/vertexai.service';
import {
  VertexAIConfig,
  AIGenerationRequest,
  AIResponse,
  VertexAIException,
  ValidationException,
} from '../../../src/models/vertexai.model';
import { VertexAI } from '@google-cloud/vertexai';

// Mock VertexAI
jest.mock('@google-cloud/vertexai');

describe('VertexAIService', () => {
  let vertexAIService: VertexAIService;
  let mockVertexAI: jest.Mocked<VertexAI>;
  let mockModel: any;

  const mockConfig: VertexAIConfig = {
    projectId: 'test-project',
    location: 'us-central1',
    modelId: 'gemini-2.5-flash-001',
    generationConfig: {
      maxOutputTokens: 2048,
      temperature: 0.7,
      topP: 0.8,
      topK: 40,
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock model
    mockModel = {
      generateContent: jest.fn(),
    };

    // Mock VertexAI instance
    mockVertexAI = {
      preview: {
        getGenerativeModel: jest.fn().mockReturnValue(mockModel),
      },
    } as any;

    (VertexAI as jest.MockedClass<typeof VertexAI>).mockImplementation(
      () => mockVertexAI
    );

    vertexAIService = new VertexAIService(mockConfig);
  });

  describe('Constructor and Configuration', () => {
    it('should create service with default configuration when no config provided', () => {
      // Mock environment variables
      process.env.GCP_PROJECT_ID = 'env-project';
      process.env.GCP_LOCATION = 'env-location';
      process.env.VERTEX_AI_MODEL_ID = 'env-model';

      const serviceWithDefaults = new VertexAIService();
      
      expect(VertexAI).toHaveBeenCalledWith({
        project: 'env-project',
        location: 'env-location',
      });
    });

    it('should use provided configuration over defaults', () => {
      expect(VertexAI).toHaveBeenCalledWith({
        project: 'test-project',
        location: 'us-central1',
      });
    });
  });

  describe('generateResponse', () => {
    const validRequest: AIGenerationRequest = {
      prompt: 'Write a summary',
      data: 'Some data to summarize',
      requestId: 'req-123',
      userId: 'user-123',
      contextMetadata: {
        channelId: 'C123456',
        workspaceId: 'W123456',
        userName: 'testuser',
        timestamp: new Date(),
      },
    };

    it('should fail when prompt is empty', async () => {
      const requestWithEmptyPrompt = {
        ...validRequest,
        prompt: '',
      };

      await expect(
        vertexAIService.generateResponse(requestWithEmptyPrompt)
      ).rejects.toThrow(ValidationException);
      await expect(
        vertexAIService.generateResponse(requestWithEmptyPrompt)
      ).rejects.toThrow('프롬프트가 비어있습니다');
    });

    it('should fail when prompt exceeds 10,000 characters', async () => {
      const longPrompt = 'a'.repeat(10001);
      const requestWithLongPrompt = {
        ...validRequest,
        prompt: longPrompt,
      };

      await expect(
        vertexAIService.generateResponse(requestWithLongPrompt)
      ).rejects.toThrow(ValidationException);
      await expect(
        vertexAIService.generateResponse(requestWithLongPrompt)
      ).rejects.toThrow('프롬프트가 너무 깁니다');
    });

    it('should successfully generate response with valid request', async () => {
      // Mock successful API response
      const mockApiResponse = {
        response: {
          candidates: [
            {
              content: {
                parts: [{ text: 'Generated AI response' }],
              },
              finishReason: 'STOP',
              safetyRatings: [
                {
                  category: 'HARM_CATEGORY_HARASSMENT',
                  probability: 'NEGLIGIBLE',
                },
              ],
            },
          ],
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 5,
            totalTokenCount: 15,
          },
        },
      };

      mockModel.generateContent.mockResolvedValue(mockApiResponse);

      const result = await vertexAIService.generateResponse(validRequest);

      expect(result).toEqual({
        content: 'Generated AI response',
        tokenUsage: {
          inputTokens: 10,
          outputTokens: 5,
          totalTokens: 15,
        },
        processingTimeMs: expect.any(Number),
        requestId: 'req-123',
        metadata: {
          modelId: 'gemini-2.5-flash-001',
          finishReason: 'STOP',
          safetyRatings: [
            {
              category: 'HARM_CATEGORY_HARASSMENT',
              probability: 'NEGLIGIBLE',
            },
          ],
          generatedAt: expect.any(Date),
        },
      });

      expect(mockModel.generateContent).toHaveBeenCalledWith(
        expect.stringContaining('Write a summary')
      );
    });

    it('should build correct prompt with prompt and data', async () => {
      mockModel.generateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: { parts: [{ text: 'Response' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        },
      });

      await vertexAIService.generateResponse(validRequest);

      const fullPrompt = mockModel.generateContent.mock.calls[0][0];

      expect(fullPrompt).toContain('Write a summary');
      expect(fullPrompt).toContain('Some data to summarize');
    });

    it('should handle prompt without data', async () => {
      const requestWithoutData = {
        ...validRequest,
        data: undefined,
      };

      mockModel.generateContent.mockResolvedValue({
        response: {
          candidates: [
            {
              content: { parts: [{ text: 'Response' }] },
              finishReason: 'STOP',
            },
          ],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        },
      });

      await vertexAIService.generateResponse(requestWithoutData);

      const fullPrompt = mockModel.generateContent.mock.calls[0][0];

      expect(fullPrompt).toContain('Write a summary');
      expect(fullPrompt).not.toContain('데이터:');
    });

    it('should throw VertexAIException when API call fails', async () => {
      const apiError = new Error('API Error');
      mockModel.generateContent.mockRejectedValue(apiError);

      await expect(
        vertexAIService.generateResponse(validRequest)
      ).rejects.toThrow(VertexAIException);
      await expect(
        vertexAIService.generateResponse(validRequest)
      ).rejects.toThrow('AI 모델 처리 중 오류가 발생했습니다');
    });

    it('should handle missing candidates in API response', async () => {
      const mockApiResponseWithoutCandidates = {
        response: {
          candidates: [],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 0,
            totalTokenCount: 5,
          },
        },
      };

      mockModel.generateContent.mockResolvedValue(
        mockApiResponseWithoutCandidates
      );

      await expect(
        vertexAIService.generateResponse(validRequest)
      ).rejects.toThrow(VertexAIException);
      await expect(
        vertexAIService.generateResponse(validRequest)
      ).rejects.toThrow('AI 응답을 생성할 수 없습니다');
    });

    it('should measure processing time accurately', async () => {
      mockModel.generateContent.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              response: {
                candidates: [
                  {
                    content: { parts: [{ text: 'Response' }] },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 5,
                  candidatesTokenCount: 3,
                  totalTokenCount: 8,
                },
              },
            });
          }, 100); // 100ms delay
        });
      });

      const result = await vertexAIService.generateResponse(validRequest);

      expect(result.processingTimeMs).toBeGreaterThanOrEqual(100);
      expect(result.processingTimeMs).toBeLessThan(200);
    });

    it('should handle rate limiting errors appropriately', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      (rateLimitError as any).code = 429;
      mockModel.generateContent.mockRejectedValue(rateLimitError);

      await expect(
        vertexAIService.generateResponse(validRequest)
      ).rejects.toThrow(VertexAIException);
    });
  });

  describe('Error Handling and Logging', () => {
    it('should log errors appropriately', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      const apiError = new Error('API Error');
      mockModel.generateContent.mockRejectedValue(apiError);

      await expect(
        vertexAIService.generateResponse({
          prompt: 'test prompt',
        })
      ).rejects.toThrow();

      // Verify error was logged (implementation will add proper logging)
      expect(consoleSpy).toHaveBeenCalled();
      
      consoleSpy.mockRestore();
    });
  });

  describe('Configuration Validation', () => {
    it('should validate configuration parameters', () => {
      const invalidConfig = {
        ...mockConfig,
        generationConfig: {
          ...mockConfig.generationConfig,
          temperature: 2.0, // Invalid: should be 0-1
        },
      };

      expect(() => {
        new VertexAIService(invalidConfig);
      }).toThrow(ValidationException);
    });

    it('should validate maxOutputTokens is positive', () => {
      const invalidConfig = {
        ...mockConfig,
        generationConfig: {
          ...mockConfig.generationConfig,
          maxOutputTokens: -1,
        },
      };

      expect(() => {
        new VertexAIService(invalidConfig);
      }).toThrow(ValidationException);
    });
  });
});