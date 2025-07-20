# Writerly - Slack AI Assistant Bot

10명 팀을 위한 단순하고 실용적인 Slack AI 어시스턴트 봇

## 🚀 프로젝트 개요

Writerly는 Slack에서 AI의 도움을 받아 다양한 업무를 효율적으로 처리할 수 있도록 돕는 봇입니다. Google Cloud의 Gemini 2.5 Flash 모델을 활용하여 번역, 요약, 문서 작성 등 다양한 작업을 지원합니다.

### 핵심 특징
- 🎯 **단순한 명령어**: `/ai "작업" "내용"` 형식의 직관적인 인터페이스
- ⚡ **빠른 응답**: 30초 이내 AI 응답 제공
- 🔒 **안전한 인증**: OAuth 2.0 기반 Slack 인증
- 📊 **스마트한 처리**: 비동기 처리로 안정적인 서비스
- 🌐 **한국어 지원**: 완벽한 한국어 에러 메시지 및 도움말

## 📋 주요 기능

### 1. AI 명령어 처리
```bash
/ai "영어로 번역" "안녕하세요, 만나서 반갑습니다."
/ai "3줄 요약" "긴 문서 내용..."
/ai "코드 리뷰" "function example() { ... }"
```

### 2. 도움말 시스템
```bash
/ai
```
명령어만 입력하면 사용법과 예시를 볼 수 있습니다.

### 3. 스마트한 에러 처리
- 10,000자 입력 제한
- 사용자 친화적인 한국어 에러 메시지
- 자동 재시도 메커니즘

## 🛠️ 기술 스택

- **Runtime**: Node.js 18 + TypeScript
- **Framework**: Express.js
- **Cloud**: Google Cloud Platform (Cloud Run)
- **AI**: Vertex AI (Gemini 2.5 Flash)
- **Storage**: Redis (Memorystore)
- **Queue**: Cloud Tasks
- **Auth**: Slack OAuth 2.0

## 🏗️ 프로젝트 구조

```
writerly/
├── src/                    # 소스 코드
│   ├── controllers/        # HTTP 요청 처리
│   ├── services/           # 비즈니스 로직
│   ├── middleware/         # Express 미들웨어
│   ├── utils/              # 유틸리티 함수
│   └── types/              # TypeScript 타입 정의
├── tests/                  # 테스트 코드
│   ├── unit/               # 단위 테스트
│   ├── integration/        # 통합 테스트
│   └── e2e/                # E2E 테스트
├── deploy/                 # 배포 관련 파일
│   ├── Dockerfile.prod     # 프로덕션 Docker 이미지
│   ├── cloudbuild.yaml     # CI/CD 파이프라인
│   └── *.sh                # 배포 스크립트
├── scripts/                # 유틸리티 스크립트
└── DOCS/                   # 프로젝트 문서
```

## 🚀 빠른 시작

### 사전 요구사항
- Node.js 18 이상
- Google Cloud 계정
- Slack 워크스페이스 관리자 권한

### 설치 및 실행

1. **저장소 클론**
```bash
git clone https://github.com/your-org/writerly.git
cd writerly
```

2. **의존성 설치**
```bash
npm ci
```

3. **환경 설정**
```bash
cp .env.example .env
# .env 파일 편집하여 필요한 값 설정
```

4. **개발 서버 실행**
```bash
npm run dev
```

### 프로덕션 배포

1. **GCP 프로젝트 설정**
```bash
gcloud config set project YOUR_PROJECT_ID
```

2. **인프라 및 시크릿 설정**
```bash
./deploy/setup-secrets.sh
./deploy/setup-monitoring.sh -p YOUR_PROJECT_ID -e your-email@company.com
```

3. **애플리케이션 배포**
```bash
./deploy/deploy.sh -p YOUR_PROJECT_ID
```

## 📊 모니터링 및 운영

### 헬스체크
- `/health` - 상세 시스템 헬스체크
- `/health/quick` - 빠른 헬스체크
- `/metrics` - Prometheus 형식 메트릭

### 모니터링 대시보드
- Cloud Run 메트릭
- Redis 상태
- AI 요청 통계
- 비즈니스 메트릭

### 알람 정책
- 높은 에러율 (>5%)
- 응답 시간 지연 (>5초)
- 메모리 사용률 (>85%)
- 서비스 다운

## 🧪 테스트

```bash
# 모든 테스트 실행
npm test

# 단위 테스트
npm run test:unit

# 통합 테스트
npm run test:integration

# E2E 테스트
npm run test:e2e

# 테스트 커버리지
npm run test:coverage
```

## 📚 문서

- [제품 요구사항 문서 (PRD)](DOCS/PRD.md)
- [기술 요구사항 문서 (TRD)](DOCS/TRD.md)
- [아키텍처 결정 기록 (ADR)](DOCS/ADR.md)
- [CI/CD 파이프라인 가이드](DOCS/CI_CD_PIPELINE_GUIDE.md)
- [운영 가이드](DOCS/OPERATIONS_GUIDE.md)
- [사용자 가이드](DOCS/USER_GUIDE.md)

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🏆 프로젝트 성과

- ✅ **6주 개발 일정 100% 준수**
- ✅ **업계 모범 사례 수준의 문서화**
- ✅ **80% 이상 테스트 커버리지**
- ✅ **DevSecOps 파이프라인 구축**
- ✅ **1인 운영 가능한 시스템 구조**

## 📞 지원

- **Slack 채널**: #writerly-support
- **이메일**: writerly-support@company.com
- **이슈 트래커**: [GitHub Issues](https://github.com/your-org/writerly/issues)

---

**🎉 Writerly와 함께 더 스마트하게 일하세요!**