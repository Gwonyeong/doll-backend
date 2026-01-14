# DollCatcher Backend

DollCatcher의 Express.js 백엔드 API 서버입니다.

## 🚀 배포 정보

- **Production Branch**: `main` → 자동 배포
- **Development Branch**: `dev` → 자동 배포
- **Last Updated**: 2026-01-14

## 🌐 Vercel 배포

### 환경 변수 설정
Vercel 대시보드에서 다음 환경 변수들을 설정하세요:

```env
NODE_ENV=production
DATABASE_URL=postgresql://username:password@host:port/database?schema=schema_name
FRONTEND_URL=https://your-frontend-domain.com
TOSS_CLIENT_ID=your_toss_client_id
TOSS_CERT=your_base64_encoded_certificate
TOSS_PRIVATE=your_base64_encoded_private_key
TOSS_ENCRYPTION_KEY=your_encryption_key
TOSS_AAD=your_aad_value
ADMIN_PASSWORD=your_admin_password
```

### 배포 명령어
```bash
vercel --prod
```

## 🚀 시작하기

### 환경 요구사항
- Node.js 18+
- PostgreSQL 데이터베이스
- npm 또는 yarn

### 설치 및 실행

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env
# .env 파일을 편집하여 필요한 값들을 설정하세요

# Prisma 클라이언트 생성
npm run db:generate

# 데이터베이스 스키마 푸시
npm run db:push

# 개발 서버 실행
npm run dev
```

서버가 `http://localhost:3001`에서 실행됩니다.

## 📋 사용 가능한 스크립트

- `npm start` - 프로덕션 서버 실행
- `npm run dev` - 개발 서버 실행 (nodemon)
- `npm run db:generate` - Prisma 클라이언트 생성
- `npm run db:push` - 스키마를 데이터베이스에 푸시
- `npm run db:migrate` - 마이그레이션 실행
- `npm run db:studio` - Prisma Studio 실행

## 🏗️ 프로젝트 구조

```
src/
├── routes/           # API 라우트
│   ├── auth.js      # 인증 관련 라우트
│   ├── stores.js    # 매장 관련 라우트
│   ├── reviews.js   # 리뷰 관련 라우트
│   └── admin.js     # 관리자 라우트
├── middleware/       # Express 미들웨어
│   └── auth.js      # 인증 미들웨어
├── services/         # 비즈니스 로직
│   ├── prisma.js    # Prisma 클라이언트
│   ├── tossAuth.js  # 토스 인증 서비스
│   └── crypto.js    # 암호화 유틸리티
└── app.js           # Express 앱 진입점
```

## 🔧 환경 변수

`.env` 파일에서 다음 환경 변수들을 설정하세요:

```env
# 서버 설정
PORT=3001
NODE_ENV=development

# 프론트엔드 URL
FRONTEND_URL=http://localhost:3000

# 데이터베이스
DATABASE_URL="postgresql://username:password@localhost:5432/dollcatcher"

# 토스 OAuth
TOSS_CLIENT_ID=your_toss_client_id
TOSS_CLIENT_SECRET=your_toss_client_secret
TOSS_REDIRECT_URI=http://localhost:3001/api/auth/toss/callback

# 암호화 키
NEXT_PUBLIC_CRYPTO_SECRET_KEY=your_crypto_secret_key

# 관리자 사용자 ID (쉼표로 구분)
ADMIN_USER_IDS=admin_user_id_1,admin_user_id_2
```

## 📊 API 엔드포인트

### 인증 (Authentication)
- `POST /api/auth/toss/callback` - 토스 OAuth 콜백 처리
- `GET /api/auth/me` - 현재 사용자 정보 조회
- `POST /api/auth/verify` - 토큰 유효성 검증
- `POST /api/auth/logout` - 로그아웃

### 매장 (Stores)
- `GET /api/stores` - 매장 목록 조회
- `GET /api/stores/:id` - 특정 매장 상세 정보
- `GET /api/stores/search/suggestions` - 매장 검색 자동완성

### 리뷰 (Reviews)
- `GET /api/reviews/store/:storeId` - 특정 매장의 리뷰 목록
- `POST /api/reviews` - 새 리뷰 작성
- `PUT /api/reviews/:id` - 리뷰 수정
- `DELETE /api/reviews/:id` - 리뷰 삭제
- `GET /api/reviews/stats/:storeId` - 매장 리뷰 통계

### 관리자 (Admin)
- `GET /api/admin/stats` - 대시보드 통계
- `GET /api/admin/stores` - 매장 관리 목록
- `GET /api/admin/reviews` - 리뷰 관리 목록
- `DELETE /api/admin/reviews/:id` - 리뷰 삭제 (관리자)
- `GET /api/admin/users` - 사용자 관리 목록

## 🔐 인증 시스템

이 백엔드는 토스 OAuth 2.0을 사용한 인증 시스템을 구현합니다:

1. 클라이언트가 토스 OAuth 인가 코드를 받음
2. `/api/auth/toss/callback`으로 코드 전송
3. 서버가 토스 API로 토큰 교환 및 사용자 정보 조회
4. 암호화된 사용자 정보 복호화 후 데이터베이스에 저장/업데이트
5. 클라이언트에 액세스 토큰과 사용자 정보 반환

### 토큰 검증

모든 보호된 라우트는 `Authorization: Bearer <token>` 헤더를 통해 토큰을 검증합니다.

## 🗄️ 데이터베이스

PostgreSQL 데이터베이스를 사용하며, Prisma ORM으로 관리됩니다.

### 주요 모델
- `GameBusiness` - 인형뽑기 매장 정보
- `User` - 사용자 정보 (토스 OAuth)
- `Review` - 리뷰 정보

스키마는 `prisma/schema.prisma`에서 확인할 수 있습니다.

## 🛠️ 개발 가이드

### 새로운 API 라우트 추가
1. `src/routes/` 폴더에 새 라우트 파일 생성
2. `src/app.js`에서 라우트 등록
3. 필요한 경우 `src/middleware/`에서 미들웨어 생성

### 데이터베이스 스키마 변경
1. `prisma/schema.prisma` 수정
2. `npm run db:push` 또는 `npm run db:migrate` 실행
3. `npm run db:generate`로 클라이언트 재생성

## 🚢 배포

### 프로덕션 빌드
```bash
npm install --production
```

### 프로덕션 실행
```bash
npm start
```

### 환경 변수 설정
프로덕션 환경에서는 다음 환경 변수들을 설정해야 합니다:
- `NODE_ENV=production`
- `DATABASE_URL` (프로덕션 데이터베이스)
- `FRONTEND_URL` (프로덕션 프론트엔드 URL)
- 기타 필요한 환경 변수들