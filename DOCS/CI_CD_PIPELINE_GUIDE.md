# CI/CD 파이프라인 가이드

이 문서는 Writerly Slack AI 프로젝트의 CI/CD 파이프라인 설정, 검증, 그리고 운영 방법을 설명합니다.

## 📋 목차

1. [파이프라인 개요](#파이프라인-개요)
2. [구성 요소](#구성-요소)
3. [배포 프로세스](#배포-프로세스)
4. [검증 및 테스트](#검증-및-테스트)
5. [모니터링](#모니터링)
6. [트러블슈팅](#트러블슈팅)

## 🎯 파이프라인 개요

### 설계 원칙
- **DevSecOps 통합**: 보안이 내장된 파이프라인
- **자동화 우선**: 수동 개입 최소화
- **빠른 피드백**: 문제를 조기에 발견
- **점진적 배포**: 위험을 최소화하는 단계별 배포
- **모니터링 중심**: 실시간 상태 추적

### 파이프라인 단계
```
개발 → 커밋 → CI → 빌드 → 테스트 → 보안스캔 → 배포 → 모니터링
```

## 🔧 구성 요소

### 1. GitHub Actions (CI)
**위치**: `.github/workflows/ci.yml`

**주요 기능**:
- 코드 품질 검사 (ESLint, TypeScript)
- 보안 스캔 (npm audit)
- 단위/통합 테스트 실행
- Docker 이미지 빌드
- Trivy 보안 스캔

**트리거**:
- `push` to `main`, `develop`
- `pull_request` to `main`, `develop`
- 수동 실행 (`workflow_dispatch`)

### 2. Google Cloud Build (CD)
**위치**: `deploy/cloudbuild.yaml`

**주요 기능**:
- 프로덕션 이미지 빌드
- 보안 스캔 (Trivy, GCP Container Analysis)
- Cloud Run 배포
- 배포 후 검증

**12단계 파이프라인**:
1. 종속성 설치
2. TypeScript 컴파일 
3. 단위 테스트
4. 보안 스캔 (npm audit)
5. 프로덕션 빌드
6. Docker 이미지 빌드
7. 이미지 보안 스캔 (Trivy)
8. 이미지 푸시 (Artifact Registry)
9. Cloud Run 배포
10. 헬스체크 검증
11. 통합 테스트
12. 배포 완료 알림

### 3. 배포 스크립트
**위치**: `deploy/deploy.sh`

**기능**:
- 원스톱 배포 솔루션
- 인프라 설정 (VPC, Redis, Cloud Tasks)
- 시크릿 관리
- 환경별 설정 관리
- 배포 검증

## 🚀 배포 프로세스

### 1. 로컬 개발 환경 설정
```bash
# 의존성 설치
npm ci

# 환경 설정
cp .env.example .env

# 개발 서버 실행
npm run dev
```

### 2. 코드 품질 검증
```bash
# 린트 및 타입 체크
npm run lint
npm run typecheck

# 테스트 실행
npm run test:unit
npm run test:integration
npm run test:e2e
```

### 3. 파이프라인 검증
```bash
# 전체 파이프라인 검증
./scripts/verify-pipeline.sh

# 특정 단계만 검증
./scripts/verify-pipeline.sh --skip-build --skip-deploy
```

### 4. 시크릿 설정 (최초 1회)
```bash
# 시크릿 설정
./deploy/setup-secrets.sh
```

### 5. 모니터링 설정 (최초 1회)
```bash
# 모니터링 시스템 설정
./deploy/setup-monitoring.sh -p PROJECT_ID -e devops@company.com
```

### 6. 애플리케이션 배포
```bash
# 프로덕션 배포
./deploy/deploy.sh -p PROJECT_ID

# 스테이징 배포
./deploy/deploy.sh -p PROJECT_ID-staging -e staging
```

## ✅ 검증 및 테스트

### 자동 검증 스크립트
`scripts/verify-pipeline.sh`는 다음을 검증합니다:

#### 1. 개발 환경 검증
- Node.js 18+ 버전 확인
- npm 패키지 설치 확인
- TypeScript 컴파일 성공
- ESLint 코드 품질 검사
- 보안 감사 (npm audit)

#### 2. 빌드 프로세스 검증
- 프로덕션 빌드 성공
- 빌드 결과물 존재 확인
- Docker 이미지 빌드 성공
- 이미지 크기 확인

#### 3. 테스트 스위트 검증
- 단위 테스트 실행
- 통합 테스트 실행
- E2E 테스트 실행
- 테스트 커버리지 확인

#### 4. 보안 스캔 검증
- 의존성 취약점 스캔
- Docker 이미지 보안 스캔 (Trivy)
- 시크릿 패턴 검사

#### 5. GCP 리소스 검증
- gcloud 인증 확인
- 필수 API 활성화 확인
- Secret Manager 시크릿 확인
- Cloud Run 서비스 확인

### 수동 테스트 체크리스트

#### 🔍 배포 전 체크리스트
- [ ] 모든 테스트 통과
- [ ] 코드 리뷰 완료
- [ ] 보안 스캔 통과
- [ ] 환경 변수 확인
- [ ] 시크릿 설정 완료
- [ ] 모니터링 대시보드 확인

#### 🚀 배포 후 체크리스트
- [ ] 서비스 헬스체크 통과 (`/health`)
- [ ] 로그 에러 없음
- [ ] 모니터링 메트릭 정상
- [ ] Slack 앱 연동 테스트
- [ ] AI 응답 테스트
- [ ] 알람 정책 작동 확인

## 📊 모니터링

### 1. 실시간 모니터링
- **Cloud Run 대시보드**: 요청 수, 응답 시간, 에러율
- **커스텀 대시보드**: AI 요청, 토큰 사용량, 비즈니스 메트릭
- **로그 모니터링**: 구조화된 로그 분석

### 2. 알람 정책
- **CRITICAL**: 높은 에러율 (>5%), 서비스 다운
- **WARNING**: 응답 시간 지연 (>5초), 높은 메모리 사용률
- **INFO**: 비정상적인 토큰 사용량

### 3. 헬스체크 엔드포인트
- `/health`: 전체 시스템 헬스체크
- `/health/quick`: 빠른 헬스체크 (로드밸런서용)
- `/ready`: 준비 상태 확인 (Kubernetes readiness)
- `/live`: 활성 상태 확인 (Kubernetes liveness)
- `/metrics`: Prometheus 스타일 메트릭

## 🔧 트러블슈팅

### 일반적인 문제 및 해결책

#### 빌드 실패
```bash
# 캐시 정리
npm run clean
rm -rf node_modules package-lock.json
npm ci

# TypeScript 타입 오류
npm run typecheck
```

#### 테스트 실패
```bash
# 테스트 환경 초기화
npm run test:clean

# 특정 테스트 디버깅
npm run test:unit -- --verbose
```

#### 배포 실패
```bash
# 권한 확인
gcloud auth list
gcloud projects get-iam-policy PROJECT_ID

# API 활성화 확인
gcloud services list --enabled

# 시크릿 확인
gcloud secrets list
```

#### 서비스 응답 없음
```bash
# 서비스 로그 확인
gcloud logs read 'resource.type=cloud_run_revision' --limit=50

# 서비스 상태 확인
gcloud run services describe SERVICE_NAME --region=REGION

# 헬스체크 확인
curl https://SERVICE_URL/health
```

### 로그 분석

#### 중요한 로그 패턴
```bash
# 에러 로그 검색
gcloud logs read 'severity>=ERROR' --limit=20

# AI 요청 추적
gcloud logs read 'jsonPayload.requestId="req_123"'

# 성능 이슈 검색
gcloud logs read 'jsonPayload.duration>5000'
```

#### 메트릭 쿼리 예제
```sql
-- 에러율 계산
sum(rate(http_requests_total{status_code!~"2.."}[5m])) / 
sum(rate(http_requests_total[5m])) * 100

-- 평균 응답 시간
avg(http_request_duration_seconds) by (endpoint)

-- 토큰 사용량 추이
sum(rate(tokens_used_total[1h])) by (type)
```

## 🚀 고급 운영

### A/B 테스트 배포
```bash
# 트래픽 분할 배포
gcloud run services update-traffic SERVICE_NAME \
  --to-revisions=REVISION-1=50,REVISION-2=50
```

### 롤백 절차
```bash
# 이전 리비전으로 롤백
gcloud run services update-traffic SERVICE_NAME \
  --to-revisions=PREVIOUS_REVISION=100

# 빠른 롤백 (마지막 안정 버전)
./deploy/deploy.sh -p PROJECT_ID --rollback
```

### 스케일링 설정
```bash
# 최소/최대 인스턴스 설정
gcloud run services update SERVICE_NAME \
  --min-instances=1 \
  --max-instances=100
```

## 📚 참고 자료

- [Google Cloud Run 문서](https://cloud.google.com/run/docs)
- [GitHub Actions 문서](https://docs.github.com/en/actions)
- [Cloud Build 문서](https://cloud.google.com/build/docs)
- [Cloud Monitoring 문서](https://cloud.google.com/monitoring/docs)
- [프로젝트 ADR.md](./ADR.md) - 아키텍처 결정 기록
- [프로젝트 TRD.md](./TRD.md) - 기술 요구사항 문서