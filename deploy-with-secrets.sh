#!/bin/bash

echo "🚀 Cloud Run 서비스에 Secret Manager 환경변수 연결 중..."

gcloud run deploy writerly \
  --source . \
  --project=writerly-01 \
  --region=us-central1 \
  --allow-unauthenticated \
  --set-env-vars="GCP_PROJECT_ID=writerly-01,GCP_LOCATION=us-central1,BASE_URL=https://writerly-177365346300.us-central1.run.app" \
  --update-secrets="SLACK_CLIENT_ID=slack-client-id:latest" \
  --update-secrets="SLACK_CLIENT_SECRET=slack-client-secret:latest" \
  --update-secrets="SLACK_SIGNING_SECRET=slack-signing-secret:latest" \
  --update-secrets="ENCRYPTION_KEY=encryption-key:latest" \
  --memory=1Gi \
  --cpu=1 \
  --timeout=300 \
  --concurrency=100 \
  --min-instances=0 \
  --max-instances=10

echo "✅ 배포 완료!"