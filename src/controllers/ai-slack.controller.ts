import express, { Request, Response } from 'express';
import { VertexAIService } from '../services/vertexai.service';
import { AIGenerationRequest } from '../models/vertexai.model';
import { logger } from '../utils/logger';

export class AISlackController {
  private vertexAIService: VertexAIService;

  constructor() {
    this.vertexAIService = new VertexAIService({
      projectId: process.env.GCP_PROJECT_ID || 'writerly-01',
      location: process.env.GCP_LOCATION || 'us-central1',
      modelId: 'gemini-2.5-flash-002',
      generationConfig: {
        maxOutputTokens: 4000,
        temperature: 0.7,
        topP: 0.8,
        topK: 40,
      }
    });
  }

  /**
   * Slack 슬래시 명령어 처리
   * /ai [요청] 형태로 들어오는 명령어를 처리
   */
  async handleSlackCommand(req: Request, res: Response): Promise<void> {
    try {
      const { text, user_id, channel_id, team_id } = req.body;

      // 즉시 응답 (Fire-and-Forget 패턴)
      res.json({
        response_type: 'ephemeral',
        text: 'AI가 요청을 처리하고 있습니다... 잠시만 기다려주세요!'
      });

      // 비동기로 AI 처리 시작
      this.processAIRequest(text, user_id, channel_id, team_id);

    } catch (error) {
      logger.error('Slack command processing failed', { error, body: req.body });
      
      res.json({
        response_type: 'ephemeral',
        text: '⚠️ 요청 처리 중 오류가 발생했습니다. 다시 시도해주세요.'
      });
    }
  }

  /**
   * AI 요청 비동기 처리 (Fire-and-Forget)
   */
  private async processAIRequest(
    text: string, 
    userId: string, 
    channelId: string, 
    teamId: string
  ): Promise<void> {
    try {
      // 입력 검증
      if (!text || text.trim().length === 0) {
        await this.sendDelayedResponse(channelId, '❌ 요청 내용을 입력해주세요. 예: `/ai 이메일 작성 도와줘`');
        return;
      }

      // AI 요청 생성
      const aiRequest: AIGenerationRequest = {
        prompt: this.enhancePrompt(text),
        userId,
        requestId: `${userId}-${Date.now()}`,
        contextMetadata: {
          channelId,
          workspaceId: teamId,
          userName: userId,
          timestamp: new Date()
        }
      };

      logger.info('AI request started', { 
        userId, 
        channelId, 
        promptLength: text.length 
      });

      // Vertex AI 호출
      const aiResponse = await this.vertexAIService.generateResponse(aiRequest);

      // Slack에 결과 전송
      await this.sendDelayedResponse(channelId, this.formatAIResponse(aiResponse.content, aiResponse));

      logger.info('AI response completed', {
        userId,
        channelId,
        processingTime: aiResponse.processingTimeMs,
        tokenUsage: aiResponse.tokenUsage
      });

    } catch (error) {
      logger.error('AI processing failed', { error, userId, channelId });
      
      await this.sendDelayedResponse(
        channelId, 
        '❌ AI 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      );
    }
  }

  /**
   * 프롬프트를 한국어 사용자에게 최적화
   */
  private enhancePrompt(userInput: string): string {
    const systemPrompt = `당신은 Writerly AI입니다. 한국어로 친근하고 전문적인 AI 어시스턴트입니다.

사용자의 요청에 대해:
1. 명확하고 도움이 되는 답변을 제공하세요
2. 한국어로 자연스럽게 응답하세요  
3. 필요시 구체적인 예시나 단계를 포함하세요
4. 전문적이면서도 친근한 톤을 유지하세요

사용자 요청: ${userInput}

답변:`;

    return systemPrompt;
  }

  /**
   * AI 응답을 Slack에 맞게 포맷팅
   */
  private formatAIResponse(content: string, response: any): string {
    const header = '🤖 **Writerly AI 응답**\n\n';
    const footer = `\n\n---\n💡 처리 시간: ${response.processingTimeMs}ms | 토큰: ${response.tokenUsage.totalTokens}`;
    
    return header + content + footer;
  }

  /**
   * Slack으로 지연된 응답 전송 (실제 구현에서는 Slack Web API 사용)
   */
  private async sendDelayedResponse(channelId: string, message: string): Promise<void> {
    // 현재는 로깅만 (실제로는 Slack Web API 호출)
    logger.info('Delayed response', { channelId, message: message.substring(0, 100) });
    
    // TODO: Slack Web API 연동
    // await slackWebClient.chat.postMessage({
    //   channel: channelId,
    //   text: message
    // });
  }

  /**
   * 헬스체크 엔드포인트
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      // Vertex AI 서비스 상태 확인
      const config = this.vertexAIService.getConfig();
      
      res.json({
        status: 'healthy',
        service: 'AI Slack Controller',
        vertexAI: {
          projectId: config.projectId,
          location: config.location,
          model: config.modelId
        },
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      res.status(500).json({
        status: 'unhealthy',
        error: 'AI service check failed',
        timestamp: new Date().toISOString()
      });
    }
  }
}