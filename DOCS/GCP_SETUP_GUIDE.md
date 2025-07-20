# Windows용 GCP 초기 설정 가이드 - Writerly 프로젝트

**현재 상태**: GCP 회원가입 완료 (Windows 환경)  
**목표**: Writerly Slack AI Bot 배포를 위한 GCP 환경 구축  
**소요 시간**: 약 30-40분

---

## 📋 사전 준비사항

- [x] GCP 계정 생성 완료 (https://cloud.google.com)
- [x] Windows 10 이상 (PowerShell 또는 Command Prompt 사용)
- [ ] 결제 계정 설정 (필수 - 무료 크레딧 사용 가능)
- [ ] gcloud CLI 설치
- [ ] 프로젝트 생성 및 설정

---

## 🔧 Step 1: Windows용 gcloud CLI 설치

### 1.1 다운로드 및 설치

1. **공식 다운로드 페이지 접속**  
   https://cloud.google.com/sdk/docs/install-sdk#windows 

2. **설치 파일 다운로드**
   - "Windows x86_64용 Google Cloud CLI 설치 프로그램" 클릭
   - `GoogleCloudSDKInstaller.exe` 파일 다운로드 (약 100MB)

3. **설치 실행**
   - 다운로드한 `GoogleCloudSDKInstaller.exe` 더블클릭
   - "관리자 권한으로 실행" 클릭 (권장)

4. **설치 옵션 선택**
   ```
   ✅ Install Google Cloud CLI
   ✅ Install bundled Python
   ✅ Run 'gcloud init' (초기화 자동 실행)
   ✅ Add gcloud to PATH (환경변수 자동 추가)
   ```

5. **설치 위치**
   - 기본 위치: `C:\Program Files (x86)\Google\Cloud SDK\`
   - 변경하지 말고 기본값 사용 권장

### 1.2 설치 확인

설치 완료 후 **새로운 Command Prompt** 또는 **PowerShell**을 열고:

```cmd
gcloud version
```

**정상 출력 예시:**
```
Google Cloud SDK 456.0.0
bq 2.0.101
core 2024.01.12
gcloud-crc32c 1.0.0
gsutil 5.17
```

---

## 🚀 Step 2: gcloud 초기화 및 Google 계정 연동

### 2.1 gcloud 초기화 시작

**Command Prompt** 또는 **PowerShell**에서 실행:

```cmd
gcloud init
```

### 2.2 초기화 진행 과정

**1단계: 로그인 선택**
```
You must log in to continue. Would you like to log in (Y/n)?
```
→ **`Y`** 입력 후 Enter

**2단계: 브라우저 인증**
- Windows 기본 브라우저가 자동으로 열림
- Google 계정 선택 (GCP에 가입한 계정)
- "Google Cloud SDK가 Google 계정에 액세스하도록 허용" → **허용** 클릭
- "You are now authenticated" 메시지 확인

**3단계: 프로젝트 선택**
```
Pick cloud project to use:
 [1] [기존 프로젝트가 있다면 표시]
 [2] Create a new project
```
→ **`2`** 입력 (새 프로젝트 생성)

**4단계: 프로젝트 ID 입력**
```
Enter a Project ID, or leave blank to use a generated one:
```
→ **`writerly-01`** 입력 (간단하고 기억하기 쉬운 ID)

**5단계: 컴퓨팅 리전 설정**
```
Do you want to configure a default Compute Region and Zone? (Y/n)?
```
→ **`Y`** 입력

```
Which Google Compute Engine zone would you like to use as project default?
```
→ **`asia-northeast3-a`** 선택 (서울 리전)

### 2.3 초기화 완료 확인

```cmd
gcloud config list
```

**정상 출력 예시:**
```
[core]
account = your-email@gmail.com
project = writerly-01
[compute]
region = asia-northeast3
zone = asia-northeast3-a
```

### 2.4 Windows 환경 문제 해결

**브라우저가 열리지 않는 경우:**
```cmd
gcloud auth login --no-launch-browser
```
- 출력된 URL을 복사해서 브라우저에 붙여넣기
- 인증 코드를 복사해서 터미널에 붙여넣기

**환경변수 문제:**
- Command Prompt를 **관리자 권한**으로 새로 열기
- PowerShell을 **관리자 권한**으로 새로 열기

---

## 💳 Step 3: 결제 계정 설정 (필수)

### 3.1 GCP 콘솔 접속

Windows 브라우저에서 다음 주소로 이동:
**https://console.cloud.google.com**

### 3.2 결제 계정 생성 (웹 브라우저)

1. **좌상단 햄버거 메뉴(≡)** 클릭
2. **"결제"** 메뉴 클릭
3. **"결제 계정 관리"** → **"결제 계정 만들기"** 클릭

4. **결제 정보 입력**:
   ```
   결제 계정 이름: Writerly Project Billing
   국가/지역: 대한민국
   신용카드 또는 직불카드 정보 입력
   ```

5. **무료 크레딧 확인**
   - 신규 가입자: $300 무료 크레딧 (90일간)
   - Writerly 프로젝트 예상 비용: 월 $10-20

### 3.3 결제 계정 확인 (Command Line)

Windows Command Prompt에서 확인:

```cmd
gcloud billing accounts list
```

**정상 출력 예시:**
```
ACCOUNT_ID            NAME                     OPEN  MASTER_ACCOUNT_ID
01A2B3-C4D5E6-F7G8H9  Writerly Project Billing True
```

**📝 중요: ACCOUNT_ID를 메모장에 복사해두세요!**  
예: `BILLING_ACCOUNT_ID=01A2B3-C4D5E6-F7G8H9`

### 3.4 프로젝트와 결제 계정 연결

```cmd
gcloud billing projects link writerly-01 --billing-account=01A2B3-C4D5E6-F7G8H9
```

**⚠️ 주의**: `01A2B3-C4D5E6-F7G8H9` 부분을 실제 ACCOUNT_ID로 변경

### 3.5 연결 확인

```cmd
gcloud billing projects describe writerly-01
```

**성공 시 출력:**
```
billingAccountName: billingAccounts/01A2B3-C4D5E6-F7G8H9
billingEnabled: true
name: projects/writerly-01/billingInfo
projectId: writerly-01
```

### 3.6 예산 알림 설정 (권장)

1. **GCP 콘솔** → **결제** → **예산 및 알림**
2. **"예산 만들기"** 클릭
3. **설정값**:
   ```
   이름: Writerly Monthly Budget
   금액: $50 (월 5만원)
   알림 임계값: 50%, 90%, 100%
   이메일: [본인 이메일 주소]
   ```

---

## 🔌 Step 4: 필수 API 활성화

### 4.1 Writerly 프로젝트 필수 API

Windows Command Prompt에서 다음 명령어를 **순서대로** 실행:

```cmd
gcloud services enable run.googleapis.com
```
```cmd
gcloud services enable cloudtasks.googleapis.com
```
```cmd
gcloud services enable aiplatform.googleapis.com
```
```cmd
gcloud services enable secretmanager.googleapis.com
```
```cmd
gcloud services enable redis.googleapis.com
```
```cmd
gcloud services enable cloudbuild.googleapis.com
```
```cmd
gcloud services enable containerregistry.googleapis.com
```
```cmd
gcloud services enable monitoring.googleapis.com
```
```cmd
gcloud services enable logging.googleapis.com
```

### 4.2 API 활성화 확인

```cmd
gcloud services list --enabled --filter="state:ENABLED"
```

**다음 API들이 포함되어 있어야 함:**
- ✅ Cloud Run API
- ✅ Cloud Tasks API  
- ✅ Vertex AI API
- ✅ Secret Manager API
- ✅ Cloud Memorystore for Redis API
- ✅ Cloud Build API
- ✅ Container Registry API
- ✅ Cloud Monitoring API
- ✅ Cloud Logging API

---

## 👤 Step 5: 기본 설정 및 권한 확인

### 5.1 현재 설정 확인

```cmd
gcloud config list
```

**정상 출력 예시:**
```
[core]
account = your-email@gmail.com
project = writerly-01
[compute]
region = asia-northeast3
zone = asia-northeast3-a
```

### 5.2 서비스 계정 확인

```cmd
gcloud iam service-accounts list
```

### 5.3 기본 권한 확인

```cmd
gcloud projects get-iam-policy writerly-01
```

---

## 🧪 Step 6: 설정 검증 테스트

### 6.1 기본 기능 테스트

Windows Command Prompt에서 다음 명령어들을 실행해서 에러가 없는지 확인:

```cmd
gcloud projects describe writerly-01
```

```cmd
gcloud run services list --region=asia-northeast3
```

```cmd
gcloud secrets list
```

**모든 명령어가 에러 없이 실행되면 설정 완료!**

### 6.2 간단한 권한 테스트

```cmd
gcloud run services list --region=asia-northeast3
```
- **정상**: `Listed 0 items.` (아직 서비스가 없으므로)
- **에러**: 권한 관련 에러 메시지

```cmd
gcloud secrets list
```
- **정상**: `Listed 0 items.` (아직 시크릿이 없으므로)
- **에러**: 권한 관련 에러 메시지

---

## 📋 Step 7: 최종 정보 정리 및 완료 확인

### 7.1 필수 정보 수집

Windows Command Prompt에서 다음 명령어들을 실행해서 정보를 메모장에 복사해주세요:

```cmd
echo GCP_PROJECT_ID: writerly-01
```

```cmd
gcloud config get-value account
```

```cmd
gcloud config get-value compute/region
```

```cmd
gcloud billing accounts list --format="value(name)"
```

### 7.2 최종 설정 완료 체크리스트

**✅ 체크해야 할 항목들:**

- [ ] **gcloud CLI 설치 완료** (`gcloud version` 정상 출력)
- [ ] **Google 계정 인증 완료** (`gcloud auth list` 정상 출력)  
- [ ] **프로젝트 생성 완료** (PROJECT_ID: `writerly-01`)
- [ ] **결제 계정 연결 완료** (`gcloud billing projects describe writerly-01` 정상)
- [ ] **필수 API 9개 활성화 완료** (Cloud Run, Vertex AI 등)
- [ ] **리전 설정 완료** (`asia-northeast3` 서울)
- [ ] **기본 권한 테스트 통과** (Cloud Run, Secret Manager 접근 가능)
- [ ] **예산 알림 설정 완료** ($50/월 권장)

### 7.3 개발자에게 전달할 최종 정보

**모든 설정이 완료되면 다음 정보를 개발자에게 알려주세요:**

```
✅ Windows GCP 설정 완료!

GCP_PROJECT_ID: writerly-01
GCP_REGION: asia-northeast3
GCP_USER: [본인 이메일 주소]
BILLING_ENABLED: true

이제 Slack 앱 설정을 진행하거나, 
바로 "계속 진행해줘"라고 말씀해주세요.
```

---

## 🚨 Windows 환경 문제 해결

### 자주 발생하는 문제들

**1. `gcloud` 명령어를 찾을 수 없습니다**
- **해결**: Command Prompt를 **완전히 종료**하고 새로 열기
- **또는**: Windows 재시작 후 다시 시도

**2. 권한 에러 (403 Forbidden)**
```cmd
gcloud auth login
```
- 브라우저에서 다시 인증

**3. PowerShell 실행 정책 에러**
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**4. 결제 계정 연결 실패**
- **GCP 콘솔**에서 수동 연결: https://console.cloud.google.com/billing
- "프로젝트 연결" → `writerly-01` 선택

**5. API 활성화 실패**
- 각 API를 **하나씩 순서대로** 활성화
- 각 명령어 사이에 10-15초 대기

### Windows용 유용한 명령어

```cmd
REM 현재 설정 전체 확인
gcloud info

REM 재인증
gcloud auth login --no-launch-browser

REM 프로젝트 강제 설정
gcloud config set project writerly-01
```

---

## 📞 지원 리소스

- **GCP 공식 문서**: https://cloud.google.com/docs
- **Windows 설치 가이드**: https://cloud.google.com/sdk/docs/install-sdk#windows
- **GCP 콘솔**: https://console.cloud.google.com
- **결제 관리**: https://console.cloud.google.com/billing

---

## ⏱️ 완료 시간

**예상 소요 시간**: Windows 환경에서 30-40분

**✅ 설정 완료 후**: 개발자에게 완료 알림과 함께 **프로젝트 ID(`writerly-01`)**를 전달해주세요!

---

🎉 **이제 Windows에서 GCP 개발 환경이 준비되었습니다!**