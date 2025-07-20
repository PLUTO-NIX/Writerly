// Parameter Object Pattern for VertexAI configuration
export interface VertexAIConfig {
  projectId: string;
  location: string;
  modelId: string;
  generationConfig: GenerationConfig;
}

export interface GenerationConfig {
  maxOutputTokens: number;
  temperature: number;
  topP: number;
  topK: number;
}

// AI request and response types
export interface AIGenerationRequest {
  prompt: string;
  data?: string;
  requestId?: string;
  userId?: string;
  contextMetadata?: AIContextMetadata;
}

export interface AIContextMetadata {
  channelId: string;
  workspaceId: string;
  userName: string;
  timestamp: Date;
}

export interface AIResponse {
  content: string;
  tokenUsage: TokenUsage;
  processingTimeMs: number;
  requestId?: string;
  metadata: ResponseMetadata;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface ResponseMetadata {
  modelId: string;
  finishReason: string;
  safetyRatings?: SafetyRating[];
  generatedAt: Date;
}

export interface SafetyRating {
  category: string;
  probability: string;
}

// Custom exceptions
export class VertexAIException extends Error {
  constructor(
    message: string,
    public originalError?: Error,
    public errorCode?: string
  ) {
    super(message);
    this.name = 'VertexAIException';
  }
}

export class ValidationException extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationException';
  }
}

// Processing timer utility class (Stepper pattern)
export class ProcessingTimer {
  private startTime: number;

  constructor() {
    this.startTime = Date.now();
  }

  getElapsed(): number {
    return Date.now() - this.startTime;
  }

  reset(): void {
    this.startTime = Date.now();
  }
}