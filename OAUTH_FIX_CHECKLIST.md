# OAuth 시스템 수정 체크리스트

**작성일**: 2025-07-20  
**목적**: DOCS 요구사항에 맞춘 OAuth 시스템 완전 구현  
**현재 상태**: 기본 OAuth 구현됨, Bot Token 및 이중 토큰 시스템 누락

---

## 🎯 핵심 문제점

### 1. **Bot User OAuth Token 누락**
- **현재**: User OAuth Token만 있음 (`xoxp-`)
- **필요**: Bot User OAuth Token (`xoxb-`) 추가 필요
- **용도**: 기본 메시지 전송, 인증 안내, 에러 메시지

### 2. **인증 플로우 불일치**
- **현재**: 도움말 → 인증 버튼 표시
- **요구사항**: `/ai` 입력 즉시 인증 상태 확인

### 3. **메시지 전송 방식 불일치**
- **현재**: `response_url` 사용
- **요구사항**: `postToSlack` 함수 + Slack Web API 사용

---

## 📋 수정 작업 체크리스트

### Phase 1: Bot Token 설정 및 환경 구성

#### 1.1 Slack 앱에서 Bot Token 확인
- [ ] **Slack Developer Console** → **OAuth & Permissions** 접속
- [ ] **Bot User OAuth Token** 복사 (`xoxb-`로 시작)
- [ ] Bot Token Scopes 확인:
  - [ ] `chat:write`
  - [ ] `chat:write.public`
  - [ ] `users:read`

#### 1.2 Secret Manager에 Bot Token 저장
```bash
# Bot Token을 Secret Manager에 추가
gcloud secrets create slack-bot-token --project=writerly-01
echo "YOUR_BOT_TOKEN" | gcloud secrets versions add slack-bot-token --data-file=- --project=writerly-01
```
- [ ] **Bot Token Secret 생성 완료**
- [ ] **Bot Token 값 저장 완료**

#### 1.3 Cloud Run 환경변수 업데이트
```bash
# 기존 배포 명령어에 Bot Token 추가
--update-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest"
```
- [ ] **배포 스크립트에 Bot Token 추가**

---

### Phase 2: 이중 토큰 시스템 구현

#### 2.1 Slack Service 수정
**파일**: `src/services/slack.service.ts`

```typescript
// 추가할 기능들
export class SlackBotClient {
  constructor(private readonly botToken: string) {}
  
  // Bot token으로 기본 메시지 전송
  async postBotMessage(channel: string, message: SlackMessage): Promise<SlackApiResponse>
  
  // 인증 안내 메시지 전송
  async sendAuthPrompt(channel: string, authUrl: string): Promise<SlackApiResponse>
  
  // 에러 메시지 전송
  async sendErrorMessage(channel: string, error: string): Promise<SlackApiResponse>
}

export class SlackUserClient {
  constructor(private readonly userToken: string) {}
  
  // User token으로 사용자 대신 메시지 전송
  async postAsUser(channel: string, message: SlackMessage): Promise<SlackApiResponse>
}
```

**체크리스트**:
- [ ] **SlackBotClient 클래스 구현**
- [ ] **SlackUserClient 클래스 구현**  
- [ ] **Bot token 전용 메서드 구현**
- [ ] **User token 전용 메서드 구현**
- [ ] **에러 처리 로직 추가**

#### 2.2 postToSlack 유틸리티 함수 구현
**파일**: `src/utils/slack.ts`

```typescript
export interface SlackMessagePayload {
  text: string;
  response_type?: 'in_channel' | 'ephemeral';
  attachments?: SlackAttachment[];
  blocks?: SlackBlock[];
}

export async function postToSlack(
  responseUrl: string, 
  payload: SlackMessagePayload
): Promise<void>

export async function postToSlackAsUser(
  userToken: string,
  channel: string,
  payload: SlackMessagePayload
): Promise<void>

export async function postToSlackAsBot(
  botToken: string,
  channel: string, 
  payload: SlackMessagePayload
): Promise<void>
```

**체크리스트**:
- [ ] **postToSlack 기본 함수 구현**
- [ ] **postToSlackAsUser 함수 구현** 
- [ ] **postToSlackAsBot 함수 구현**
- [ ] **에러 처리 및 재시도 로직 추가**
- [ ] **로깅 추가**

---

### Phase 3: 인증 플로우 수정

#### 3.1 Slack 명령어 처리 로직 수정
**파일**: `src/simple-oauth-app.ts` (또는 새로운 완전한 구현)

**현재 문제점**:
```typescript
// 문제: 텍스트가 비어있을 때만 인증 안내
if (!text || text.trim().length === 0) {
  // 인증 버튼 표시
}
```

**수정 방향**:
```typescript
// 해결: 모든 /ai 요청에서 인증 상태 먼저 확인
app.post('/slack/commands', async (req, res) => {
  const { user_id, team_id, channel_id, text } = req.body;
  
  // 1. 인증 상태 확인 (우선순위 1)
  const isAuthenticated = await checkUserAuthentication(user_id, team_id);
  
  if (!isAuthenticated) {
    // Bot token으로 인증 안내 메시지 전송
    await sendAuthPromptWithBot(channel_id, user_id, team_id);
    return res.json({ response_type: 'ephemeral', text: '인증이 진행 중입니다.' });
  }
  
  // 2. 인증된 경우에만 AI 처리
  if (!text || text.trim().length === 0) {
    return res.json({ /* 도움말 */ });
  }
  
  // 3. AI 처리 후 User token으로 응답
  // ...
});
```

**체크리스트**:
- [ ] **인증 상태 우선 확인 로직 구현**
- [ ] **Bot token으로 인증 안내 전송**
- [ ] **User token으로 AI 응답 전송**
- [ ] **에러 시 Bot token으로 에러 메시지 전송**

#### 3.2 인증 미들웨어 수정
**파일**: `src/middleware/auth.middleware.ts`

**수정 사항**:
```typescript
export const requireSlackAuth = async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
  const { user_id, team_id, channel_id } = req.body;
  
  // 1. 세션 확인
  const session = await sessionService.getOAuthSession(user_id, team_id);
  
  if (!session) {
    // Bot token으로 인증 안내 (response_url 사용하지 않음)
    await sendAuthPromptWithBot(channel_id, user_id, team_id);
    return res.json({
      response_type: 'ephemeral',
      text: '🔐 인증 요청을 전송했습니다. 채널을 확인해주세요.'
    });
  }
  
  // 2. 토큰 만료 확인 및 갱신
  // ...
  
  next();
};
```

**체크리스트**:
- [ ] **미들웨어에서 Bot token 사용 로직 추가**
- [ ] **채널 직접 메시지 전송 구현**
- [ ] **토큰 갱신 로직 유지**

---

### Phase 4: AI 처리 및 응답 시스템 수정

#### 4.1 AI 응답 전송 방식 변경
**현재 방식**:
```typescript
// response_url 사용
await fetch(responseUrl, {
  method: 'POST',
  body: JSON.stringify({ text: content })
});
```

**수정 방식**:
```typescript
// User token으로 사용자 대신 메시지 전송
await postToSlackAsUser(userToken, channelId, {
  text: content,
  response_type: 'in_channel'
});
```

**체크리스트**:
- [ ] **AI 응답을 User token으로 전송하도록 수정**
- [ ] **에러 메시지를 Bot token으로 전송하도록 수정**
- [ ] **로깅 및 모니터링 유지**

#### 4.2 에러 처리 개선
```typescript
// Bot token으로 에러 메시지 전송
catch (error) {
  await postToSlackAsBot(botToken, channelId, {
    text: '❌ AI 처리 중 오류가 발생했습니다.',
    response_type: 'ephemeral'
  });
}
```

**체크리스트**:
- [ ] **Bot token 에러 메시지 구현**
- [ ] **User-friendly 에러 메시지 작성**
- [ ] **에러 로깅 유지**

---

### Phase 5: 통합 및 배포

#### 5.1 환경변수 설정 확인
```bash
# 필요한 모든 환경변수
SLACK_CLIENT_ID=5236535832325.9220502327843
SLACK_CLIENT_SECRET=9acd0ebcfcf5b094c52d952592872463  
SLACK_SIGNING_SECRET=056dedee2cda6b655d97a198c6856136
SLACK_BOT_TOKEN=xoxb-YOUR-BOT-TOKEN  # 추가 필요
ENCRYPTION_KEY=DvLHsjXO+DMN9FrdkTETNJEwxTx2KbuRPdrMa+vxrZM=
```

**체크리스트**:
- [ ] **모든 Secret Manager 시크릿 설정 완료**
- [ ] **Cloud Run 환경변수 연결 완료**
- [ ] **환경변수 값 검증 완료**

#### 5.2 최종 배포 및 테스트
```bash
# 완전한 OAuth 시스템 배포
gcloud run deploy writerly \
  --source . \
  --project=writerly-01 \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=writerly-01,GCP_LOCATION=us-central1,BASE_URL=https://writerly-177365346300.us-central1.run.app" \
  --update-secrets="SLACK_CLIENT_ID=slack-client-id:latest" \
  --update-secrets="SLACK_CLIENT_SECRET=slack-client-secret:latest" \
  --update-secrets="SLACK_SIGNING_SECRET=slack-signing-secret:latest" \
  --update-secrets="SLACK_BOT_TOKEN=slack-bot-token:latest" \
  --update-secrets="ENCRYPTION_KEY=encryption-key:latest"
```

**체크리스트**:
- [ ] **완전한 OAuth 앱 배포**
- [ ] **Health check 확인**
- [ ] **OAuth 엔드포인트 테스트**

#### 5.3 기능 테스트
**테스트 시나리오**:
1. **미인증 사용자**: `/ai` → Bot이 인증 버튼 전송
2. **인증 완료**: OAuth 플로우 정상 동작
3. **AI 요청**: User 이름으로 AI 응답 전송
4. **에러 상황**: Bot이 에러 메시지 전송

**체크리스트**:
- [ ] **미인증 사용자 플로우 테스트**
- [ ] **OAuth 인증 플로우 테스트**  
- [ ] **AI 응답 User 이름 전송 테스트**
- [ ] **에러 처리 테스트**
- [ ] **로그 확인**

---

## 🎯 완료 후 기대 효과

### ✅ 해결될 문제들
1. **`/ai` 입력 시 즉시 인증 상태 확인**
2. **Bot이 인증 안내 메시지 전송** 
3. **사용자 이름으로 AI 응답 표시**
4. **완전한 DOCS 요구사항 준수**

### ✅ 최종 플로우
```
사용자: /ai "번역" "안녕하세요"
    ↓
시스템: 인증 상태 확인
    ↓ (미인증)
Bot: 🔐 인증이 필요합니다 [인증하기] (Bot 이름으로 전송)
    ↓ (인증 완료)
사용자: /ai "번역" "안녕하세요" (재시도)
    ↓
AI 처리: "Hello"
    ↓
사용자 이름: Hello (사용자 이름으로 응답 표시)
```

---

## 📊 작업 예상 소요시간

| Phase | 작업 내용 | 예상 시간 |
|-------|-----------|-----------|
| **Phase 1** | Bot Token 설정 | 30분 |
| **Phase 2** | 이중 토큰 시스템 구현 | 2시간 |
| **Phase 3** | 인증 플로우 수정 | 1.5시간 |
| **Phase 4** | AI 응답 시스템 수정 | 1시간 |
| **Phase 5** | 통합 및 테스트 | 1시간 |
| **총 소요시간** | | **6시간** |

---

## 🔍 주요 파일 수정 목록

### 수정할 파일들
- [ ] `src/services/slack.service.ts` - 이중 토큰 시스템
- [ ] `src/utils/slack.ts` - postToSlack 함수 (신규)
- [ ] `src/middleware/auth.middleware.ts` - Bot token 인증 안내
- [ ] `src/simple-oauth-app.ts` - 인증 우선 확인 로직
- [ ] `Dockerfile` - 환경변수 추가
- [ ] 배포 스크립트 - Bot token 추가

### 신규 생성할 파일들  
- [ ] `src/utils/slack.ts` - Slack 유틸리티 함수들

---

**다음 단계**: Phase 1부터 순서대로 진행하여 완전한 OAuth 시스템 구현 완료!