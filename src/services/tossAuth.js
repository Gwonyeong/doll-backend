const https = require("https");
const { prisma } = require("./prisma");
const { sendExpressErrorToSlack } = require("../utils/errorLogger");

/**
 * 토스 인가 코드를 사용하여 액세스 토큰을 발급받습니다.
 * @param {string} authorizationCode 토스에서 받은 인가 코드
 * @param {string} referrer 리퍼러 정보
 * @returns {Promise<Object>} 토큰 응답
 */
async function getTossToken(authorizationCode, referrer = "") {
  return new Promise((resolve, reject) => {
    // 환경 변수에서 인증서 읽기
    const cert = process.env.TOSS_CERT;
    const key = process.env.TOSS_PRIVATE;

    if (!cert || !key) {
      return reject(new Error("Toss 인증서가 설정되지 않았습니다."));
    }

    const postData = JSON.stringify({
      authorizationCode,
      referrer,
    });

    const options = {
      hostname: "apps-in-toss-api.toss.im",
      path: "/api-partner/v1/apps-in-toss/user/oauth2/generate-token",
      method: "POST",
      cert: cert,
      key: key,
      rejectUnauthorized: true,
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const tokenResponse = JSON.parse(responseData);
          if (res.statusCode === 200) {
            resolve(tokenResponse);
          } else {
            reject(
              new Error("토큰 발급 실패: " + JSON.stringify(tokenResponse))
            );
          }
        } catch (error) {
          reject(new Error("토큰 응답 파싱 실패: " + responseData));
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
 * 토스 액세스 토큰을 사용하여 사용자 정보를 가져옵니다.
 * @param {string} accessToken 토스 액세스 토큰
 * @returns {Promise<Object>} 사용자 정보 응답
 */
async function getTossUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    // 환경 변수에서 인증서 읽기
    const cert = process.env.TOSS_CERT;
    const key = process.env.TOSS_PRIVATE;

    if (!cert || !key) {
      return reject(new Error("Toss 인증서가 설정되지 않았습니다."));
    }

    const options = {
      hostname: "apps-in-toss-api.toss.im",
      path: "/api-partner/v1/apps-in-toss/user/oauth2/login-me",
      method: "GET",
      cert: cert,
      key: key,
      rejectUnauthorized: true,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.request(options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const userInfoResponse = JSON.parse(responseData);
          if (res.statusCode === 200) {
            resolve(userInfoResponse);
          } else {
            reject(
              new Error(
                "사용자 정보 가져오기 실패: " + JSON.stringify(userInfoResponse)
              )
            );
          }
        } catch (error) {
          reject(new Error("사용자 정보 응답 파싱 실패: " + responseData));
        }
      });
    });

    req.on("error", (error) => {
      reject(error);
    });

    req.end();
  });
}

/**
 * 토스 인증 과정을 처리하고 사용자를 생성/업데이트합니다.
 * @param {string} authorizationCode 토스 인가 코드
 * @param {string} referrer 리퍼러 정보
 * @returns {Promise<Object>} 사용자 정보와 토큰
 */
async function processTossAuth(authorizationCode, referrer = "") {
  try {
    // 1. 토큰 발급
    const tokenResponse = await getTossToken(authorizationCode, referrer);

    // 토큰 응답에서 액세스 토큰 추출
    const accessToken =
      tokenResponse.success?.accessToken ||
      tokenResponse.accessToken ||
      tokenResponse.data?.success?.accessToken;

    if (!accessToken) {
      throw new Error("액세스 토큰을 찾을 수 없습니다.");
    }

    // 2. 사용자 정보 가져오기
    const userInfoResponse = await getTossUserInfo(accessToken);

    if (userInfoResponse.resultType !== "SUCCESS") {
      throw new Error("토스 사용자 정보 조회 실패");
    }

    // 3. 암호화된 사용자 정보 복호화
    const encryptionKey = process.env.TOSS_ENCRYPTION_KEY;
    const aad = process.env.TOSS_AAD;

    if (!encryptionKey || !aad) {
      throw new Error("암호화 키 또는 AAD가 설정되지 않았습니다.");
    }

    const { decryptUserInfo } = require("../utils/encryption");
    const decryptedData = decryptUserInfo(userInfoResponse, encryptionKey, aad);

    // 4. 데이터베이스에서 사용자 확인/생성
    const userSuccess = decryptedData.success || userInfoResponse.success;
    const decryptedFields = decryptedData.decrypted || {};

    const userKey = userSuccess.userKey?.toString();
    const ci = decryptedFields.ci || userSuccess.ci;

    if (!userKey) {
      throw new Error("사용자 키를 찾을 수 없습니다.");
    }

    let user = await prisma.user.findUnique({
      where: { tossId: userKey },
    });

    const userData = {
      tossId: userKey,
      name: decryptedFields.name || userSuccess.name || "Toss User",
      phone: decryptedFields.phone || userSuccess.phone,
      email: decryptedFields.email || userSuccess.email,
      gender: decryptedFields.gender || userSuccess.gender,
      birthday: decryptedFields.birthday || userSuccess.birthday,
      nationality: decryptedFields.nationality || userSuccess.nationality,
      ci: ci,
    };

    if (!user) {
      // 새 사용자 생성
      user = await prisma.user.create({
        data: userData,
      });
    } else {
      // 기존 사용자 정보 업데이트
      user = await prisma.user.update({
        where: { id: user.id },
        data: userData,
      });
    }

    return {
      user: {
        id: user.id,
        userKey: user.tossId,
        name: user.name,
        email: user.email,
        phone: user.phone,
      },
      accessToken: accessToken,
      refreshToken:
        tokenResponse.success?.refreshToken || tokenResponse.refreshToken,
    };
  } catch (error) {
    console.error("토스 인증 처리 오류:", error);
    throw error;
  }
}

/**
 * 토스 액세스 토큰으로 세션을 검증합니다.
 * @param {string} accessToken 토스 액세스 토큰
 * @returns {Promise<Object|null>} 사용자 정보 또는 null
 */
async function validateTossSession(accessToken) {
  try {
    // 토스 API로 토큰 유효성 확인
    const userInfoResponse = await getTossUserInfo(accessToken);

    if (userInfoResponse.resultType !== "SUCCESS") {
      return null;
    }

    // 암호화된 사용자 정보 복호화
    const encryptionKey = process.env.TOSS_ENCRYPTION_KEY;
    const aad = process.env.TOSS_AAD;

    if (!encryptionKey || !aad) {
      return null;
    }

    const { decryptUserInfo } = require("../utils/encryption");
    const decryptedData = decryptUserInfo(userInfoResponse, encryptionKey, aad);

    const userSuccess = decryptedData.success || userInfoResponse.success;
    const userKey = userSuccess.userKey?.toString();

    if (!userKey) {
      return null;
    }

    // 데이터베이스에서 사용자 확인
    const user = await prisma.user.findUnique({
      where: { tossId: userKey },
    });

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      userKey: user.tossId,
      name: user.name,
      email: user.email,
      phone: user.phone,
    };
  } catch (error) {
    console.error("세션 검증 오류:", error);
    return null;
  }
}

module.exports = {
  getTossToken,
  getTossUserInfo,
  processTossAuth,
  validateTossSession,
};
