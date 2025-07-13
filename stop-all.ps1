#!/usr/bin/env pwsh
# Writerly 전체 서비스 중지 스크립트

Write-Host "🛑 Writerly 서비스 중지 중..." -ForegroundColor Red

# Docker Compose 서비스 중지
docker-compose down

Write-Host "`n✅ 모든 서비스가 중지되었습니다!" -ForegroundColor Green 