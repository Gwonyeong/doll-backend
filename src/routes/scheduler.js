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
 * Vercel Cron Job 전용 엔드포인트 - 일일 리포트
 * GET /api/scheduler/cron/daily-report
 *
 * Vercel Cron이 매일 UTC 00:00 (KST 09:00)에 호출
 * CRON_SECRET 환경변수로 보안 검증
 */
router.get('/cron/daily-report', async (req, res) => {
  try {
    // Vercel Cron 인증 검증
    const authHeader = req.headers.authorization;
    const cronSecret = process.env.CRON_SECRET;

    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      console.log('🚫 Cron 인증 실패 - 잘못된 Authorization 헤더');
      return res.status(401).json({
        success: false,
        message: 'Unauthorized',
        timestamp: new Date().toISOString()
      });
    }

    console.log('⏰ Vercel Cron: 일일 리포트 실행 시작');

    const result = await triggerDailyReport();

    if (result) {
      console.log('✅ Vercel Cron: 일일 리포트 전송 완료');
      res.json({
        success: true,
        message: '일일 리포트가 슬랙으로 전송되었습니다.',
        timestamp: new Date().toISOString()
      });
    } else {
      console.error('❌ Vercel Cron: 일일 리포트 전송 실패');
      res.status(500).json({
        success: false,
        message: '일일 리포트 전송에 실패했습니다.',
        timestamp: new Date().toISOString()
      });
    }
  } catch (error) {
    console.error('❌ Vercel Cron 실행 중 오류:', error);
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