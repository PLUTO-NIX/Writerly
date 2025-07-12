# ✍️ Writerly - Slack AI Message Assistant

[![Python](https://img.shields.io/badge/Python-3.10+-blue.svg)](https://python.org)
[![Flask](https://img.shields.io/badge/Flask-2.0+-green.svg)](https://flask.palletsprojects.com)
[![OpenAI](https://img.shields.io/badge/OpenAI-GPT--3.5--turbo-orange.svg)](https://openai.com)
[![License](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Slack에서 AI를 사용하여 메시지를 처리하고 개선하는 슬랙 앱입니다. 전문적인 톤 변경, 오탈자 수정, 내용 요약, 번역 등 다양한 AI 기능을 제공합니다.

## 🚀 주요 기능

### 🤖 AI 메시지 처리
- **톤 변경**: 전문적인 톤, 친근한 톤으로 메시지 스타일 변환
- **텍스트 개선**: 오탈자 수정, 문법 교정, 표현 개선
- **내용 요약**: 긴 텍스트를 핵심만 간추려 요약
- **다국어 번역**: 한국어 ↔ 영어, 일본어 번역

### 👤 사용자 중심 설계
- **사용자 명의 게시**: 처리된 메시지를 본인 이름으로 자연스럽게 게시
- **OAuth 인증**: 안전한 슬랙 계정 연동
- **개인 프롬프트**: 사용자 정의 AI 프롬프트 생성 및 관리
- **사용량 추적**: 개인별 AI 사용량 및 비용 모니터링

### ⚡ 고성능 아키텍처
- **비동기 처리**: Celery + Redis로 빠른 응답과 안정성 보장
- **확장 가능**: 마이크로서비스 아키텍처로 설계
- **모니터링**: 실시간 사용량 추적 및 에러 핸들링

## 🏗️ 기술 스택

| 구분 | 기술 | 용도 |
|------|------|------|
| **Backend** | Flask | 웹 서버 및 API |
| **Task Queue** | Celery + Redis | 비동기 작업 처리 |
| **Database** | PostgreSQL + SQLAlchemy | 데이터 저장 |
| **AI Engine** | OpenAI GPT-3.5-turbo | 텍스트 처리 |
| **Authentication** | Slack OAuth 2.0 | 사용자 인증 |
| **Container** | Docker + Docker Compose | 개발 환경 |

## 📋 사전 요구사항

- **Python**: 3.10 이상
- **Redis**: 6.0 이상 (Task Queue)
- **PostgreSQL**: 13 이상 (또는 SQLite)
- **Docker**: 20.10 이상 (선택사항)

## 🚀 빠른 시작

### 1️⃣ 프로젝트 클론

```bash
git clone https://github.com/your-username/writerly.git
cd writerly
```

### 2️⃣ 가상환경 설정

```bash
# 가상환경 생성
python -m venv writerly_env

# 가상환경 활성화
# Windows
writerly_env\Scripts\activate
# macOS/Linux
source writerly_env/bin/activate
```

### 3️⃣ 의존성 설치

```bash
pip install -r requirements.txt
```

### 4️⃣ 환경변수 설정

```bash
# 환경변수 파일 복사
cp .env.example .env

# .env 파일 수정
# SLACK_BOT_TOKEN=xoxb-your-bot-token
# SLACK_CLIENT_ID=your-client-id
# SLACK_CLIENT_SECRET=your-client-secret
# OPENAI_API_KEY=your-openai-api-key
```

### 5️⃣ 데이터베이스 초기화

```bash
# 테이블 생성
python migrate.py create

# 테스트 데이터 생성 (선택사항)
python migrate.py test-data
```

### 6️⃣ 애플리케이션 실행

```bash
# Flask 앱 실행
python app.py

# 새 터미널에서 Celery 워커 실행
python run_worker.py
```

## 🐳 Docker로 실행

```bash
# 개발 환경 실행
docker-compose -f docker-compose.dev.yml up -d

# 로그 확인
docker-compose -f docker-compose.dev.yml logs -f
```

## 📱 사용법

### 기본 명령어

| 명령어 | 설명 | 예시 |
|--------|------|------|
| `/ai` | AI 처리 모달 열기 | `/ai` |
| `/ai [텍스트]` | 기본 프롬프트로 직접 처리 | `/ai 안녕하세요 회의 요약 부탁드립니다` |
| `/ai-prompts` | 사용자 정의 프롬프트 관리 | `/ai-prompts` |

### GUI 모드 (모달)

1. `/ai` 명령어 입력
2. 모달에서 처리할 텍스트 입력
3. 처리 방식 선택 (전문적인 톤, 친근한 톤, 요약 등)
4. "처리하기" 버튼 클릭

### CLI 모드 (직접 입력)

```bash
# 전문적인 톤으로 변경
/ai "professional" 회의 결과를 공유드립니다

# 내용 요약
/ai "summarize" 긴 텍스트 내용...

# 사용자 정의 프롬프트 사용
/ai "회의록 요약" 오늘 회의 내용...
```

## 🛠️ 개발 도구

### 데이터베이스 관리

```bash
# 테이블 생성
python migrate.py create

# 테이블 삭제
python migrate.py drop

# 테이블 리셋
python migrate.py reset

# 테이블 정보 확인
python migrate.py info

# 연결 상태 확인
python migrate.py check
```

### API 엔드포인트

| 엔드포인트 | 설명 |
|------------|------|
| `GET /health` | 애플리케이션 상태 확인 |
| `GET /test/celery` | Celery 연결 테스트 |
| `GET /slack/usage` | 사용량 통계 조회 |
| `GET /auth/slack/oauth/info` | OAuth 인증 페이지 |

## 📂 프로젝트 구조

```
writerly/
├── app.py                 # Flask 앱 진입점
├── config.py              # 설정 관리
├── database.py            # 데이터베이스 연결 관리
├── migrate.py             # 데이터베이스 마이그레이션
├── celery_app.py          # Celery 설정
├── run_worker.py          # Celery 워커 실행
├── requirements.txt       # 패키지 의존성
├── .env.example          # 환경 변수 예시
├── models/               # 데이터베이스 모델
│   ├── __init__.py
│   ├── base.py          # 기본 모델 클래스
│   ├── user.py          # 사용자 모델
│   ├── prompt.py        # 프롬프트 모델
│   └── usage_log.py     # 사용량 로그 모델
├── routes/               # API 라우트
│   ├── __init__.py
│   ├── slack.py         # 슬랙 관련 라우트
│   └── auth.py          # 인증 관련 라우트
├── services/             # 비즈니스 로직
│   ├── __init__.py
│   └── ai_service.py    # AI 텍스트 처리 서비스
├── tasks/                # Celery 작업
│   ├── __init__.py
│   └── ai_tasks.py      # AI 처리 태스크
├── utils/                # 유틸리티 함수
│   ├── __init__.py
│   ├── crypto.py        # 암호화/복호화
│   ├── logger.py        # 로깅 설정
│   ├── redis_client.py  # Redis 클라이언트
│   ├── slack_utils.py   # 슬랙 유틸리티
│   ├── retry_utils.py   # 재시도 로직
│   ├── usage_tracker.py # 사용량 추적
│   └── auth_middleware.py # 인증 미들웨어
├── tests/                # 테스트 파일
│   ├── __init__.py
│   ├── test_routes.py
│   └── test_services.py
└── docs/                 # 문서
    ├── api.md
    ├── deployment.md
    └── slack-app-setup.md
```

## 📊 현재 개발 진행 상황

### ✅ 완료된 기능 (Phase 1 & 2)

- [x] **기본 인프라** (20/20 태스크)
  - [x] 프로젝트 초기 설정
  - [x] 슬랙 앱 기본 연동
  - [x] 비동기 처리 시스템
  - [x] OpenAI API 연동

- [x] **사용자 인증 및 권한** (10/10 태스크)
  - [x] 데이터베이스 설계 및 구축
  - [x] OAuth 인증 플로우
  - [x] 권한 검증 미들웨어
  - [x] 사용자별 메시지 게시

### 🚧 진행 중 (Phase 3)

- [ ] **GUI 기능 완성** (0/15 태스크)
  - [ ] 모달 인터페이스 고도화
  - [ ] 프롬프트 관리 시스템
  - [ ] 사용량 모니터링 대시보드

**전체 진행률: 30/94 태스크 (31.9%)**

## 🤝 기여하기

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📄 라이선스

이 프로젝트는 MIT 라이선스 하에 있습니다. 자세한 내용은 [LICENSE](LICENSE) 파일을 참조하세요.

## 🙏 감사의 말

- [OpenAI](https://openai.com) - AI 엔진 제공
- [Slack](https://slack.com) - 플랫폼 및 API 제공
- [Flask](https://flask.palletsprojects.com) - 웹 프레임워크
- [Celery](https://celeryproject.org) - 비동기 작업 큐

## 📞 지원

문제나 제안사항이 있으시면:

- [Issues](https://github.com/your-username/writerly/issues) 페이지에 등록해주세요
- [Wiki](https://github.com/your-username/writerly/wiki) 문서를 참조하세요

---

**Writerly**로 더 나은 슬랙 커뮤니케이션을 경험하세요! ✨ 