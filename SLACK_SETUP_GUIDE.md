# 🔗 Slack API 연결 가이드

Writerly를 실제 Slack workspace에 연결하는 완전한 가이드입니다.

## 📋 사전 준비 사항

- Slack workspace 관리자 권한
- 외부에서 접근 가능한 서버 URL (ngrok 또는 배포된 서버)
- Python 환경과 Flask 앱 실행 가능

## 🚀 1단계: Slack App 생성

### 1. Slack API 콘솔 접속
1. [https://api.slack.com/apps](https://api.slack.com/apps) 접속
2. **"Create New App"** 클릭
3. **"From scratch"** 선택
4. App Name: `Writerly` (또는 원하는 이름)
5. Workspace 선택 후 **"Create App"** 클릭

### 2. OAuth & Permissions 설정
**왼쪽 메뉴 > OAuth & Permissions**

#### Bot Token Scopes 추가:
```
- chat:write (메시지 전송)
- chat:write.public (공개 채널 메시지)
- commands (슬래시 명령어)
- users:read (사용자 정보 조회)
- channels:read (채널 정보 조회)
- groups:read (비공개 채널 정보)
- im:read (DM 정보)
- mpim:read (그룹 DM 정보)
```

#### User Token Scopes 추가:
```
- chat:write (사용자 이름으로 메시지 전송)
```

### 3. 앱 설치
**OAuth & Permissions** 페이지에서:
1. **"Install to Workspace"** 클릭
2. 권한 승인
3. **Bot User OAuth Token** (`xoxb-...`)과 **User OAuth Token** (`xoxp-...`) 복사

## 🔧 2단계: 환경 변수 설정

`.env` 파일 생성:

```bash
# Slack 설정
SLACK_BOT_TOKEN=xoxb-your-bot-token-here
SLACK_SIGNING_SECRET=your-signing-secret-here

# OpenAI 설정
OPENAI_API_KEY=sk-your-openai-api-key-here

# Flask 설정
FLASK_ENV=development
SECRET_KEY=your-super-secret-key-here

# 데이터베이스
DATABASE_URL=postgresql://username:password@localhost/writerly
# 또는 SQLite용:
# DATABASE_URL=sqlite:///writerly.db

# Redis (선택사항 - 캐싱용)
REDIS_URL=redis://localhost:6379/0

# Celery (백그라운드 작업용)
CELERY_BROKER_URL=redis://localhost:6379/1
```

## 🌐 3단계: 외부 접속 URL 설정

### 로컬 개발: ngrok 사용
```bash
# ngrok 설치 (필요시)
npm install -g ngrok

# Flask 앱 실행 (포트 5000)
python app.py

# 새 터미널에서 ngrok 실행
ngrok http 5000
```

ngrok에서 제공하는 HTTPS URL 복사 (예: `https://abc123.ngrok.io`)

### 배포된 서버 사용
이미 배포된 서버가 있다면 해당 URL 사용

## ⚙️ 4단계: Slack App 설정 완료

### 1. Slash Commands 설정
**Slack API 콘솔 > Slash Commands**

#### `/ai` 명령어:
- Command: `/ai`
- Request URL: `https://your-domain.com/slack/commands/ai`
- Short Description: `AI로 텍스트 처리`
- Usage Hint: `[텍스트] 또는 프롬프트:텍스트`

#### `/ai-prompts` 명령어:
- Command: `/ai-prompts`
- Request URL: `https://your-domain.com/slack/commands/ai-prompts`
- Short Description: `AI 프롬프트 관리`

### 2. Interactive Components 설정
**Slack API 콘솔 > Interactivity & Shortcuts**

- **Interactivity**: ON
- **Request URL**: `https://your-domain.com/slack/interactive`

### 3. Event Subscriptions 설정 (선택사항)
**Slack API 콘솔 > Event Subscriptions**

- **Enable Events**: ON  
- **Request URL**: `https://your-domain.com/slack/events`
- **Subscribe to bot events**: 필요한 이벤트 추가

### 4. App Home 설정 (선택사항)
**Slack API 콘솔 > App Home**

- **Home Tab**: 활성화
- **Messages Tab**: 활성화

## 🧪 5단계: 연결 테스트

### 1. 앱 설치 확인
Slack workspace에서:
1. 앱이 **Apps** 섹션에 나타나는지 확인
2. 채널에 앱 추가: `/invite @Writerly`

### 2. 기본 기능 테스트
```bash
# 헬스체크
curl https://your-domain.com/health

# 모달 열기
/ai

# CLI 모드
/ai professional: 안녕하세요, 이 텍스트를 전문적으로 바꿔주세요

# 프롬프트 관리
/ai-prompts
```

### 3. 연결 확인
```bash
# 앱 로그 확인
tail -f app.log

# Slack 이벤트 수신 확인
curl -X POST https://your-domain.com/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type": "url_verification", "challenge": "test123"}'
```

## 🔒 6단계: 보안 설정

### Signing Secret 설정
**Slack API 콘솔 > Basic Information > App Credentials**에서 **Signing Secret** 복사하여 환경변수에 추가

### IP 화이트리스트 (선택사항)
프로덕션 환경에서는 Slack IP 대역만 허용하도록 설정

## 📊 7단계: 모니터링 설정

### 로그 모니터링
```bash
# 실시간 로그 확인
tail -f app.log

# 에러 로그 필터링
tail -f app.log | grep ERROR
```

### Slack App 분석
**Slack API 콘솔 > Analytics**에서 사용량 통계 확인

## 🚨 문제 해결

### 일반적인 오류들:

#### "Invalid signature" 오류
- Signing Secret이 올바른지 확인
- 요청 타임스탬프가 5분 이내인지 확인

#### "url_verification failed" 오류
- ngrok URL이 올바른지 확인
- HTTPS 사용 확인

#### 명령어가 작동하지 않음
- Slash Commands URL이 올바른지 확인
- 앱이 workspace에 설치되었는지 확인

#### AI 처리 실패
- OpenAI API 키가 유효한지 확인
- 사용량 한도를 초과하지 않았는지 확인

### 디버깅 도구:
```bash
# Slack 요청 로그 확인
grep "slack" app.log

# OpenAI API 호출 로그
grep "openai" app.log

# 에러 추적
grep "ERROR" app.log | tail -20
```

## 🎯 다음 단계

1. **사용자 인증** 구현
2. **사용량 제한** 설정  
3. **커스텀 프롬프트** 기능 활용
4. **팀 관리** 기능 추가
5. **분석 대시보드** 구축

---

## 📞 지원

문제가 발생하면:
1. 로그 파일 확인
2. Slack API 콘솔의 오류 메시지 확인
3. 개발자 문서 참조: [Slack API Documentation](https://api.slack.com/) 