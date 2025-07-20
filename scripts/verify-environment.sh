#!/bin/bash

# Environment Setup Verification Script
# 개발 환경 설정 검증 스크립트

echo "🔍 개발 환경 검증 시작..."
echo "================================"

# Node.js 버전 확인
echo "✅ Node.js 버전 확인:"
node_version=$(node --version)
if [[ $node_version =~ ^v1[8-9]\.|^v2[0-9]\. ]]; then
    echo "   Node.js $node_version (✓ 18.0.0 이상)"
else
    echo "   ❌ Node.js 버전이 18.0.0 미만입니다: $node_version"
    exit 1
fi

# npm 버전 확인
echo "✅ npm 버전 확인:"
npm_version=$(npm --version)
echo "   npm v$npm_version"

# TypeScript 설치 확인
echo "✅ TypeScript 설치 확인:"
if [ -f "node_modules/.bin/tsc" ]; then
    tsc_version=$(npx tsc --version)
    echo "   $tsc_version (✓)"
else
    echo "   ❌ TypeScript가 설치되지 않았습니다"
fi

# 필수 디렉토리 확인
echo "✅ 프로젝트 구조 확인:"
required_dirs=("src" "tests" "docker" "deploy" "scripts")
for dir in "${required_dirs[@]}"; do
    if [ -d "$dir" ]; then
        echo "   ✓ $dir/"
    else
        echo "   ❌ $dir/ 디렉토리가 없습니다"
    fi
done

# 설정 파일 확인
echo "✅ 설정 파일 확인:"
config_files=("package.json" "tsconfig.json" "jest.config.js" ".eslintrc.js" ".prettierrc" ".gitignore")
for file in "${config_files[@]}"; do
    if [ -f "$file" ]; then
        echo "   ✓ $file"
    else
        echo "   ❌ $file 파일이 없습니다"
    fi
done

# 환경 변수 파일 확인
echo "✅ 환경 변수 설정 확인:"
if [ -f ".env.example" ]; then
    echo "   ✓ .env.example"
else
    echo "   ❌ .env.example 파일이 없습니다"
fi

if [ -f ".env" ]; then
    echo "   ✓ .env (로컬 설정 완료)"
else
    echo "   ⚠️  .env 파일이 없습니다 (로컬 설정 필요)"
fi

echo "================================"
echo "✅ 개발 환경 검증 완료!"