# 🐳 Docker로 모든 서비스 한번에 실행하기

이 가이드를 따라하면 **한 번의 명령어**로 모든 서비스를 실행할 수 있습니다.

## 🚀 빠른 시작

### 1. 환경 변수 설정
```bash
# 1. 예시 파일 복사
cp env.dev.example .env

# 2. .env 파일 편집 (실제 토큰으로 교체)
notepad .env  # 또는 원하는 에디터 사용
```

### 2. 모든 서비스 실행
```bash
# PowerShell에서 실행
./start-all.ps1

# 또는 직접 Docker Compose 실행
docker-compose up -d
```

### 3. ngrok URL 확인
```bash
# 웹 브라우저에서 접속
http://localhost:4040
```

### 4. 서비스 중지
```bash
./stop-all.ps1

# 또는 직접 중지
docker-compose down
```

## 📋 실행되는 서비스들

| 서비스 | 포트 | 설명 |
|--------|------|------|
| **web** | 5000 | Flask 웹 애플리케이션 |
| **worker** | - | Celery 백그라운드 워커 |
| **redis** | 6379 | 메시지 브로커/캐시 |
| **postgres** | 5433 | 데이터베이스 |
| **ngrok** | 4040 | 외부 터널링 (Slack용) |

## 🔧 필요한 환경 변수

### 필수 (Slack 연동)
- `SLACK_BOT_TOKEN`: Slack 봇 토큰
- `SLACK_SIGNING_SECRET`: Slack 서명 비밀키  
- `NGROK_AUTHTOKEN`: ngrok 인증 토큰

### 선택사항 (AI 기능)
- `OPENAI_API_KEY`: OpenAI API 키

## 📱 Slack 앱 설정

ngrok URL을 받은 후 Slack 앱 설정에서:

1. **Slash Commands**:
   - `/ai` → `https://your-ngrok-url/slack/commands/ai`
   - `/ai-prompts` → `https://your-ngrok-url/slack/commands/ai-prompts`

2. **Interactive Components**:
   - `https://your-ngrok-url/slack/interactive`

3. **Event Subscriptions**:
   - `https://your-ngrok-url/slack/events`

## 🛠️ 문제 해결

### 포트 충돌
- PostgreSQL 포트를 5432 → 5433으로 변경했습니다
- 다른 포트 충돌 시 `docker-compose.yml`에서 포트 수정

### 서비스 상태 확인
```bash
docker-compose ps
docker-compose logs web
docker-compose logs worker
```

### 컨테이너 재시작
```bash
docker-compose restart web
docker-compose restart worker
```

## ✅ 성공 확인

다음이 모두 작동하면 성공입니다:

1. **웹 앱**: http://localhost:5000
2. **ngrok UI**: http://localhost:4040  
3. **Redis**: 포트 6379
4. **PostgreSQL**: 포트 5433
5. **Slack 명령어**: `/ai` 실행 시 모달 오픈

🎉 **모든 서비스가 정상 작동하면 Slack에서 AI 기능을 사용할 수 있습니다!** 