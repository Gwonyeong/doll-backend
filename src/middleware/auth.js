const { validateTossSession } = require("../services/tossAuth");
const { sendExpressErrorToSlack } = require("../utils/errorLogger");

/**
 * 토스 인증 미들웨어
 * Authorization 헤더에서 토큰을 확인하고 사용자 정보를 req.user에 설정합니다.
 */
async function authenticateToken(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1]; // "Bearer TOKEN"

    if (!token) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "인증 토큰이 필요합니다.",
      });
    }

    const user = await validateTossSession(token);

    if (!user) {
      return res.status(401).json({
        error: "Unauthorized",
        message: "유효하지 않은 토큰입니다.",
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error("인증 미들웨어 오류:", error);
    return res.status(500).json({
      error: "Internal Server Error",
      message: "인증 처리 중 오류가 발생했습니다.",
    });
  }
}

/**
 * 선택적 인증 미들웨어
 * 토큰이 있으면 검증하고, 없어도 계속 진행합니다.
 */
async function optionalAuth(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader && authHeader.split(" ")[1];

    if (token) {
      const user = await validateTossSession(token);
      if (user) {
        req.user = user;
      }
    }

    next();
  } catch (error) {
    console.error("선택적 인증 미들웨어 오류:", error);
    next(); // 오류가 있어도 계속 진행
  }
}

/**
 * 관리자 권한 확인 미들웨어
 * 특정 사용자만 관리자로 간주하거나, 별도의 관리자 테이블을 사용할 수 있습니다.
 */
function requireAdmin(req, res, next) {
  // 현재는 간단히 환경 변수로 관리자 ID를 확인
  // 실제 운영에서는 별도의 권한 시스템을 구축하는 것이 좋습니다.
  const adminUsers = process.env.ADMIN_USER_IDS?.split(",") || [];

  if (!req.user) {
    return res.status(401).json({
      error: "Unauthorized",
      message: "인증이 필요합니다.",
    });
  }

  if (!adminUsers.includes(req.user.id)) {
    return res.status(403).json({
      error: "Forbidden",
      message: "관리자 권한이 필요합니다.",
    });
  }

  next();
}

module.exports = {
  authenticateToken,
  optionalAuth,
  requireAdmin,
};
