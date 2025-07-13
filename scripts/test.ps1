# Writerly Windows PowerShell 테스트 스크립트
# Windows 환경에서 자동 테스트를 실행하는 도구

param(
    [Parameter(Position=0)]
    [ValidateSet("unit", "integration", "functional", "security", "performance", "all", "quick", "ci")]
    [string]$TestType = "all",
    
    [switch]$Verbose,
    [switch]$Coverage,
    [switch]$FailFast,
    [switch]$ExitFirst,
    [switch]$NoCapture,
    [switch]$Watch,
    [switch]$Parallel,
    [switch]$Retry,
    [string]$Keyword,
    [string]$EnvFile = ".env.test",
    [switch]$Help
)

# 색상 정의
$Red = "`e[31m"
$Green = "`e[32m"
$Yellow = "`e[33m"
$Blue = "`e[34m"
$Reset = "`e[0m"

# 기본 설정
$CoverageThreshold = 80
$MaxRetries = 3
$RetryCount = 0

# 로고 출력
function Show-Logo {
    Write-Host "${Blue}" -NoNewline
    Write-Host "╔══════════════════════════════════════════════════════════════════════════════╗"
    Write-Host "║                                                                              ║"
    Write-Host "║                        🧪 Writerly Test Suite 🧪                          ║"
    Write-Host "║                                                                              ║"
    Write-Host "╚══════════════════════════════════════════════════════════════════════════════╝"
    Write-Host "${Reset}"
}

# 도움말 출력
function Show-Help {
    Write-Host "${Yellow}사용법: .\scripts\test.ps1 [테스트타입] [옵션]${Reset}"
    Write-Host ""
    Write-Host "테스트 타입:"
    Write-Host "  unit          단위 테스트만 실행"
    Write-Host "  integration   통합 테스트만 실행"
    Write-Host "  functional    기능 테스트만 실행"
    Write-Host "  security      보안 테스트만 실행"
    Write-Host "  performance   성능 테스트만 실행"
    Write-Host "  all           모든 테스트 실행 (기본값)"
    Write-Host "  quick         빠른 테스트 (단위 테스트만)"
    Write-Host "  ci            CI/CD용 테스트"
    Write-Host ""
    Write-Host "옵션:"
    Write-Host "  -Verbose      상세 출력"
    Write-Host "  -Coverage     커버리지 리포트 생성"
    Write-Host "  -FailFast     첫 번째 실패에서 중단"
    Write-Host "  -Keyword      특정 키워드가 포함된 테스트만 실행"
    Write-Host "  -ExitFirst    첫 번째 실패 시 즉시 종료"
    Write-Host "  -NoCapture    출력 캡처 비활성화"
    Write-Host "  -Watch        파일 변경 감지 모드"
    Write-Host "  -Parallel     병렬 테스트 실행"
    Write-Host "  -Retry        실패한 테스트 재시도"
    Write-Host "  -EnvFile      테스트 환경 파일 지정"
    Write-Host "  -Help         이 도움말 출력"
    Write-Host ""
    Write-Host "예시:"
    Write-Host "  .\scripts\test.ps1 unit -Verbose          단위 테스트를 상세 모드로 실행"
    Write-Host "  .\scripts\test.ps1 all -Coverage          모든 테스트 실행 후 커버리지 리포트 생성"
    Write-Host "  .\scripts\test.ps1 -Keyword test_health   health 관련 테스트만 실행"
    Write-Host "  .\scripts\test.ps1 performance -Parallel  성능 테스트를 병렬로 실행"
}

# 사전 요구사항 확인
function Test-Prerequisites {
    Write-Host "${Blue}📋 사전 요구사항 확인 중...${Reset}"
    
    # Python 확인
    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        if (-not (Get-Command python3 -ErrorAction SilentlyContinue)) {
            Write-Host "${Red}❌ Python이 설치되지 않음${Reset}"
            exit 1
        }
        Set-Alias python python3
    }
    
    # pip 확인
    if (-not (Get-Command pip -ErrorAction SilentlyContinue)) {
        Write-Host "${Red}❌ pip이 설치되지 않음${Reset}"
        exit 1
    }
    
    # 가상환경 확인
    if (-not $env:VIRTUAL_ENV -and -not (Test-Path "writerly_env\Scripts\activate.ps1")) {
        Write-Host "${Yellow}⚠️  가상환경이 활성화되지 않음. 활성화 중...${Reset}"
        if (Test-Path "writerly_env\Scripts\activate.ps1") {
            & .\writerly_env\Scripts\activate.ps1
        } else {
            Write-Host "${Red}❌ 가상환경을 찾을 수 없음${Reset}"
            exit 1
        }
    }
    
    # 필수 패키지 확인
    Write-Host "🔍 필수 패키지 확인 중..."
    $RequiredPackages = @("pytest", "pytest-cov", "pytest-mock", "pytest-asyncio", "pytest-flask")
    $MissingPackages = @()
    
    foreach ($package in $RequiredPackages) {
        $result = pip show $package 2>$null
        if ($LASTEXITCODE -ne 0) {
            $MissingPackages += $package
        }
    }
    
    if ($MissingPackages.Count -gt 0) {
        Write-Host "${Yellow}📦 누락된 패키지 설치 중: $($MissingPackages -join ', ')${Reset}"
        pip install $MissingPackages
    }
    
    Write-Host "${Green}✅ 사전 요구사항 확인 완료${Reset}"
}

# 테스트 환경 설정
function Initialize-TestEnvironment {
    Write-Host "${Blue}🔧 테스트 환경 설정 중...${Reset}"
    
    # 테스트 환경 변수 파일 생성
    if (-not (Test-Path $EnvFile)) {
        $EnvContent = @"
# 테스트 환경 변수
FLASK_ENV=testing
TESTING=True
SECRET_KEY=test-secret-key-for-testing-only
DATABASE_URL=sqlite:///:memory:
REDIS_URL=redis://localhost:6379/15
CELERY_ALWAYS_EAGER=True
CELERY_EAGER_PROPAGATES_EXCEPTIONS=True

# API 키 (테스트용)
OPENAI_API_KEY=sk-test-key
SLACK_BOT_TOKEN=xoxb-test-token
SLACK_SIGNING_SECRET=test-signing-secret

# 보안 설정
ENCRYPTION_KEY=test-encryption-key
TOKEN_ENCRYPTION_KEY=test-token-key
"@
        $EnvContent | Out-File -FilePath $EnvFile -Encoding UTF8
        Write-Host "📝 테스트 환경 파일 생성: $EnvFile"
    }
    
    # 환경 변수 로드
    if (Test-Path $EnvFile) {
        Get-Content $EnvFile | Where-Object { $_ -notmatch '^#' -and $_ -match '=' } | ForEach-Object {
            $name, $value = $_ -split '=', 2
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    
    # 테스트 디렉토리 생성
    $TestDirs = @("logs\test", "htmlcov", ".pytest_cache")
    foreach ($dir in $TestDirs) {
        if (-not (Test-Path $dir)) {
            New-Item -ItemType Directory -Path $dir -Force | Out-Null
        }
    }
    
    Write-Host "${Green}✅ 테스트 환경 설정 완료${Reset}"
}

# 서비스 상태 확인
function Test-Services {
    Write-Host "${Blue}🔍 서비스 상태 확인 중...${Reset}"
    
    # Redis 확인 (선택적)
    if (Get-Command redis-cli -ErrorAction SilentlyContinue) {
        $redisResult = redis-cli ping 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Redis 연결 가능"
        } else {
            Write-Host "⚠️  Redis 연결 불가 (테스트는 모킹 사용)"
        }
    } else {
        Write-Host "⚠️  Redis CLI 없음 (테스트는 모킹 사용)"
    }
    
    # Docker 확인 (선택적)
    if (Get-Command docker -ErrorAction SilentlyContinue) {
        $dockerResult = docker ps 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Docker 사용 가능"
        } else {
            Write-Host "⚠️  Docker 연결 불가"
        }
    }
}

# 테스트 데이터베이스 초기화
function Initialize-TestDatabase {
    Write-Host "${Blue}🗄️ 테스트 데이터베이스 초기화 중...${Reset}"
    
    # 임시 데이터베이스 파일 정리
    Get-ChildItem -Path . -Filter "test_*.db" | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path . -Filter "*.db-journal" | Remove-Item -Force -ErrorAction SilentlyContinue
    
    Write-Host "${Green}✅ 테스트 데이터베이스 준비 완료${Reset}"
}

# 캐시 정리
function Clear-Cache {
    Write-Host "${Blue}🧹 캐시 정리 중...${Reset}"
    
    # Python 캐시 정리
    Get-ChildItem -Path . -Recurse -Name "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path . -Recurse -Filter "*.pyc" | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -Path . -Recurse -Filter "*.pyo" | Remove-Item -Force -ErrorAction SilentlyContinue
    
    # pytest 캐시 정리
    if (Test-Path ".pytest_cache") {
        Remove-Item -Path ".pytest_cache" -Recurse -Force -ErrorAction SilentlyContinue
    }
    
    # 커버리지 파일 정리
    Get-ChildItem -Path . -Filter ".coverage*" | Remove-Item -Force -ErrorAction SilentlyContinue
    
    Write-Host "${Green}✅ 캐시 정리 완료${Reset}"
}

# 테스트 실행
function Invoke-Tests {
    param(
        [string]$Type,
        [string[]]$Args
    )
    
    Write-Host "${Blue}🧪 테스트 실행 중: $Type${Reset}"
    
    # 기본 pytest 옵션
    $BaseArgs = @(
        "--tb=short",
        "--strict-markers",
        "--strict-config",
        "-v"
    )
    
    # 커버리지 옵션
    if ($Coverage) {
        $BaseArgs += @(
            "--cov=.",
            "--cov-report=term-missing",
            "--cov-report=html",
            "--cov-report=xml",
            "--cov-fail-under=$CoverageThreshold"
        )
    }
    
    # 병렬 실행 옵션
    if ($Parallel) {
        $BaseArgs += @("-n", "auto")
    }
    
    # 기타 옵션
    if ($FailFast) { $BaseArgs += "--maxfail=1" }
    if ($ExitFirst) { $BaseArgs += "-x" }
    if ($NoCapture) { $BaseArgs += "-s" }
    if ($Keyword) { $BaseArgs += @("-k", $Keyword) }
    
    # 테스트 타입별 마커 설정
    switch ($Type) {
        "unit" { $BaseArgs += @("-m", "unit") }
        "integration" { $BaseArgs += @("-m", "integration") }
        "functional" { $BaseArgs += @("-m", "functional") }
        "security" { $BaseArgs += @("-m", "security") }
        "performance" { $BaseArgs += @("-m", "performance") }
        "quick" { $BaseArgs += @("-m", "unit", "--maxfail=1") }
        "ci" { 
            $BaseArgs += @(
                "--cov=.",
                "--cov-report=xml",
                "--cov-fail-under=$CoverageThreshold",
                "--maxfail=5",
                "-x"
            )
        }
    }
    
    # pytest 실행
    $PytestArgs = $BaseArgs + $Args
    $Command = "python -m pytest " + ($PytestArgs -join " ")
    Write-Host "실행 명령: $Command"
    
    $result = Invoke-Expression $Command
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "${Green}✅ 테스트 성공: $Type${Reset}"
        return $true
    } else {
        Write-Host "${Red}❌ 테스트 실패: $Type${Reset}"
        
        # 재시도 옵션이 활성화된 경우
        if ($Retry -and $script:RetryCount -lt $MaxRetries) {
            $script:RetryCount++
            Write-Host "${Yellow}🔄 재시도 ($($script:RetryCount)/$MaxRetries)...${Reset}"
            Start-Sleep -Seconds 2
            return Invoke-Tests -Type $Type -Args $Args
        } else {
            return $false
        }
    }
}

# 커버리지 리포트 생성
function New-CoverageReport {
    if ($Coverage) {
        Write-Host "${Blue}📊 커버리지 리포트 생성 중...${Reset}"
        
        # HTML 리포트
        if (Test-Path "htmlcov") {
            Write-Host "📄 HTML 리포트: htmlcov\index.html"
        }
        
        # XML 리포트 (CI용)
        if (Test-Path "coverage.xml") {
            Write-Host "📄 XML 리포트: coverage.xml"
        }
        
        # 터미널 요약
        python -m coverage report --show-missing
        
        Write-Host "${Green}✅ 커버리지 리포트 생성 완료${Reset}"
    }
}

# 테스트 결과 요약
function Show-TestSummary {
    Write-Host "${Blue}" -NoNewline
    Write-Host "╔══════════════════════════════════════════════════════════════════════════════╗"
    Write-Host "║                             📋 테스트 요약                                  ║"
    Write-Host "╚══════════════════════════════════════════════════════════════════════════════╝"
    Write-Host "${Reset}"
    
    # 테스트 파일 수 확인
    $TestFiles = (Get-ChildItem -Path "tests" -Filter "test_*.py").Count
    Write-Host "📁 테스트 파일 수: $TestFiles"
    
    # 커버리지 정보
    if (Test-Path ".coverage") {
        try {
            $CoverageInfo = python -m coverage report --format=total 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "📊 코드 커버리지: $CoverageInfo%"
            }
        } catch {
            Write-Host "📊 코드 커버리지: N/A"
        }
    }
    
    # 마지막 실행 시간
    Write-Host "⏰ 실행 완료: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
    Write-Host ""
}

# 파일 감시 모드
function Start-WatchMode {
    Write-Host "${Blue}👀 파일 감시 모드 시작...${Reset}"
    Write-Host "파일이 변경되면 자동으로 테스트를 실행합니다."
    Write-Host "종료하려면 Ctrl+C를 누르세요."
    
    $LastWrite = Get-Date
    
    while ($true) {
        $Files = Get-ChildItem -Path . -Recurse -Filter "*.py" | Where-Object { $_.LastWriteTime -gt $LastWrite }
        
        if ($Files) {
            Write-Host "📝 파일 변경 감지: $($Files[0].Name)"
            Invoke-Tests -Type "quick" -Args @()
            $LastWrite = Get-Date
        }
        
        Start-Sleep -Seconds 2
    }
}

# 메인 실행
function Main {
    # 도움말 확인
    if ($Help) {
        Show-Help
        exit 0
    }
    
    # 실행 시작
    Show-Logo
    
    # 감시 모드인 경우
    if ($Watch) {
        Test-Prerequisites
        Initialize-TestEnvironment
        Start-WatchMode
        exit 0
    }
    
    # 일반 테스트 실행
    Test-Prerequisites
    Initialize-TestEnvironment
    Test-Services
    Initialize-TestDatabase
    Clear-Cache
    
    # 테스트 실행
    $StartTime = Get-Date
    
    if (Invoke-Tests -Type $TestType -Args @()) {
        $EndTime = Get-Date
        $Duration = ($EndTime - $StartTime).TotalSeconds
        
        New-CoverageReport
        Show-TestSummary
        
        Write-Host "${Green}🎉 모든 테스트가 성공적으로 완료되었습니다! ($([math]::Round($Duration, 2))초)${Reset}"
        exit 0
    } else {
        Write-Host "${Red}💥 테스트 실행 중 오류가 발생했습니다.${Reset}"
        exit 1
    }
}

# 스크립트 실행
Main 