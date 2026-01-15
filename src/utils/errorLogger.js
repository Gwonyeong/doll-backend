const { sendSlackMessage } = require("./slack");
const os = require("os");

/**
 * 백엔드 에러를 Slack으로 전송하는 함수
 * @param {Object} errorInfo - 에러 정보 객체
 * @param {string} errorInfo.message - 에러 메시지
 * @param {string} [errorInfo.stack] - 스택 트레이스
 * @param {string} [errorInfo.method] - HTTP 메서드
 * @param {string} [errorInfo.url] - 요청 URL
 * @param {Object} [errorInfo.headers] - 요청 헤더
 * @param {Object} [errorInfo.body] - 요청 바디
 * @param {Object} [errorInfo.query] - 쿼리 파라미터
 * @param {string} [errorInfo.userAgent] - 사용자 에이전트
 * @param {string} [errorInfo.ip] - 클라이언트 IP
 * @param {Date} [errorInfo.timestamp] - 타임스탬프
 * @param {string} [errorInfo.userId] - 사용자 ID
 * @param {Object} [errorInfo.additionalInfo] - 추가 정보
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendErrorToSlack(errorInfo) {
  const timestamp = errorInfo.timestamp || new Date();
  const hostname = os.hostname();
  const platform = os.platform();

  const errorMessage = {
    text: `🚨 DollCatcher 백엔드 에러 발생`,
    username: "DollCatcher Backend Error Bot",
    icon_emoji: ":warning:",
    attachments: [
      {
        color: "danger",
        title: "에러 정보",
        fields: [
          {
            title: "Error Message",
            value: errorInfo.message,
            short: false,
          },
          {
            title: "Server",
            value: `${hostname} (${platform})`,
            short: true,
          },
          {
            title: "Timestamp",
            value: timestamp.toISOString(),
            short: true,
          },
        ],
        footer: "DollCatcher Backend Error Logger",
        ts: Math.floor(timestamp.getTime() / 1000),
      },
    ],
  };

  // HTTP 요청 정보가 있으면 추가
  if (errorInfo.method || errorInfo.url) {
    const requestFields = [];

    if (errorInfo.method && errorInfo.url) {
      requestFields.push({
        title: "Request",
        value: `${errorInfo.method} ${errorInfo.url}`,
        short: false,
      });
    }

    if (errorInfo.ip) {
      requestFields.push({
        title: "Client IP",
        value: errorInfo.ip,
        short: true,
      });
    }

    if (errorInfo.userAgent) {
      requestFields.push({
        title: "User Agent",
        value:
          errorInfo.userAgent.length > 100
            ? errorInfo.userAgent.substring(0, 100) + "..."
            : errorInfo.userAgent,
        short: false,
      });
    }

    if (requestFields.length > 0) {
      errorMessage.attachments.push({
        color: "warning",
        title: "Request 정보",
        fields: requestFields,
      });
    }
  }

  // Stack trace가 있으면 추가
  if (errorInfo.stack) {
    errorMessage.attachments.push({
      color: "danger",
      title: "Stack Trace",
      text:
        "```\n" +
        (errorInfo.stack.length > 2000
          ? errorInfo.stack.substring(0, 2000) + "..."
          : errorInfo.stack) +
        "\n```",
    });
  }

  // 요청 바디가 있으면 추가 (민감한 정보 제외)
  if (errorInfo.body && Object.keys(errorInfo.body).length > 0) {
    const sanitizedBody = sanitizeObject(errorInfo.body);
    errorMessage.attachments.push({
      color: "warning",
      title: "Request Body",
      text: "```json\n" + JSON.stringify(sanitizedBody, null, 2) + "\n```",
    });
  }

  // 쿼리 파라미터가 있으면 추가
  if (errorInfo.query && Object.keys(errorInfo.query).length > 0) {
    errorMessage.attachments.push({
      color: "warning",
      title: "Query Parameters",
      text: "```json\n" + JSON.stringify(errorInfo.query, null, 2) + "\n```",
    });
  }

  // 추가 정보가 있으면 추가
  if (
    errorInfo.additionalInfo &&
    Object.keys(errorInfo.additionalInfo).length > 0
  ) {
    errorMessage.attachments.push({
      color: "warning",
      title: "Additional Info",
      text:
        "```json\n" +
        JSON.stringify(errorInfo.additionalInfo, null, 2) +
        "\n```",
    });
  }

  return sendSlackMessage(errorMessage);
}

/**
 * Express 에러를 Slack으로 전송하는 함수
 * @param {Error} error - JavaScript Error 객체
 * @param {Object} req - Express request 객체
 * @param {Object} [additionalInfo] - 추가 정보
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendExpressErrorToSlack(error, req, additionalInfo = {}) {
  try {
    // 순환 참조를 안전하게 처리하기 위해 필요한 데이터만 추출
    const safeReq = {
      method: req.method,
      url: req.originalUrl || req.url,
      headers: sanitizeObject(req.headers || {}),
      body: sanitizeObject(req.body || {}),
      query: req.query || {},
      userAgent: req.get ? req.get("User-Agent") : req.headers?.['user-agent'],
      ip: req.ip || req.connection?.remoteAddress || 'unknown'
    };

    const errorInfo = {
      message: error.message,
      stack: error.stack,
      method: safeReq.method,
      url: safeReq.url,
      headers: safeReq.headers,
      body: safeReq.body,
      query: safeReq.query,
      userAgent: safeReq.userAgent,
      ip: safeReq.ip,
      timestamp: new Date(),
      additionalInfo,
    };

    return sendErrorToSlack(errorInfo);
  } catch (sanitizeError) {
    console.error('Error sanitizing request data for Slack:', sanitizeError.message);
    // 최소한의 안전한 정보만으로 에러 로깅
    const minimalErrorInfo = {
      message: error.message,
      stack: error.stack,
      url: req.originalUrl || req.url || 'unknown',
      timestamp: new Date(),
      sanitizeError: sanitizeError.message
    };

    return sendErrorToSlack(minimalErrorInfo);
  }
}

/**
 * 일반 JavaScript 에러를 Slack으로 전송하는 함수
 * @param {Error} error - JavaScript Error 객체
 * @param {Object} [additionalInfo] - 추가 정보
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendJSErrorToSlack(error, additionalInfo = {}) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date(),
    additionalInfo,
  };

  return sendErrorToSlack(errorInfo);
}

/**
 * 데이터베이스 에러를 Slack으로 전송하는 함수
 * @param {Error} error - 데이터베이스 에러 객체
 * @param {string} [query] - 실행된 쿼리
 * @param {Object} [params] - 쿼리 파라미터
 * @param {Object} [additionalInfo] - 추가 정보
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendDBErrorToSlack(
  error,
  query = null,
  params = null,
  additionalInfo = {}
) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    timestamp: new Date(),
    additionalInfo: {
      ...additionalInfo,
      errorType: "Database Error",
      query: query,
      params: params,
    },
  };

  return sendErrorToSlack(errorInfo);
}

/**
 * 민감한 정보를 제거하는 함수
 * @param {Object} obj - 정리할 객체
 * @returns {Object} 정리된 객체
 */
function sanitizeObject(obj) {
  if (!obj || typeof obj !== "object") {
    return obj;
  }

  try {
    // 순환 참조 감지를 위한 Set
    const seen = new WeakSet();

    const sanitizeRecursive = (item) => {
      if (item === null || typeof item !== "object") {
        return item;
      }

      // 순환 참조 체크
      if (seen.has(item)) {
        return "[Circular Reference]";
      }

      seen.add(item);

      if (Array.isArray(item)) {
        return item.map(sanitizeRecursive);
      }

      const sanitized = {};
      const sensitiveKeys = [
        "password",
        "token",
        "authorization",
        "cookie",
        "secret",
        "key",
        "apikey",
        "api_key",
      ];

      Object.keys(item).forEach((key) => {
        const lowerKey = key.toLowerCase();
        if (sensitiveKeys.some((sensitive) => lowerKey.includes(sensitive))) {
          sanitized[key] = "[REDACTED]";
        } else {
          sanitized[key] = sanitizeRecursive(item[key]);
        }
      });

      return sanitized;
    };

    return sanitizeRecursive(obj);
  } catch (error) {
    console.error('Error in sanitizeObject:', error.message);
    return { error: "Failed to sanitize object", originalType: typeof obj };
  }
}

module.exports = {
  sendErrorToSlack,
  sendExpressErrorToSlack,
  sendJSErrorToSlack,
  sendDBErrorToSlack,
};
