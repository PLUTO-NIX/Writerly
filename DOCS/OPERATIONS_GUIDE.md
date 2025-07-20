# 운영 가이드

Writerly Slack AI Bot의 일상 운영, 모니터링, 문제 해결을 위한 종합 가이드입니다.

## 📋 목차

1. [일일 운영 체크리스트](#일일-운영-체크리스트)
2. [모니터링](#모니터링)
3. [문제 해결](#문제-해결)
4. [유지보수](#유지보수)
5. [비상 대응](#비상-대응)
6. [비용 관리](#비용-관리)
7. [사용자 지원](#사용자-지원)
8. [운영 자동화](#운영-자동화)

## 🌅 일일 운영 체크리스트

### 오전 점검 (09:00)
```bash
# 1. 서비스 상태 확인
curl https://SERVICE_URL/health

# 2. 에러 로그 확인
gcloud logs read 'severity>=ERROR' --limit=10 --format=json

# 3. 모니터링 대시보드 확인
# https://console.cloud.google.com/monitoring/dashboards

# 4. 알람 확인
# 이메일 및 슬랙 알람 채널 확인
```

### 오후 점검 (17:00)
```bash
# 1. 사용량 통계 확인
gcloud logs read 'jsonPayload.type="ai_request"' \
  --format="value(jsonPayload.team_id)" | sort | uniq -c

# 2. 성능 메트릭 확인
./scripts/check-performance.sh

# 3. 비용 확인
gcloud billing accounts list
```

### 주간 점검 (매주 월요일)
- [ ] 주간 사용량 리포트 생성
- [ ] 보안 업데이트 확인
- [ ] 백업 상태 확인
- [ ] 사용자 피드백 검토
- [ ] 비용 트렌드 분석

## 📊 모니터링

### 1. 실시간 모니터링

#### 헬스체크 모니터링
```bash
# 헬스체크 스크립트
#!/bin/bash
while true; do
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" https://SERVICE_URL/health)
  if [ $STATUS -ne 200 ]; then
    echo "$(date): Health check failed with status $STATUS"
    # 알림 발송
  fi
  sleep 60
done
```

#### 로그 실시간 추적
```bash
# 에러 로그 실시간 모니터링
gcloud logs tail "severity>=ERROR" --format=json

# AI 요청 실시간 모니터링
gcloud logs tail 'jsonPayload.type="ai_request"' --format=json

# 특정 사용자 추적
gcloud logs tail 'jsonPayload.user_id="U12345"' --format=json
```

### 2. 핵심 메트릭

#### 시스템 메트릭
- **응답 시간**: 목표 < 5초
- **에러율**: 목표 < 5%
- **가용성**: 목표 > 99%
- **메모리 사용률**: 경고 > 80%

#### 비즈니스 메트릭
- **일일 활성 사용자**: 목표 > 5명
- **일일 요청 수**: 목표 50-100건
- **성공률**: 목표 > 95%
- **평균 처리 시간**: 목표 < 30초

### 3. 알람 대응

#### 높은 에러율 (CRITICAL)
```bash
# 1. 에러 로그 분석
gcloud logs read 'severity>=ERROR' --limit=50 --format=json | jq '.jsonPayload'

# 2. 최근 배포 확인
gcloud run revisions list --service=writerly-slack-ai

# 3. 필요시 롤백
gcloud run services update-traffic writerly-slack-ai \
  --to-revisions=PREVIOUS_REVISION=100
```

#### 응답 시간 지연 (WARNING)
```bash
# 1. 부하 상태 확인
gcloud monitoring read run.googleapis.com/request_count \
  --filter='resource.service_name="writerly-slack-ai"'

# 2. 인스턴스 스케일링 확인
gcloud run services describe writerly-slack-ai \
  --format="value(spec.template.metadata.annotations)"

# 3. Redis 연결 상태 확인
gcloud redis instances describe writerly-redis --region=us-central1
```

## 🔧 문제 해결

### 일반적인 문제와 해결책

#### 1. "서비스가 응답하지 않습니다"
```bash
# 진단 절차
1. 서비스 상태 확인
   gcloud run services describe writerly-slack-ai --region=us-central1

2. 최근 로그 확인
   gcloud logs read --limit=50 --format=json

3. 컨테이너 재시작
   gcloud run services update writerly-slack-ai --no-traffic

4. 트래픽 복구
   gcloud run services update-traffic writerly-slack-ai --to-latest
```

#### 2. "AI 응답이 느립니다"
```bash
# 진단 절차
1. Vertex AI 할당량 확인
   gcloud services quota list --service=aiplatform.googleapis.com

2. 토큰 사용량 확인
   gcloud logs read 'jsonPayload.tokens_used>0' --format=json | \
     jq '.jsonPayload.tokens_used' | awk '{sum+=$1} END {print sum}'

3. Redis 성능 확인
   gcloud redis instances describe writerly-redis \
     --format="value(memoryUsageRatio)"
```

#### 3. "인증이 실패합니다"
```bash
# 진단 절차
1. Secret Manager 확인
   gcloud secrets versions list slack-client-secret

2. Slack 앱 설정 확인
   # Slack 앱 관리 페이지에서 OAuth 설정 확인

3. 세션 만료 확인
   gcloud logs read 'jsonPayload.error="session_expired"' --limit=10
```

### 디버깅 도구

#### 로그 분석 쿼리
```bash
# 가장 빈번한 에러 찾기
gcloud logs read 'severity>=ERROR' --format=json | \
  jq -r '.jsonPayload.error' | sort | uniq -c | sort -nr | head -10

# 느린 요청 찾기
gcloud logs read 'jsonPayload.duration>5000' --format=json | \
  jq '.jsonPayload | {user: .user_id, duration: .duration, timestamp: .timestamp}'

# 특정 시간대 분석
gcloud logs read 'timestamp>="2024-01-20T09:00:00Z" AND timestamp<="2024-01-20T10:00:00Z"'
```

## 🛠️ 유지보수

### 정기 유지보수 작업

#### 주간 작업
1. **로그 정리**
   ```bash
   # 오래된 로그 정리 (GCP는 자동으로 처리하지만 커스텀 로그 확인)
   find /var/log/writerly -mtime +30 -delete 2>/dev/null || true
   ```

2. **보안 업데이트**
   ```bash
   # 의존성 보안 감사
   cd /path/to/writerly
   npm audit
   
   # 보안 업데이트 적용
   npm audit fix
   ```

3. **백업 확인**
   ```bash
   # Redis 백업 확인
   gcloud redis instances export writerly-redis \
     --export-file=gs://writerly-backups/redis-$(date +%Y%m%d).rdb
   ```

#### 월간 작업
1. **성능 최적화**
   ```bash
   # 사용 패턴 분석
   ./scripts/analyze-usage-patterns.sh
   
   # 인덱스 최적화
   ./scripts/optimize-indexes.sh
   ```

2. **비용 검토**
   ```bash
   # 월간 비용 리포트
   gcloud billing accounts get-iam-policy BILLING_ACCOUNT_ID
   ```

3. **용량 계획**
   ```bash
   # 성장 추세 분석
   ./scripts/capacity-planning.sh
   ```

### 업데이트 절차

#### 1. 마이너 업데이트
```bash
# 1. 코드 업데이트
git pull origin main

# 2. 테스트 실행
npm test

# 3. 스테이징 배포
./deploy/deploy.sh -p PROJECT_ID-staging

# 4. 검증 후 프로덕션 배포
./deploy/deploy.sh -p PROJECT_ID
```

#### 2. 메이저 업데이트
```bash
# 1. 사전 공지 (1주일 전)
./scripts/send-maintenance-notice.sh

# 2. 백업 생성
./scripts/create-full-backup.sh

# 3. 카나리 배포
gcloud run services update-traffic writerly-slack-ai \
  --to-revisions=NEW_REVISION=10,OLD_REVISION=90

# 4. 점진적 롤아웃
./scripts/gradual-rollout.sh
```

## 🚨 비상 대응

### 비상 상황별 대응 절차

#### 1. 서비스 전체 장애
```bash
#!/bin/bash
# emergency-response.sh

# 1. 즉시 이전 버전으로 롤백
gcloud run services update-traffic writerly-slack-ai \
  --to-revisions=LAST_STABLE_REVISION=100 \
  --region=us-central1

# 2. 팀 알림
curl -X POST $SLACK_WEBHOOK_URL \
  -H 'Content-type: application/json' \
  -d '{"text":"🚨 긴급: Writerly 서비스 장애 발생. 롤백 진행 중."}'

# 3. 상태 페이지 업데이트
echo "서비스 장애 발생. 복구 작업 진행 중. ETA: 30분" > /tmp/status.txt
gsutil cp /tmp/status.txt gs://writerly-status/index.html

# 4. 근본 원인 분석 시작
./scripts/collect-diagnostics.sh
```

#### 2. 데이터 유실
```bash
# 1. 서비스 중단
gcloud run services update writerly-slack-ai --no-traffic

# 2. 백업에서 복구
gcloud redis instances import writerly-redis \
  --import-file=gs://writerly-backups/redis-latest.rdb

# 3. 데이터 무결성 확인
./scripts/verify-data-integrity.sh

# 4. 서비스 재개
gcloud run services update-traffic writerly-slack-ai --to-latest
```

#### 3. 보안 침해
```bash
# 1. 즉시 격리
gcloud run services update writerly-slack-ai --no-traffic

# 2. 모든 시크릿 로테이션
./scripts/rotate-all-secrets.sh

# 3. 감사 로그 수집
gcloud logging read 'protoPayload.@type="type.googleapis.com/google.cloud.audit.AuditLog"' \
  --format=json > security-audit.json

# 4. 보안 팀 에스컬레이션
./scripts/escalate-to-security.sh
```

### 연락처
- **1차 대응**: DevOps 팀장 (010-1234-5678)
- **2차 대응**: CTO (010-8765-4321)
- **보안 사고**: Security Team (security@company.com)
- **외부 지원**: Google Cloud Support (1-844-613-7589)

## 💰 비용 관리

### 비용 모니터링
```bash
# 일일 비용 확인
gcloud billing budgets list

# 서비스별 비용 분석
gcloud billing accounts list

# 예상 비용 계산
./scripts/calculate-monthly-cost.sh
```

### 비용 최적화
1. **Cloud Run 최적화**
   - 최소 인스턴스: 0 (콜드 스타트 허용)
   - 최대 인스턴스: 10
   - 메모리: 512MB (충분한 경우)

2. **Redis 최적화**
   - 메모리 크기: 1GB (Basic tier)
   - 자동 확장 비활성화

3. **Vertex AI 최적화**
   - 입력 제한: 10,000자
   - 캐싱 활용
   - 배치 처리 고려

## 👥 사용자 지원

### 지원 채널
1. **Slack 채널**: #writerly-support
2. **이메일**: writerly-support@company.com
3. **문서**: https://docs.company.com/writerly

### 자주 묻는 질문 (FAQ)

#### Q: AI가 응답하지 않아요
A: 다음을 확인해주세요:
1. `/ai` 명령어 형식이 올바른지 확인
2. 입력 텍스트가 10,000자 이하인지 확인
3. 30초 정도 기다려주세요
4. 문제가 지속되면 #writerly-support로 문의

#### Q: 인증이 계속 실패해요
A: Slack 앱을 재설치해보세요:
1. Slack 워크스페이스 설정 → 앱 관리
2. Writerly 앱 제거
3. 다시 설치 링크 클릭

#### Q: AI 응답이 이상해요
A: 프롬프트를 더 구체적으로 작성해보세요:
- 나쁜 예: `/ai "번역" "안녕"`
- 좋은 예: `/ai "영어로 번역" "안녕하세요, 반갑습니다"`

### 사용자 교육
```markdown
# Writerly 사용 가이드

## 기본 사용법
/ai "작업" "내용"

## 예시
- 번역: /ai "영어로 번역" "안녕하세요"
- 요약: /ai "3줄 요약" "긴 텍스트..."
- 검토: /ai "문법 검토" "텍스트..."

## 도움말
/ai (엔터)
```

## 🤖 운영 자동화

### 자동화 스크립트

#### 1. 일일 리포트 생성
```bash
#!/bin/bash
# daily-report.sh

DATE=$(date +%Y-%m-%d)
REPORT_FILE="daily-report-$DATE.md"

cat > $REPORT_FILE << EOF
# Writerly 일일 운영 리포트
날짜: $DATE

## 핵심 지표
- 활성 사용자: $(gcloud logs read 'jsonPayload.type="ai_request"' --format="value(jsonPayload.user_id)" | sort -u | wc -l)명
- 총 요청 수: $(gcloud logs read 'jsonPayload.type="ai_request"' --format=json | wc -l)건
- 평균 응답 시간: $(gcloud logs read 'jsonPayload.duration>0' --format="value(jsonPayload.duration)" | awk '{sum+=$1; count++} END {print sum/count/1000 "초"}')
- 에러율: $(calculate_error_rate.sh)%

## 주요 이슈
$(gcloud logs read 'severity>=ERROR' --limit=5 --format=text)

## 비용
예상 일일 비용: \$$(calculate_daily_cost.sh)
EOF

# 리포트 전송
./send-report.sh $REPORT_FILE
```

#### 2. 자동 스케일링 조정
```bash
#!/bin/bash
# auto-scale.sh

# 사용량에 따른 자동 스케일링
CURRENT_HOUR=$(date +%H)
if [ $CURRENT_HOUR -ge 9 ] && [ $CURRENT_HOUR -le 18 ]; then
  # 업무 시간: 최소 인스턴스 1개
  gcloud run services update writerly-slack-ai --min-instances=1
else
  # 비업무 시간: 최소 인스턴스 0개
  gcloud run services update writerly-slack-ai --min-instances=0
fi
```

#### 3. 백업 자동화
```bash
#!/bin/bash
# auto-backup.sh

# Redis 백업
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
gcloud redis instances export writerly-redis \
  --export-file=gs://writerly-backups/redis-$TIMESTAMP.rdb

# 설정 백업
gsutil cp -r gs://writerly-configs gs://writerly-backups/configs-$TIMESTAMP/

# 오래된 백업 정리 (30일 이상)
gsutil ls gs://writerly-backups/ | while read backup; do
  AGE=$(gsutil stat $backup | grep "Creation time" | awk '{print $3}')
  # 30일 이상된 백업 삭제 로직
done
```

### Cron 작업 설정
```yaml
# cron.yaml
cron:
  - description: "일일 리포트 생성"
    url: /admin/daily-report
    schedule: every day 09:00
    timezone: Asia/Seoul
    
  - description: "주간 백업"
    url: /admin/backup
    schedule: every sunday 02:00
    timezone: Asia/Seoul
    
  - description: "비용 알림"
    url: /admin/cost-alert
    schedule: every day 10:00
    timezone: Asia/Seoul
```

## 📈 지속적 개선

### 월간 검토 항목
1. **성능 개선 기회**
   - 느린 쿼리 분석
   - 캐싱 기회 식별
   - 코드 최적화 포인트

2. **사용자 경험 개선**
   - 사용자 피드백 분석
   - 오류 메시지 개선
   - 응답 시간 단축

3. **운영 효율성**
   - 자동화 기회 식별
   - 프로세스 개선
   - 도구 업그레이드

### KPI 추적
```sql
-- 월간 KPI 쿼리
SELECT 
  DATE_TRUNC('month', timestamp) as month,
  COUNT(DISTINCT user_id) as unique_users,
  COUNT(*) as total_requests,
  AVG(duration) as avg_response_time,
  SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) / COUNT(*) as error_rate
FROM logs
WHERE type = 'ai_request'
GROUP BY month
ORDER BY month DESC;
```

---

**📌 중요**: 이 가이드는 지속적으로 업데이트되어야 합니다. 새로운 문제나 개선사항이 발견되면 즉시 문서를 업데이트하세요.