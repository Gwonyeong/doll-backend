const cron = require('node-cron');
const { sendDailyReport } = require('../services/schedulerSlack');

/**
 * 스케줄러 초기화 함수
 */
function initScheduler() {
  console.log('📅 스케줄러 초기화 중...');

  // 매일 오전 9시에 일일 리포트 전송
  // 크론 표현식: 분(0) 시(9) 일(*) 월(*) 요일(*)
  cron.schedule('0 9 * * *', async () => {
    console.log('🚀 일일 리포트 스케줄 실행');
    await sendDailyReport();
  }, {
    scheduled: true,
    timezone: "Asia/Seoul"
  });

  console.log('✅ 일일 리포트 스케줄러 등록 완료 (매일 오전 9시)');

  // 개발 환경에서만 테스트용 로그 출력
  if (process.env.NODE_ENV === 'development') {
    console.log('📌 [개발 모드] 테스트 API 사용 가능: GET /api/scheduler/test-daily-report');
  }
}

/**
 * 수동으로 일일 리포트를 전송하는 함수 (테스트용)
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function triggerDailyReport() {
  console.log('📬 일일 리포트 수동 전송 시작...');
  return await sendDailyReport();
}

/**
 * 모든 스케줄 중지
 */
function stopAllSchedules() {
  console.log('🛑 모든 스케줄 중지...');
  cron.getTasks().forEach(task => task.stop());
  console.log('✅ 모든 스케줄이 중지되었습니다.');
}

module.exports = {
  initScheduler,
  triggerDailyReport,
  stopAllSchedules
};