const express = require('express');
const router = express.Router();
const { triggerDailyReport } = require('../scheduler');

/**
 * 테스트용 - 일일 리포트 수동 실행
 * GET /api/scheduler/test-daily-report
 */
router.get('/test-daily-report', async (req, res) => {
  try {
    console.log('📧 일일 리포트 테스트 시작...');

    const result = await triggerDailyReport();

    if (result) {
      res.json({
        success: true,
        message: '일일 리포트가 슬랙으로 전송되었습니다.',
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(500).json({
        success: false,
        message: '일일 리포트 전송에 실패했습니다.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('일일 리포트 테스트 중 오류:', error);
    res.status(500).json({
      success: false,
      message: '일일 리포트 실행 중 오류가 발생했습니다.',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * 스케줄러 상태 확인
 * GET /api/scheduler/status
 */
router.get('/status', (req, res) => {
  const cron = require('node-cron');
  const tasks = cron.getTasks();

  res.json({
    success: true,
    message: '스케줄러 상태',
    data: {
      activeSchedules: tasks.size,
      environment: process.env.NODE_ENV || 'development',
      timezone: 'Asia/Seoul',
      schedules: [
        {
          name: '일일 리포트',
          schedule: '매일 오전 9시',
          cron: '0 9 * * *',
          description: '어제 하루의 통계를 집계하여 슬랙으로 전송'
        }
      ]
    },
    timestamp: new Date().toISOString()
  });
});

module.exports = router;