const express = require("express");
const router = express.Router();
const { prisma } = require("../services/prisma");
const { makePayment, executePayment } = require("../services/tossPayment");
const { authenticateToken } = require("../middleware/auth");

/**
 * 주문번호 생성 (구매물품-현재날짜시간-userId)
 * 형식: {productType}-{yyyyMMddHHmmss}-{userId}
 * 예: PREMIUM_AD-20250118143052-clxyz123abc
 */
function generateOrderNo(productType, userId) {
  const now = new Date();
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, "0") +
    now.getDate().toString().padStart(2, "0") +
    now.getHours().toString().padStart(2, "0") +
    now.getMinutes().toString().padStart(2, "0") +
    now.getSeconds().toString().padStart(2, "0");

  // productType에서 허용되지 않는 문자 제거
  const sanitizedProductType = productType.replace(/[^a-zA-Z0-9_\-]/g, "_").substring(0, 20);

  // userId 앞 10자리만 사용 (50자 제한 고려)
  const shortUserId = userId.substring(0, 10);

  return `${sanitizedProductType}-${dateStr}-${shortUserId}`;
}

/**
 * 상품 설명 검증 (공백만 불가, \와 따옴표 불가, 255자 이내)
 */
function validateProductDesc(productDesc) {
  if (!productDesc || typeof productDesc !== "string") {
    return false;
  }
  if (productDesc.trim().length === 0) {
    return false;
  }
  if (productDesc.length > 255) {
    return false;
  }
  if (/[\\'""]/.test(productDesc)) {
    return false;
  }
  return true;
}

/**
 * POST /api/payment/make-payment
 * 결제 건 생성
 */
router.post("/make-payment", authenticateToken, async (req, res) => {
  try {
    // 1. 인증된 사용자에서 userKey 추출
    const userKey = req.user.userKey;
    const user = await prisma.user.findUnique({
      where: { tossId: userKey },
    });

    if (!user) {
      return res.status(404).json({
        success: false,
        error: "사용자를 찾을 수 없습니다.",
      });
    }

    // 2. 필수 파라미터 검증
    const {
      productType,
      productDesc,
      amount,
      amountTaxFree,
      amountTaxable,
      amountVat,
      amountServiceFee,
      enablePayMethods,
      cashReceipt,
      cashReceiptTradeOption,
      installment,
    } = req.body;

    if (!productType || !productDesc || amount === undefined || amountTaxFree === undefined) {
      return res.status(400).json({
        success: false,
        error: "필수 파라미터가 누락되었습니다. (productType, productDesc, amount, amountTaxFree)",
      });
    }

    // 상품 설명 검증
    if (!validateProductDesc(productDesc)) {
      return res.status(400).json({
        success: false,
        error: "상품 설명 형식이 올바르지 않습니다. (공백만 불가, 백슬래시와 따옴표 불가, 255자 이내)",
      });
    }

    // 금액 검증
    if (typeof amount !== "number" || amount <= 0) {
      return res.status(400).json({
        success: false,
        error: "결제 금액은 0보다 큰 숫자여야 합니다.",
      });
    }

    if (typeof amountTaxFree !== "number" || amountTaxFree < 0) {
      return res.status(400).json({
        success: false,
        error: "비과세 금액은 0 이상의 숫자여야 합니다.",
      });
    }

    // 테스트 환경 여부
    const isTestPayment = process.env.NODE_ENV !== "production";

    // 주문번호 생성 (productType-날짜시간-userId)
    const orderNo = generateOrderNo(productType, user.id);

    // 4. Payment 레코드 생성 (status: pending)
    const payment = await prisma.payment.create({
      data: {
        orderNo,
        productDesc,
        amount,
        amountTaxFree,
        amountTaxable,
        amountVat,
        amountServiceFee,
        enablePayMethods,
        cashReceipt: cashReceipt || false,
        cashReceiptTradeOption,
        installment,
        isTestPayment,
        userId: user.id,
        userKey,
        status: "pending",
      },
    });

    // 5. 토스페이 API 호출
    try {
      const tossResponse = await makePayment(userKey, {
        orderNo,
        productDesc,
        amount,
        amountTaxFree,
        amountTaxable,
        amountVat,
        amountServiceFee,
        enablePayMethods,
        cashReceipt,
        cashReceiptTradeOption,
        installment,
        isTestPayment,
      });

      // 토스 API 응답 로깅
      console.log("토스페이 make-payment 응답:", JSON.stringify(tossResponse, null, 2));

      // payToken 추출 (다양한 응답 구조 대응)
      const payToken = tossResponse.success?.payToken ||
                       tossResponse.payToken ||
                       tossResponse.data?.payToken ||
                       tossResponse.data?.success?.payToken;

      // 6. 성공 시 Payment 상태 업데이트
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "created",
          payToken: payToken,
        },
      });

      // 7. 결과 반환 (payToken을 명시적으로 포함)
      return res.json({
        success: true,
        payment: updatedPayment,
        tossResponse,
        payToken: payToken,
      });
    } catch (tossError) {
      // 토스페이 API 호출 실패 시 Payment 상태 업데이트
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          errorCode: tossError.response?.errorCode || "UNKNOWN",
          errorMessage: tossError.message || "토스페이 API 호출 실패",
        },
      });

      return res.status(tossError.statusCode || 500).json({
        success: false,
        error: tossError.message,
        payment: { id: payment.id, status: "failed" },
        tossResponse: tossError.response,
      });
    }
  } catch (error) {
    console.error("결제 생성 오류:", error);

    // 중복 주문번호 에러 처리
    if (error.code === "P2002") {
      return res.status(400).json({
        success: false,
        error: "이미 사용된 주문번호입니다.",
      });
    }

    return res.status(500).json({
      success: false,
      error: "결제 생성 중 오류가 발생했습니다.",
    });
  }
});

/**
 * POST /api/payment/execute
 * 결제 실행 (사용자 인증 완료 후 호출)
 * 토스페이 execute-payment API를 호출하여 실제 결제 승인 처리
 */
router.post("/execute", authenticateToken, async (req, res) => {
  try {
    const userKey = req.user.userKey;
    const { payToken } = req.body;

    if (!payToken) {
      return res.status(400).json({
        success: false,
        error: "payToken이 필요합니다.",
      });
    }

    // payToken으로 결제 정보 조회
    const payment = await prisma.payment.findFirst({
      where: { payToken },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "결제 정보를 찾을 수 없습니다.",
      });
    }

    // 본인 결제인지 확인
    if (payment.userKey !== userKey) {
      return res.status(403).json({
        success: false,
        error: "권한이 없습니다.",
      });
    }

    // 이미 완료된 결제인지 확인
    if (payment.status === "completed") {
      return res.json({
        success: true,
        payment,
        message: "이미 완료된 결제입니다.",
      });
    }

    // 토스페이 결제 실행 API 호출
    try {
      const tossResponse = await executePayment(userKey, {
        payToken,
        orderNo: payment.orderNo,
      });

      // 토스페이 응답에서 결제 정보 추출
      const successData = tossResponse.success || tossResponse;

      // 결제 상태 업데이트 (성공)
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "completed",
        },
      });

      return res.json({
        success: true,
        payment: updatedPayment,
        tossResponse: {
          mode: successData.mode,
          orderNo: successData.orderNo,
          amount: successData.amount,
          approvalTime: successData.approvalTime,
          stateMsg: successData.stateMsg,
          discountedAmount: successData.discountedAmount,
          paidAmount: successData.paidAmount,
          payMethod: successData.payMethod,
          payToken: successData.payToken,
          transactionId: successData.transactionId,
          cardCompanyName: successData.cardCompanyName,
          cardAuthorizationNo: successData.cardAuthorizationNo,
          accountBankName: successData.accountBankName,
        },
      });
    } catch (tossError) {
      console.error("토스페이 결제 실행 실패:", tossError);

      // 결제 상태 업데이트 (실패)
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: "failed",
          errorCode: tossError.response?.success?.errorCode || tossError.response?.errorCode || "EXECUTE_FAILED",
          errorMessage: tossError.response?.success?.msg || tossError.message || "결제 실행 실패",
        },
      });

      return res.status(tossError.statusCode || 500).json({
        success: false,
        error: tossError.response?.success?.msg || tossError.message || "결제 실행에 실패했습니다.",
        payment: { id: payment.id, status: "failed" },
        tossResponse: tossError.response,
      });
    }
  } catch (error) {
    console.error("결제 실행 오류:", error);
    return res.status(500).json({
      success: false,
      error: "결제 실행 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/payment/user/me
 * 현재 사용자의 결제 목록 조회
 */
router.get("/user/me", authenticateToken, async (req, res) => {
  try {
    const userKey = req.user.userKey;

    const payments = await prisma.payment.findMany({
      where: { userKey },
      orderBy: { createdAt: "desc" },
    });

    return res.json({
      success: true,
      payments,
    });
  } catch (error) {
    console.error("결제 목록 조회 오류:", error);
    return res.status(500).json({
      success: false,
      error: "결제 목록 조회 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/payment/:id
 * 결제 정보 조회
 */
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userKey = req.user.userKey;

    const payment = await prisma.payment.findUnique({
      where: { id },
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        error: "결제 정보를 찾을 수 없습니다.",
      });
    }

    // 본인 결제인지 확인
    if (payment.userKey !== userKey) {
      return res.status(403).json({
        success: false,
        error: "권한이 없습니다.",
      });
    }

    return res.json({
      success: true,
      payment,
    });
  } catch (error) {
    console.error("결제 조회 오류:", error);
    return res.status(500).json({
      success: false,
      error: "결제 조회 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
