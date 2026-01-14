const express = require("express");
const {
  processTossAuth,
  validateTossSession,
} = require("../services/tossAuth");
const { authenticateToken } = require("../middleware/auth");

const router = express.Router();

/**
 * POST /api/auth/toss/callback
 * 토스 OAuth 콜백 처리
 */
router.post("/toss/callback", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        error: "Bad Request",
        message: "인가 코드가 필요합니다.",
      });
    }

    const authResult = await processTossAuth(code);

    res.json({
      success: true,
      message: "로그인 성공",
      data: authResult,
    });
  } catch (error) {
    console.error("토스 인증 콜백 오류:", error);
    res.status(500).json({
      error: "Authentication Failed",
      message: "인증 처리 중 오류가 발생했습니다.",
      details:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

/**
 * GET /api/auth/me
 * 현재 사용자 정보 조회
 */
router.get("/me", authenticateToken, (req, res) => {
  res.json({
    success: true,
    data: req.user,
  });
});

/**
 * POST /api/auth/verify
 * 토큰 유효성 검증
 */
router.post("/verify", async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        error: "Bad Request",
        message: "토큰이 필요합니다.",
      });
    }

    const user = await validateTossSession(token);

    if (!user) {
      return res.status(401).json({
        error: "Invalid Token",
        message: "유효하지 않은 토큰입니다.",
      });
    }

    res.json({
      success: true,
      valid: true,
      data: user,
    });
  } catch (error) {
    console.error("토큰 검증 오류:", error);
    res.status(500).json({
      error: "Verification Failed",
      message: "토큰 검증 중 오류가 발생했습니다.",
    });
  }
});

/**
 * POST /api/auth/logout
 * 로그아웃 (클라이언트에서 토큰 삭제)
 */
router.post("/logout", (req, res) => {
  // 실제로는 클라이언트에서 토큰을 삭제하는 것으로 로그아웃 처리
  // 필요에 따라 토큰 블랙리스트나 세션 무효화 로직을 추가할 수 있음
  res.json({
    success: true,
    message: "로그아웃 되었습니다.",
  });
});

module.exports = router;
