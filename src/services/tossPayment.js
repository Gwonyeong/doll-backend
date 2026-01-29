const https = require("https");

/**
 * 토스페이 결제 건을 생성합니다.
 * @param {string} userKey 토스 로그인을 통해 획득한 userKey
 * @param {Object} paymentData 결제 정보
 * @returns {Promise<Object>} 토스페이 API 응답
 */
async function makePayment(userKey, paymentData) {
  return new Promise((resolve, reject) => {
    // 환경 변수에서 인증서 읽기
    const cert = process.env.TOSS_CERT;
    const key = process.env.TOSS_PRIVATE;

    if (!cert || !key) {
      return reject(new Error("Toss 인증서가 설정되지 않았습니다."));
    }

    // 테스트 환경 여부 결정 (개발 환경이면 테스트 결제)
    const isTestPayment =
      paymentData.isTestPayment !== undefined
        ? paymentData.isTestPayment
        : process.env.NODE_ENV !== "production";

    const postData = JSON.stringify({
      orderNo: paymentData.orderNo,
      productDesc: paymentData.productDesc,
      amount: paymentData.amount,
      amountTaxFree: paymentData.amountTaxFree,
      amountTaxable: paymentData.amountTaxable,
      amountVat: paymentData.amountVat,
      amountServiceFee: paymentData.amountServiceFee,
      enablePayMethods: paymentData.enablePayMethods,
      cashReceipt: paymentData.cashReceipt,
      cashReceiptTradeOption: paymentData.cashReceiptTradeOption,
      installment: paymentData.installment,
      isTestPayment: isTestPayment,
    });

    const options = {
      hostname: "apps-in-toss-api.toss.im",
      path: "/api-partner/v1/apps-in-toss/pay/make-payment",
      method: "POST",
      cert: cert,
      key: key,
      rejectUnauthorized: true,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "x-toss-user-key": userKey,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const paymentResponse = JSON.parse(responseData);
          if (res.statusCode === 200) {
            resolve(paymentResponse);
          } else {
            reject({
              statusCode: res.statusCode,
              response: paymentResponse,
              message: "결제 생성 실패: " + JSON.stringify(paymentResponse),
            });
          }
        } catch (error) {
          reject(new Error("결제 응답 파싱 실패: " + responseData));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

/**
 * 테스트 환경 여부를 확인합니다.
 * TOSS_PAY_SECRET_KEY가 sk_test로 시작하면 테스트 환경
 * @returns {boolean}
 */
function isTestMode() {
  const secretKey = process.env.TOSS_PAY_SECRET_KEY || "";
  return secretKey.startsWith("sk_test");
}

/**
 * 토스페이 결제를 실행(승인)합니다.
 * @param {string} userKey 토스 로그인을 통해 획득한 userKey
 * @param {Object} executeData 결제 실행 정보
 * @param {string} executeData.payToken 토스페이 토큰
 * @param {string} [executeData.orderNo] 가맹점 주문번호 (선택)
 * @returns {Promise<Object>} 토스페이 API 응답
 */
async function executePayment(userKey, executeData) {
  return new Promise((resolve, reject) => {
    // 환경 변수에서 인증서 읽기
    const cert = process.env.TOSS_CERT;
    const key = process.env.TOSS_PRIVATE;

    if (!cert || !key) {
      return reject(new Error("Toss 인증서가 설정되지 않았습니다."));
    }

    const postData = JSON.stringify({
      payToken: executeData.payToken,
      orderNo: executeData.orderNo,
      isTestPayment: isTestMode(),
    });

    const options = {
      hostname: "apps-in-toss-api.toss.im",
      path: "/api-partner/v1/apps-in-toss/pay/execute-payment",
      method: "POST",
      cert: cert,
      key: key,
      rejectUnauthorized: true,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
        "x-toss-user-key": userKey,
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const executeResponse = JSON.parse(responseData);
          if (res.statusCode === 200 && executeResponse.resultType === "SUCCESS") {
            resolve(executeResponse);
          } else {
            reject({
              statusCode: res.statusCode,
              response: executeResponse,
              message: "결제 실행 실패: " + JSON.stringify(executeResponse),
            });
          }
        } catch (error) {
          reject(new Error("결제 실행 응답 파싱 실패: " + responseData));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.write(postData);
    req.end();
  });
}

module.exports = {
  makePayment,
  executePayment,
  isTestMode,
};
