#!/usr/bin/env pwsh
# Writerly 전체 서비스 실행 스크립트

Write-Host "🚀 Writerly 서비스 시작 중..." -ForegroundColor Green

# .env 파일 확인
if (-not (Test-Path ".env")) {
    Write-Host "❌ .env 파일이 없습니다!" -ForegroundColor Red
    Write-Host "📝 env.dev.example을 참고하여 .env 파일을 생성하세요." -ForegroundColor Yellow
    Write-Host "   cp env.dev.example .env" -ForegroundColor Cyan
    Write-Host "   그리고 실제 토큰들로 값을 수정하세요." -ForegroundColor Cyan
    exit 1
}

# Docker Compose로 모든 서비스 실행
Write-Host "🐳 Docker 서비스들 시작 중..." -ForegroundColor Blue
docker-compose up -d

# 서비스 상태 확인
Start-Sleep 5
Write-Host "`n📊 서비스 상태 확인:" -ForegroundColor Green
docker-compose ps

# ngrok URL 확인
Write-Host "`n🔗 ngrok 터널 URL 확인:" -ForegroundColor Green
Write-Host "웹 브라우저에서 http://localhost:4040 에 접속하여" -ForegroundColor Yellow
Write-Host "ngrok에서 제공하는 HTTPS URL을 확인하세요!" -ForegroundColor Yellow

Write-Host "`n✅ 모든 서비스가 실행되었습니다!" -ForegroundColor Green
Write-Host "📱 Slack 앱 설정에서 ngrok URL을 사용하세요." -ForegroundColor Cyan 