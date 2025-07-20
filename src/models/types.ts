// Slack request types
export interface SlackSlashCommandRequest {
  token: string;
  team_id: string;
  team_domain: string;
  channel_id: string;
  channel_name: string;
  user_id: string;
  user_name: string;
  command: string;
  text: string;
  response_url: string;
  trigger_id: string;
  api_app_id?: string;
  enterprise_id?: string;
  enterprise_name?: string;
}

// Slack response types
export interface SlackResponse {
  response_type: 'ephemeral' | 'in_channel';
  text: string;
  blocks?: any[];
  attachments?: any[];
}

// AI request types
export interface AIRequest {
  requestId: string;
  prompt: string;
  data?: string;
  userId: string;
  channelId: string;
  workspaceId: string;
  responseUrl: string;
  createdAt: Date;
}

// Parsed command types
export interface ParsedCommand {
  prompt: string;
  data: string;
  isValid: boolean;
  error?: string;
}

// Queue configuration
export interface QueueConfig {
  projectId: string;
  location: string;
  queueName: string;
  serviceUrl: string;
}