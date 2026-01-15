const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const compression = require("compression");
const {
  globalErrorHandler,
  notFoundHandler,
  setupProcessErrorHandlers,
} = require("./middleware/errorHandler");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;

// 기본 미들웨어 설정
app.use(helmet());
app.use(compression());
// Morgan 로그 비활성화 (필요시 주석 해제)
// app.use(morgan("combined"));

// CORS 설정
const corsOptions = {
  origin: function (origin, callback) {
    // 모든 허용된 origin을 하나의 배열로 관리
    const allowedOrigins = [
      // 로컬 개발 환경
      "http://localhost:3000",
      "http://localhost:3001",
      "http://localhost:3002",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:3001",
      "http://127.0.0.1:3002",
      "http://192.168.200.151:3000",
      "http://192.168.50.98:3000",
      "http://192.168.0.16:3000",
      // 프로덕션 환경
      "https://dollpickmap.apps.tossmini.com",
      "https://dollpickmap.private-apps.tossmini.com",
      "https://doll-admin-jet.vercel.app",
      // Dev/Preview 환경 - 명시적으로 모든 변형 포함
      "https://doll-admin-env-dev-busgwonyeongs-projects.vercel.app",
      // Vercel의 자동 생성 URL 패턴도 포함
      process.env.FRONTEND_URL,
    ].filter(Boolean); // undefined 값 제거


    // origin이 없는 경우 (같은 도메인에서의 요청) 또는 허용된 origin인 경우 허용
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      // 개발 환경에서는 모든 Vercel domain 허용 (임시)
      if (origin && origin.includes('.vercel.app')) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
};

app.use(cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Preflight 요청 처리
app.options("*", cors(corsOptions));

// API 라우트
app.use("/api/stores", require("./routes/stores"));
app.use("/api/reviews", require("./routes/reviews"));
app.use("/api/auth", require("./routes/auth"));
app.use("/api/admin", require("./routes/admin"));
app.use("/api/toss", require("./routes/toss"));
app.use("/api/favorites", require("./routes/favorites"));
app.use("/api/store-reports", require("./routes/storeReports"));
app.use("/api/open-alerts", require("./routes/openAlerts"));
app.use("/api/ad-requests", require("./routes/adRequests"));
app.use("/api/geocode", require("./routes/geocode"));
app.use("/api/upload", require("./routes/upload"));

// 헬스 체크 엔드포인트
app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    message: "DollCatcher API Server is running",
    timestamp: new Date().toISOString(),
  });
});

// 기본 루트 응답
app.get("/", (req, res) => {
  res.json({
    message: "DollCatcher API Server",
    version: "1.0.0",
    endpoints: {
      stores: "/api/stores",
      reviews: "/api/reviews",
      auth: "/api/auth",
      admin: "/api/admin",
      favorites: "/api/favorites",
      storeReports: "/api/store-reports",
      openAlerts: "/api/open-alerts",
      upload: "/api/upload",
      health: "/health",
    },
  });
});

// 404 에러 핸들러
app.use(notFoundHandler);

// 전역 에러 핸들러 (Slack 연동)
app.use(globalErrorHandler);

// 프로세스 레벨 에러 핸들러 설정
setupProcessErrorHandlers();

// 서버 시작 (로컬 개발용)
if (process.env.NODE_ENV !== "production") {
  app.listen(PORT, () => {
  });
}

module.exports = app;
