# 슬랙 앱 설정 가이드

## 1. 슬랙 앱 생성

### 1.1 앱 생성하기
1. [Slack API 사이트](https://api.slack.com/apps)에 접속
2. "Create New App" 클릭
3. "From scratch" 선택
4. 앱 이름: **Writerly**
5. 워크스페이스 선택

### 1.2 기본 정보 설정
- **App Name**: Writerly
- **Short Description**: AI-powered message assistant for Slack
- **Long Description**: Transform your messages with AI - make them professional, friendly, or fix typos before posting
- **App Icon**: (AI/글쓰기 관련 아이콘 업로드)

## 2. 권한 설정 (OAuth & Permissions)

### 2.1 Bot Token Scopes
다음 권한들을 추가해야 합니다:

**User Token Scopes** (사용자 대신 메시지 게시를 위해 필요):
- `chat:write` - 메시지 게시
- `chat:write.public` - 공개 채널에 메시지 게시

**Bot Token Scopes** (앱 기본 기능을 위해 필요):
- `commands` - 슬래시 명령어 사용
- `chat:write` - 봇으로 메시지 게시
- `chat:write.public` - 공개 채널에 봇 메시지 게시
- `users:read` - 사용자 정보 읽기
- `channels:read` - 채널 정보 읽기
- `groups:read` - 프라이빗 채널 정보 읽기
- `im:read` - DM 정보 읽기
- `mpim:read` - 그룹 DM 정보 읽기

### 2.2 Redirect URLs
OAuth 인증을 위한 리디렉션 URL 설정:
- `https://your-domain.com/slack/oauth/callback`
- 개발 환경: `http://localhost:5000/slack/oauth/callback`

## 3. 기능 설정

### 3.1 Slash Commands
다음 슬래시 명령어들을 추가:

**Command**: `/ai`
- **Request URL**: `https://your-domain.com/slack/commands/ai`
- **Short Description**: Process text with AI
- **Usage Hint**: `[prompt] [text]` or empty for modal

**Command**: `/ai-prompts`
- **Request URL**: `https://your-domain.com/slack/commands/ai-prompts`
- **Short Description**: Manage your custom prompts
- **Usage Hint**: (empty)

### 3.2 Interactivity & Shortcuts
- **Interactivity**: 활성화
- **Request URL**: `https://your-domain.com/slack/interactive`

### 3.3 Event Subscriptions
- **Enable Events**: 활성화
- **Request URL**: `https://your-domain.com/slack/events`

## 4. 토큰 및 시크릿 수집

설정 완료 후 다음 정보들을 `.env` 파일에 추가:

```bash
# 슬랙 설정
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here  
SLACK_CLIENT_ID=your-client-id-here
SLACK_CLIENT_SECRET=your-client-secret-here
```

### 토큰 위치:
- **SLACK_BOT_TOKEN**: OAuth & Permissions → Bot User OAuth Token
- **SLACK_SIGNING_SECRET**: Basic Information → Signing Secret
- **SLACK_CLIENT_ID**: Basic Information → Client ID
- **SLACK_CLIENT_SECRET**: Basic Information → Client Secret

## 5. 앱 배포

### 5.1 개발 환경에서 테스트
1. 웹 서버 실행 후 ngrok 등으로 퍼블릭 URL 생성
2. 슬랙 앱 설정에서 Request URL들을 ngrok URL로 변경
3. 워크스페이스에 앱 설치 테스트

### 5.2 프로덕션 배포
1. 실제 도메인으로 Request URL 변경
2. 앱 배포 설정 활성화
3. 슬랙 앱 디렉토리에 제출 (선택사항)

## 6. 권한 부여 플로우

사용자가 처음 앱을 사용할 때:
1. `/ai` 명령어 실행
2. 권한이 없으면 OAuth 인증 링크 제공
3. 사용자가 권한 부여 완료
4. 사용자 토큰 저장 후 서비스 사용 가능 