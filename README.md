# Writerly - Slack AI Assistant

Slack 기반 AI 글쓰기 어시스턴트 - Google Vertex AI Gemini 2.0 Flash 활용

## ✨ 핵심 기능

### 🎯 Slash Command
```bash
/ai "영어로 번역" "안녕하세요, 만나서 반갑습니다."
/ai "요약" "긴 문서 내용..."
/ai "문법 검토" "영어 문장..."
```

### 🧵 Thread Mention
```bash
@Writerly "일본어로 번역" "Hello world"
@Writerly "코드 리뷰" "function example() { ... }"
```

### 📝 Format Preservation
- **Slack 마크다운 구조 보존**
- **복잡한 서식 자동 감지**
- **적응형 서식 처리**

### 🔐 Semi-Permanent Authentication
- **Firestore 기반 암호화 토큰 저장**
- **자동 토큰 만료 처리**
- **OAuth 2.0 인증 플로우**

## 🛠️ 기술 스택

### Core
- **Node.js 18** + **TypeScript**
- **Express.js** (단일 서비스)
- **Google Cloud Run** (서버리스 배포)

### AI & Cloud
- **Vertex AI** - Gemini 2.0 Flash
- **Firestore** - 인증 데이터 저장
- **Cloud Logging** - 로그 관리

### Slack Integration
- **Slack OAuth 2.0** - 사용자 인증
- **Slack Events API** - Thread 지원
- **Bot + User Token** - 이중 토큰 아키텍처

## 🏗️ 현재 프로젝트 구조

```
writerly/
├── src/
│   ├── simple-oauth-minimal.ts      # 🎯 메인 애플리케이션
│   ├── formatters/
│   │   └── FormatDetector.ts         # 서식 감지기
│   ├── parsers/
│   │   ├── AdvancedSlackParser.ts    # 고급 파싱
│   │   └── mention.parser.ts         # 멘션 파싱
│   ├── prompts/
│   │   └── FormatAwarePrompts.ts     # AI 프롬프트 생성
│   ├── services/
│   │   ├── firestore-auth.service.ts # 인증 서비스
│   │   └── message-updater.service.ts # 메시지 업데이트
│   └── handlers/
│       └── slack-events.handler.ts   # Events API 핸들러
├── DOCS/                             # 핵심 문서
│   ├── PRD.md                        # 제품 요구사항
│   ├── TRD.md                        # 기술 요구사항
│   ├── ADR.md                        # 아키텍처 결정
│   ├── FORMAT_PRESERVATION_TRD.md    # 서식 보존 시스템
│   ├── FIRESTORE_AUTH_TRD.md        # 인증 시스템
│   └── THREAD_SUPPORT_TRD.md        # 스레드 지원
├── package.json
├── tsconfig.json
├── Dockerfile
└── CLAUDE.md                         # AI 어시스턴트 가이드
```

## 🚀 배포 및 실행

### Cloud Run 배포
```bash
# TypeScript 빌드
npm run build

# Cloud Run에 배포
gcloud run deploy writerly \
  --source . \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=your-project-id"
```

### 로컬 개발
```bash
# 의존성 설치
npm install

# 개발 서버 실행
npm run dev

# 빌드 테스트
npm run build
```

### Slack 앱 설정
1. https://api.slack.com/apps에서 새 앱 생성
2. OAuth & Permissions에서 스코프 설정:
   - `chat:write` (Bot Token)
   - `users:read`, `chat:write` (User Token)
3. Slash Commands: `/ai` → `your-service-url/slack/command`
4. Event Subscriptions: `your-service-url/slack/events`
5. 환경변수 설정:
   ```bash
   SLACK_CLIENT_ID=your_client_id
   SLACK_CLIENT_SECRET=your_client_secret
   SLACK_SIGNING_SECRET=your_signing_secret
   SLACK_BOT_TOKEN=your_bot_token
   ```

## 💡 사용법

### 1. 첫 인증
```bash
/ai "테스트" "안녕하세요"
```
→ 인증 버튼 클릭하여 OAuth 완료

### 2. 기본 명령어
```bash
# 번역
/ai "영어로 번역" "안녕하세요"
/ai "일본어로 번역" "Hello world"

# 요약 및 분석
/ai "요약" "긴 텍스트..."
/ai "문법 검토" "영어 문장..."

# 로그아웃
/ai logout
```

### 3. Thread에서 멘션
```bash
@Writerly "중국어로 번역" "Good morning"
```

## 🔧 주요 특징

### Format Preservation System (TRD Phase 1)
- **고급 파싱**: 복잡한 Slack 마크다운 구조 분석
- **서식 감지**: 링크, 이모지, 리스트 등 자동 감지
- **적응형 처리**: 복잡도에 따른 차별화된 AI 프롬프트

### Semi-Permanent Authentication
- **Firestore 저장**: AES-256 암호화된 토큰 저장
- **자동 연장**: 사용 시마다 TTL 자동 갱신  
- **만료 처리**: 토큰 만료 시 자동 재인증 안내

### Thread Support
- **Events API**: `app_mention` 이벤트 처리
- **Message Update**: 실시간 메시지 수정으로 응답
- **Enterprise-grade**: 재시도 로직, Rate Limiting 포함

## 📊 헬스체크

```bash
# 기본 헬스체크
curl https://your-service-url/health

# 인증 시스템 헬스체크  
curl https://your-service-url/health/auth
```

## 📚 참고 문서

- **[FORMAT_PRESERVATION_TRD.md](DOCS/FORMAT_PRESERVATION_TRD.md)** - 서식 보존 시스템 구현
- **[FIRESTORE_AUTH_TRD.md](DOCS/FIRESTORE_AUTH_TRD.md)** - 인증 시스템 구현  
- **[THREAD_SUPPORT_TRD.md](DOCS/THREAD_SUPPORT_TRD.md)** - 스레드 지원 구현
- **[CLAUDE.md](CLAUDE.md)** - AI 어시스턴트 개발 가이드

## 🎯 프로젝트 철학

**"Simplicity, Practicality, Immediate Value for 10-person teams"**

- ✅ **단일 서비스 아키텍처** (복잡성 최소화)
- ✅ **비용 효율적 설계** (10,000자 제한, 예산 알림)
- ✅ **즉시 사용 가능** (복잡한 설정 없이 바로 활용)
- ✅ **한국어 최적화** (완전한 한국어 지원)
- ✅ **TDD 기반 개발** (Red-Green-Refactor)

## 🏆 현재 상태

- **✅ Thread Support** - 멘션 기반 AI 처리
- **✅ Format Preservation** - Slack 서식 보존 시스템
- **✅ Firestore Auth** - 반영구 인증 시스템  
- **✅ Multi-language** - 다국어 번역 지원
- **✅ Production Ready** - Cloud Run 배포 완료

---

**🤖 Built with Claude Code - Smart AI Assistant for Modern Development**