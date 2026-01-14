const { sendExpressErrorToSlack } = require('../utils/errorLogger');

/**
 * 전역 에러 처리 미들웨어
 * Express 애플리케이션에서 발생하는 모든 에러를 캐치하고 Slack으로 전송
 * @param {Error} err - 에러 객체
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 * @param {Function} next - Express next 함수
 */
function globalErrorHandler(err, req, res, next) {
  // 에러 로그를 콘솔에 출력
  console.error('=== Global Error Handler ===');
  console.error('Error:', err.message);
  console.error('Stack:', err.stack);
  console.error('Request:', req.method, req.originalUrl);
  console.error('Body:', req.body);
  console.error('Query:', req.query);
  console.error('===========================');

  // Slack으로 에러 전송 (비동기, 에러가 발생해도 응답에 영향 주지 않음)
  sendExpressErrorToSlack(err, req).catch(slackError => {
    console.error('Slack 에러 전송 실패:', slackError.message);
  });

  // 에러 타입에 따른 적절한 응답 생성
  let statusCode = 500;
  let errorMessage = '서버 내부 오류가 발생했습니다.';
  let errorCode = 'INTERNAL_SERVER_ERROR';

  // 특정 에러 타입별 처리
  if (err.name === 'ValidationError') {
    statusCode = 400;
    errorMessage = '입력 데이터가 유효하지 않습니다.';
    errorCode = 'VALIDATION_ERROR';
  } else if (err.name === 'UnauthorizedError' || err.status === 401) {
    statusCode = 401;
    errorMessage = '인증이 필요합니다.';
    errorCode = 'UNAUTHORIZED';
  } else if (err.status === 403) {
    statusCode = 403;
    errorMessage = '접근 권한이 없습니다.';
    errorCode = 'FORBIDDEN';
  } else if (err.status === 404) {
    statusCode = 404;
    errorMessage = '요청한 리소스를 찾을 수 없습니다.';
    errorCode = 'NOT_FOUND';
  } else if (err.name === 'CastError') {
    statusCode = 400;
    errorMessage = '잘못된 데이터 형식입니다.';
    errorCode = 'CAST_ERROR';
  } else if (err.code === 11000) { // MongoDB 중복 키 에러
    statusCode = 409;
    errorMessage = '중복된 데이터입니다.';
    errorCode = 'DUPLICATE_KEY';
  } else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorMessage = '유효하지 않은 토큰입니다.';
    errorCode = 'INVALID_TOKEN';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    errorMessage = '토큰이 만료되었습니다.';
    errorCode = 'TOKEN_EXPIRED';
  }

  // 개발 환경에서는 상세한 에러 정보 포함
  const errorResponse = {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      ...(process.env.NODE_ENV === 'development' && {
        stack: err.stack,
        details: err.message
      })
    }
  };

  // 응답 전송
  res.status(statusCode).json(errorResponse);
}

/**
 * 404 에러 처리 미들웨어
 * 존재하지 않는 라우트에 대한 요청을 처리
 * @param {Object} req - Express request 객체
 * @param {Object} res - Express response 객체
 * @param {Function} next - Express next 함수
 */
function notFoundHandler(req, res, next) {
  const error = new Error(`경로를 찾을 수 없습니다: ${req.originalUrl}`);
  error.status = 404;
  next(error);
}

/**
 * 비동기 함수의 에러를 자동으로 next()로 전달하는 래퍼 함수
 * @param {Function} fn - 비동기 함수
 * @returns {Function} Express 미들웨어 함수
 */
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * 프로세스 레벨 에러 핸들러 설정
 * uncaughtException과 unhandledRejection을 처리
 */
function setupProcessErrorHandlers() {
  // 캐치되지 않은 예외 처리
  process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err);

    // Slack으로 에러 전송
    const { sendJSErrorToSlack } = require('../utils/errorLogger');
    sendJSErrorToSlack(err, { type: 'uncaughtException' })
      .catch(slackError => {
        console.error('Slack 에러 전송 실패:', slackError.message);
      })
      .finally(() => {
        // 프로세스 종료
        process.exit(1);
      });
  });

  // 처리되지 않은 Promise rejection 처리
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);

    // Slack으로 에러 전송
    const { sendJSErrorToSlack } = require('../utils/errorLogger');
    const error = reason instanceof Error ? reason : new Error(String(reason));
    sendJSErrorToSlack(error, {
      type: 'unhandledRejection',
      promise: promise.toString()
    }).catch(slackError => {
      console.error('Slack 에러 전송 실패:', slackError.message);
    });
  });

  // SIGTERM 시그널 처리 (우아한 종료)
  process.on('SIGTERM', () => {
    console.log('SIGTERM 시그널을 받았습니다. 서버를 우아하게 종료합니다.');
    process.exit(0);
  });

  // SIGINT 시그널 처리 (Ctrl+C)
  process.on('SIGINT', () => {
    console.log('SIGINT 시그널을 받았습니다. 서버를 우아하게 종료합니다.');
    process.exit(0);
  });
}

module.exports = {
  globalErrorHandler,
  notFoundHandler,
  asyncHandler,
  setupProcessErrorHandlers
};