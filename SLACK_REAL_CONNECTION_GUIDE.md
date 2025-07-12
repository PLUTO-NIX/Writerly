# 🔗 실제 Slack 연결 - 단계별 실행 가이드

**Writerly를 실제 Slack workspace에 연결하는 완전한 실행 가이드입니다.**

## 📋 사전 준비 확인

- [x] Flask 앱 개발 완료
- [x] 로컬 테스트 성공
- [ ] Slack workspace 관리자 권한
- [ ] ngrok 계정 (무료)
- [ ] OpenAI API 계정 (선택사항)

---

## **1단계: ngrok 설정 (외부 접근)**

### 1-1. ngrok 계정 생성
```bash
# 1. 브라우저에서 https://ngrok.com 방문
# 2. "Sign up for free" 클릭
# 3. 이메일로 계정 생성 (무료)
# 4. 로그인 후 대시보드 접속
```

### 1-2. authtoken 설정
```bash
# 1. https://dashboard.ngrok.com/get-started/your-authtoken 접속
# 2. "Your Authtoken" 복사
# 3. 터미널에서 실행 (실제 토큰으로 교체):

ngrok authtoken 2abc123def456ghi789  # 예시 - 실제 토큰 사용

# 성공 시 출력: Authtoken saved to configuration file: ...
```

### 1-3. Flask 앱을 외부에 노출
```bash
# 새 터미널 창에서 실행:
ngrok http 5000

# 출력 예시:
# Session Status                online
# Forwarding                    https://abc123.ngrok.io -> http://localhost:5000
```

**📝 중요: https://abc123.ngrok.io URL을 복사해두세요!**

---

## **2단계: Slack 앱 생성**

### 2-1. Slack API 콘솔 접속
```bash
# 1. 브라우저에서 https://api.slack.com/apps 접속
# 2. "Create New App" 클릭
# 3. "From scratch" 선택
```

### 2-2. 앱 기본 정보 입력
```
App Name: Writerly
Pick a workspace: [본인의 Slack workspace 선택]
```

### 2-3. OAuth & Permissions 설정
**좌측 메뉴 > OAuth & Permissions**

#### Bot Token Scopes 추가:
```
다음 권한들을 하나씩 "Add an OAuth Scope" 버튼으로 추가:

✅ chat:write              # 메시지 전송
✅ chat:write.public       # 공개 채널 메시지
✅ commands                # 슬래시 명령어 
✅ users:read              # 사용자 정보 조회
✅ channels:read           # 채널 정보 조회
✅ groups:read             # 비공개 채널 정보
✅ im:read                 # DM 정보
✅ mpim:read               # 그룹 DM 정보
```

#### User Token Scopes 추가:
```
✅ chat:write              # 사용자 이름으로 메시지 전송
```

### 2-4. 앱 설치
```bash
# OAuth & Permissions 페이지에서:
# 1. "Install to Workspace" 버튼 클릭
# 2. 권한 승인
# 3. 설치 완료 후 토큰 복사:

Bot User OAuth Token: xoxb-[YOUR-BOT-TOKEN-HERE]
User OAuth Token: xoxp-[YOUR-USER-TOKEN-HERE]
```

**📝 중요: 두 토큰을 안전한 곳에 저장하세요!**

---

## **3단계: Slash Commands 설정**

### 3-1. /ai 명령어 생성
**좌측 메뉴 > Slash Commands > Create New Command**

```
Command: /ai
Request URL: https://abc123.ngrok.io/slack/commands/ai  # 1단계의 ngrok URL 사용
Short Description: AI로 텍스트 처리
Usage Hint: [텍스트] 또는 프롬프트:텍스트
```

### 3-2. /ai-prompts 명령어 생성  
**Create New Command 다시 클릭**

```
Command: /ai-prompts
Request URL: https://abc123.ngrok.io/slack/commands/ai-prompts  # 1단계의 ngrok URL 사용
Short Description: AI 프롬프트 관리
Usage Hint: 
```

---

## **4단계: Interactive Components 설정**

### 4-1. 인터랙션 활성화
**좌측 메뉴 > Interactivity & Shortcuts**

```
Interactivity: ON (토글 활성화)
Request URL: https://abc123.ngrok.io/slack/interactive  # 1단계의 ngrok URL 사용
```

### 4-2. Event Subscriptions (선택사항)
**좌측 메뉴 > Event Subscriptions**

```
Enable Events: ON (토글 활성화)
Request URL: https://abc123.ngrok.io/slack/events  # 1단계의 ngrok URL 사용
```

---

## **5단계: Signing Secret 확인**

### 5-1. Signing Secret 복사
**좌측 메뉴 > Basic Information > App Credentials**

```
Signing Secret: 1234567890abcdef1234567890abcdef12345678  # 예시
```

**📝 중요: Signing Secret도 안전한 곳에 저장하세요!**

---

## **6단계: 환경 변수 설정**

### 6-1. 개발용 환경 변수 파일 생성
```bash
# 프로젝트 루트에서 .env 파일 생성 (실제 값으로 교체):

cat > .env << 'EOF'
# Slack 설정 (실제 값으로 교체)
SLACK_BOT_TOKEN=xoxb-[YOUR-BOT-TOKEN-HERE]
SLACK_SIGNING_SECRET=[YOUR-SIGNING-SECRET-HERE]

# OpenAI 설정 (선택사항 - 실제 AI 처리용)
OPENAI_API_KEY=sk-proj-[YOUR-OPENAI-API-KEY-HERE]

# Flask 설정
FLASK_ENV=development
SECRET_KEY=super-secret-key-for-production-use-random-64-chars
DEBUG=True

# 데이터베이스
DATABASE_URL=sqlite:///writerly.db

# Redis (선택사항)
REDIS_URL=redis://localhost:6379/0

# 로그 설정
LOG_LEVEL=INFO
EOF
```

### 6-2. Flask 앱 재시작 (환경 변수 적용)
```bash
# 기존 앱 종료 후 재시작
python app.py
```

---

## **7단계: 연결 테스트**

### 7-1. 기본 연결 확인
```bash
# 1. ngrok URL로 헬스체크
curl https://abc123.ngrok.io/health

# 성공 시 JSON 응답 확인
```

### 7-2. Slack 명령어 테스트
```bash
# Slack workspace에서 직접 테스트:

# 1. 채널에서 앱 초대 (한 번만)
/invite @Writerly

# 2. GUI 모드 테스트
/ai

# 3. CLI 모드 테스트  
/ai professional: 안녕하세요, 이 텍스트를 전문적으로 바꿔주세요

# 4. 프롬프트 관리 테스트
/ai-prompts
```

### 7-3. 로그 확인
```bash
# Flask 앱 로그에서 요청 확인
tail -f app.log

# 또는 터미널 출력 확인
# Slack 요청이 성공적으로 수신되는지 확인
```

---

## **8단계: OpenAI 연동 (선택사항)**

### 8-1. OpenAI API 키 발급
```bash
# 1. https://platform.openai.com/api-keys 접속
# 2. "Create new secret key" 클릭
# 3. API 키 복사: sk-proj-...
```

### 8-2. 환경 변수에 추가
```bash
# .env 파일에 추가:
OPENAI_API_KEY=sk-proj-[YOUR-ACTUAL-API-KEY-HERE]
```

### 8-3. AI 처리 테스트
```bash
# Slack에서 실제 AI 처리 테스트:
/ai translate_en: 안녕하세요, 반갑습니다!

# 성공 시 영어 번역 결과 수신
```

---

## **9단계: 문제 해결**

### 9-1. 일반적인 오류들

#### "Invalid signature" 오류
```bash
# 원인: Signing Secret 불일치
# 해결: .env 파일의 SLACK_SIGNING_SECRET 확인
```

#### "url_verification failed" 오류  
```bash
# 원인: ngrok URL 불일치 또는 Flask 앱 미실행
# 해결: 
# 1. ngrok이 실행 중인지 확인
# 2. Flask 앱이 실행 중인지 확인  
# 3. Slack 앱 설정의 URL이 ngrok URL과 일치하는지 확인
```

#### 명령어가 작동하지 않음
```bash
# 원인: 앱이 workspace에 설치되지 않음
# 해결: OAuth & Permissions에서 "Reinstall to Workspace"
```

### 9-2. 디버깅 도구
```bash
# 실시간 로그 모니터링
tail -f app.log | grep slack

# ngrok 요청 로그 확인
# ngrok 웹 UI: http://localhost:4040

# Slack 요청 상세 확인
curl -X POST https://abc123.ngrok.io/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type": "url_verification", "challenge": "test123"}'
```

---

## **🎯 완료 체크리스트**

### 필수 단계
- [ ] ngrok 계정 생성 및 인증
- [ ] ngrok으로 Flask 앱 노출 (https://xxx.ngrok.io)
- [ ] Slack 앱 생성 및 권한 설정
- [ ] Bot Token, User Token, Signing Secret 발급
- [ ] Slash Commands 설정 (/ai, /ai-prompts)
- [ ] Interactive Components 설정
- [ ] 환경 변수 설정 (.env 파일)
- [ ] Slack에서 명령어 테스트 성공

### 선택적 단계
- [ ] OpenAI API 키 설정
- [ ] Event Subscriptions 설정
- [ ] Redis 설정 (캐싱용)
- [ ] PostgreSQL 설정 (운영용)

---

## **🚀 성공 확인**

**다음이 모두 작동하면 연결 성공입니다:**

1. **✅ 헬스체크**: `curl https://your-ngrok.ngrok.io/health`
2. **✅ GUI 모드**: Slack에서 `/ai` → 모달 열림
3. **✅ CLI 모드**: `/ai professional:텍스트` → 처리 요청 접수
4. **✅ 프롬프트 관리**: `/ai-prompts` → 관리 화면 표시

**축하합니다! Writerly가 Slack에서 작동하고 있습니다! 🎉**

---

## **📞 추가 지원**

**문제가 발생하면:**
1. 각 단계의 체크리스트 재확인
2. ngrok과 Flask 앱이 모두 실행 중인지 확인
3. Slack 앱의 토큰과 URL이 올바른지 확인
4. 로그 파일에서 오류 메시지 확인

**성공적인 연결을 위해 한 단계씩 차근차근 진행하세요!** 