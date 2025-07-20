/**
 * Slack API 요청 테스트 픽스처
 * 실제 Slack API 응답을 기반으로 한 Mock 데이터
 */

import { SlackSlashCommandRequest } from '../../src/models/types';

export const validSlackSlashCommandRequest: SlackSlashCommandRequest = {
  token: 'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular%20Construct%20Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/ai',
  text: '"요약해줘" "긴 텍스트입니다..."',
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0',
  api_app_id: 'A123456789'
};

export const slackSlashCommandWithoutData: SlackSlashCommandRequest = {
  token: 'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular%20Construct%20Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/ai',
  text: '"번역해줘"',
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0',
  api_app_id: 'A123456789'
};

export const slackSlashCommandHelpRequest: SlackSlashCommandRequest = {
  token: 'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular%20Construct%20Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/ai',
  text: 'help',
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0',
  api_app_id: 'A123456789'
};

export const slackSlashCommandEmptyRequest: SlackSlashCommandRequest = {
  token: 'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular%20Construct%20Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/ai',
  text: '',
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0',
  api_app_id: 'A123456789'
};

export const slackSlashCommandLongTextRequest: SlackSlashCommandRequest = {
  token: 'gIkuvaNzQIHg97ATvDxqgjtO',
  team_id: 'T0001',
  team_domain: 'example',
  enterprise_id: 'E0001',
  enterprise_name: 'Globular%20Construct%20Inc',
  channel_id: 'C2147483705',
  channel_name: 'test',
  user_id: 'U2147483697',
  user_name: 'Steve',
  command: '/ai',
  text: '"분석해줘" "' + 'a'.repeat(10001) + '"', // 10,001자 - 제한 초과
  response_url: 'https://hooks.slack.com/commands/1234/5678',
  trigger_id: '13345224609.738474920.8088930838d88f008e0',
  api_app_id: 'A123456789'
};

// Slack OAuth 요청 데이터
export const slackOAuthRequest = {
  code: 'code_value_from_slack',
  state: 'random_state_value',
  error: null
};

export const slackOAuthErrorRequest = {
  code: null,
  state: 'random_state_value',
  error: 'access_denied'
};

// Slack API 토큰 교환 응답 (실제 Slack API 응답 형식)
export const slackOAuthTokenResponse = {
  ok: true,
  access_token: 'xoxb-TEST-BOT-TOKEN-FOR-UNIT-TESTS-ONLY',
  token_type: 'bot',
  scope: 'commands,chat:write',
  bot_user_id: 'U0KRQLJ9H',
  app_id: 'A0KRD7HC3',
  team: {
    name: 'Slack Softball Team',
    id: 'T9TK3CUKW'
  },
  enterprise: {
    name: 'slack-sports',
    id: 'E12345678'
  },
  authed_user: {
    id: 'U1234567890',
    scope: 'chat:write',
    access_token: 'xoxp-TEST-USER-TOKEN-FOR-UNIT-TESTS-ONLY',
    token_type: 'user'
  }
};

export const slackOAuthTokenErrorResponse = {
  ok: false,
  error: 'invalid_code'
};

// Slack 웹훅 응답 형식
export const slackWebhookSuccessResponse = {
  ok: true
};

export const slackWebhookErrorResponse = {
  ok: false,
  error: 'channel_not_found'
};

// Slack 사용자 정보 응답 (실제 Slack API 응답 형식)
export const slackUserInfoResponse = {
  ok: true,
  user: {
    id: 'U2147483697',
    team_id: 'T0001',
    name: 'Steve',
    deleted: false,
    color: '9f69e7',
    real_name: 'Steve Doe',
    tz: 'America/Los_Angeles',
    tz_label: 'Pacific Daylight Time',
    tz_offset: -25200,
    profile: {
      first_name: 'Steve',
      last_name: 'Doe',
      display_name: 'Steve',
      display_name_normalized: 'Steve',
      real_name: 'Steve Doe',
      real_name_normalized: 'Steve Doe',
      email: 'steve@example.com',
      image_24: 'https://...',
      image_32: 'https://...',
      image_48: 'https://...',
      image_72: 'https://...',
      image_192: 'https://...',
      image_512: 'https://...'
    },
    is_admin: false,
    is_owner: false,
    is_primary_owner: false,
    is_restricted: false,
    is_ultra_restricted: false,
    is_bot: false,
    updated: 1502138686,
    is_app_user: false,
    has_2fa: false
  }
};

// 테스트용 Slack 서명 헤더 생성 함수
export function generateSlackSignature(
  timestamp: string,
  body: string,
  signingSecret: string = 'test_signing_secret'
): string {
  const crypto = require('crypto');
  const sigBasestring = `v0:${timestamp}:${body}`;
  const signature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring, 'utf8')
    .digest('hex');
  return signature;
}

// 테스트용 Express 요청 객체 생성 헬퍼
export function createMockSlackRequest(
  slackData: SlackSlashCommandRequest,
  options: {
    timestamp?: string;
    signature?: string;
    includeSignature?: boolean;
  } = {}
) {
  const timestamp = options.timestamp || Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(slackData);
  const signature = options.signature || generateSlackSignature(timestamp, body);

  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'user-agent': 'Slackbot 1.0 (+https://api.slack.com/robots)',
  };

  if (options.includeSignature !== false) {
    headers['x-slack-signature'] = signature;
    headers['x-slack-request-timestamp'] = timestamp;
  }

  return {
    method: 'POST',
    url: '/slack/commands',
    headers,
    body: slackData,
    rawBody: body
  };
}