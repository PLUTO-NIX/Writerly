# 배포 체크리스트

Writerly Slack AI 프로젝트의 안전하고 성공적인 배포를 위한 종합 체크리스트입니다.

## 📋 배포 전 필수 체크리스트

### 🔧 개발 환경 준비
- [ ] Node.js 18 이상 설치 확인
- [ ] npm 의존성 설치 완료 (`npm ci`)
- [ ] 환경 변수 설정 완료 (`.env` 파일)
- [ ] gcloud CLI 설치 및 인증 완료
- [ ] Docker 설치 및 실행 확인
- [ ] 프로젝트 루트 디렉토리에서 작업 중

### 📝 코드 품질 검증
- [ ] ESLint 검사 통과 (`npm run lint`)
- [ ] TypeScript 타입 체크 통과 (`npm run typecheck`)
- [ ] 단위 테스트 모두 통과 (`npm run test:unit`)
- [ ] 통합 테스트 모두 통과 (`npm run test:integration`)
- [ ] E2E 테스트 통과 (`npm run test:e2e`)
- [ ] 테스트 커버리지 80% 이상
- [ ] 프로덕션 빌드 성공 (`npm run build`)

### 🔒 보안 검증
- [ ] npm 보안 감사 통과 (`npm audit`)
- [ ] 시크릿 하드코딩 없음 확인
- [ ] 환경 변수로 민감 정보 관리
- [ ] Docker 이미지 보안 스캔 통과 (Trivy)
- [ ] 최소 권한 원칙 적용 확인
- [ ] API 키 및 토큰 Secret Manager 저장

### 🚀 GCP 리소스 준비
- [ ] GCP 프로젝트 생성 및 설정
- [ ] 필수 API 활성화 완료
  - [ ] Cloud Run API
  - [ ] Cloud Build API
  - [ ] Secret Manager API
  - [ ] Vertex AI API
  - [ ] Redis API
  - [ ] Cloud Tasks API
  - [ ] Monitoring API
- [ ] IAM 권한 설정 완료
- [ ] 결제 계정 연결 및 예산 알림 설정

### 🔑 시크릿 관리
- [ ] Slack 앱 생성 및 설정 완료
- [ ] Slack Client ID 확보
- [ ] Slack Client Secret 확보  
- [ ] Slack Signing Secret 확보
- [ ] Secret Manager에 모든 시크릿 저장
- [ ] 서비스 계정 권한 설정

### 📊 모니터링 준비
- [ ] 알림 이메일 주소 준비
- [ ] 슬랙 웹훅 URL 준비 (선택)
- [ ] 긴급 연락처 전화번호 준비 (선택)
- [ ] 모니터링 대시보드 설정
- [ ] 알람 정책 설정
- [ ] 로깅 구성 확인

## 🎯 배포 단계별 체크리스트

### Phase 1: 인프라 설정
```bash
./deploy/deploy.sh -p PROJECT_ID --skip-deploy
```

- [ ] VPC 및 네트워킹 설정 완료
- [ ] Redis (Memorystore) 인스턴스 생성
- [ ] Cloud Tasks 큐 생성
- [ ] Artifact Registry 저장소 생성
- [ ] 네트워크 연결 테스트

### Phase 2: 시크릿 설정
```bash
./deploy/setup-secrets.sh
```

- [ ] 모든 시크릿 생성 확인
- [ ] 서비스 계정 권한 설정
- [ ] 시크릿 접근 테스트
- [ ] IAM 정책 검증

### Phase 3: 모니터링 설정
```bash
./deploy/setup-monitoring.sh -p PROJECT_ID -e EMAIL
```

- [ ] 알림 채널 생성 완료
- [ ] 커스텀 메트릭 정의 등록
- [ ] 알람 정책 배포 완료
- [ ] 대시보드 생성 완료
- [ ] 테스트 알림 발송 확인

### Phase 4: 애플리케이션 배포
```bash
./deploy/deploy.sh -p PROJECT_ID
```

- [ ] Docker 이미지 빌드 성공
- [ ] 보안 스캔 통과
- [ ] Cloud Run 서비스 배포 성공
- [ ] 환경 변수 설정 확인
- [ ] 네트워크 접근 확인

## ✅ 배포 후 검증 체크리스트

### 🔍 기본 서비스 확인
- [ ] 서비스 URL 접근 가능
- [ ] 헬스체크 엔드포인트 정상 (`/health`)
- [ ] 빠른 헬스체크 정상 (`/health/quick`)
- [ ] 준비 상태 확인 정상 (`/ready`)
- [ ] 활성 상태 확인 정상 (`/live`)
- [ ] 메트릭 엔드포인트 정상 (`/metrics`)

### 📱 Slack 통합 테스트
- [ ] Slack 앱 설치 완료
- [ ] OAuth 인증 플로우 테스트
- [ ] 슬래시 명령어 등록 확인
- [ ] Request URL 업데이트 완료
- [ ] 권한 스코프 설정 확인

### 🤖 AI 기능 테스트
- [ ] 기본 AI 명령어 테스트 (`/ai "테스트"`)
- [ ] 다양한 명령어 타입 테스트
- [ ] 긴 텍스트 입력 테스트 (10,000자 제한)
- [ ] 에러 상황 처리 확인
- [ ] 응답 시간 확인 (< 5초)
- [ ] 토큰 사용량 추적 확인

### 📊 모니터링 시스템 확인
- [ ] 실시간 메트릭 수집 확인
- [ ] 대시보드 데이터 표시 확인
- [ ] 로그 정상 출력 확인
- [ ] 알람 정책 작동 테스트
- [ ] 알림 채널 메시지 수신 확인

### 🔄 성능 및 확장성 테스트
- [ ] 동시 요청 처리 확인
- [ ] 자동 스케일링 동작 확인
- [ ] 메모리 사용량 모니터링
- [ ] CPU 사용량 모니터링
- [ ] 응답 시간 벤치마크

## 🚨 비상 대응 체크리스트

### 배포 실패 시
- [ ] 에러 로그 수집 및 분석
- [ ] 이전 버전으로 롤백 준비
- [ ] 관련 팀원들에게 상황 공유
- [ ] 근본 원인 분석 및 기록

### 서비스 장애 시
- [ ] 장애 감지 및 알림 확인
- [ ] 즉시 대응팀 소집
- [ ] 사용자 영향도 평가
- [ ] 임시 조치 또는 롤백 실행
- [ ] 장애 원인 분석 및 개선책 수립

### 롤백 절차
```bash
# 이전 리비전으로 롤백
gcloud run services update-traffic SERVICE_NAME \
  --to-revisions=PREVIOUS_REVISION=100 \
  --region=REGION
```

- [ ] 안정된 이전 버전 식별
- [ ] 트래픽 즉시 이전 버전으로 전환
- [ ] 서비스 정상화 확인
- [ ] 모니터링 메트릭 정상화 확인
- [ ] 사용자 및 관련팀 공지

## 📝 배포 완료 체크리스트

### 문서화
- [ ] 배포 로그 및 결과 기록
- [ ] 서비스 URL 및 접속 정보 정리
- [ ] 모니터링 대시보드 링크 공유
- [ ] 운영 가이드 업데이트
- [ ] 알려진 이슈 및 제한사항 문서화

### 팀 공유
- [ ] 배포 완료 공지
- [ ] 서비스 사용 방법 가이드 공유
- [ ] 모니터링 접근 권한 부여
- [ ] 운영 담당자 지정 및 인수인계
- [ ] 정기 점검 일정 수립

### 지속적 개선
- [ ] 사용자 피드백 수집 계획
- [ ] 성능 최적화 계획 수립
- [ ] 기능 개선 로드맵 검토
- [ ] 보안 점검 일정 수립
- [ ] 정기 업데이트 계획 수립

## 🔗 관련 리소스

### 중요 URL
- **서비스 URL**: `https://SERVICE_NAME-HASH-REGION.a.run.app`
- **대시보드**: `https://console.cloud.google.com/monitoring/dashboards`
- **로그**: `https://console.cloud.google.com/logs/query`
- **Cloud Run**: `https://console.cloud.google.com/run`

### 유용한 명령어
```bash
# 서비스 상태 확인
gcloud run services describe SERVICE_NAME --region=REGION

# 로그 실시간 추적
gcloud logs tail run.googleapis.com%2Fstdout --format=json

# 메트릭 확인
curl https://SERVICE_URL/metrics

# 헬스체크 확인
curl https://SERVICE_URL/health
```

### 연락처
- **개발팀**: devops@company.com
- **운영팀**: ops@company.com  
- **보안팀**: security@company.com
- **비상연락망**: 1588-0000

---

**⚠️ 중요**: 이 체크리스트의 모든 항목을 확인한 후에만 프로덕션 배포를 진행하세요. 문제가 발생할 경우 즉시 롤백할 준비를 하고, 모든 변경사항을 적절히 문서화하세요.