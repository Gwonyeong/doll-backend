const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const prisma = new PrismaClient();

/**
 * @route   POST /api/open-alerts
 * @desc    오픈 알림 신청
 * @access  Private (인증 필요)
 */
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { storeName, name, phone } = req.body;
    const userId = req.user.id;

    // 입력값 검증
    if (!storeName || !name || !phone) {
      return res.status(400).json({
        success: false,
        error: '모든 필드를 입력해주세요.'
      });
    }

    // 매장명 길이 제한
    if (storeName.length > 100) {
      return res.status(400).json({
        success: false,
        error: '매장명은 100자 이하로 입력해주세요.'
      });
    }

    // 성함 길이 제한
    if (name.length > 50) {
      return res.status(400).json({
        success: false,
        error: '성함은 50자 이하로 입력해주세요.'
      });
    }

    // 전화번호 형식 검증 (간단한 검증)
    const phoneRegex = /^[0-9-]+$/;
    if (!phoneRegex.test(phone) || phone.length < 10 || phone.length > 15) {
      return res.status(400).json({
        success: false,
        error: '올바른 전화번호 형식을 입력해주세요.'
      });
    }

    // 중복 신청 확인 (같은 사용자가 이미 신청했는지)
    const existingAlert = await prisma.openAlert.findFirst({
      where: {
        userId: userId
      }
    });

    if (existingAlert) {
      return res.status(409).json({
        success: false,
        error: '이미 오픈 알림을 신청하셨습니다.'
      });
    }

    // 오픈 알림 생성
    const openAlert = await prisma.openAlert.create({
      data: {
        userId: userId,
        storeName: storeName.trim(),
        name: name.trim(),
        phone: phone.trim()
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: openAlert.id,
        message: '오픈 알림 신청이 완료되었습니다.'
      }
    });

  } catch (error) {
    console.error('오픈 알림 신청 오류:', error);
    res.status(500).json({
      success: false,
      error: '오픈 알림 신청 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   GET /api/open-alerts/status
 * @desc    현재 사용자의 오픈 알림 신청 상태 확인
 * @access  Private (인증 필요)
 */
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const existingAlert = await prisma.openAlert.findFirst({
      where: {
        userId: userId
      }
    });

    res.json({
      success: true,
      data: {
        hasSubmitted: !!existingAlert,
        alert: existingAlert
      }
    });

  } catch (error) {
    console.error('오픈 알림 상태 확인 오류:', error);
    res.status(500).json({
      success: false,
      error: '오픈 알림 상태 확인 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   GET /api/open-alerts
 * @desc    오픈 알림 목록 조회 (관리자용)
 * @access  Private (관리자만)
 */
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 20, contacted } = req.query;

    // 페이지네이션 설정
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    // 필터 조건
    const where = {};
    if (contacted !== undefined) {
      where.contacted = contacted === 'true';
    }

    // 오픈 알림 목록 조회
    const [openAlerts, total] = await Promise.all([
      prisma.openAlert.findMany({
        where,
        skip,
        take,
        orderBy: {
          createdAt: 'desc'
        }
      }),
      prisma.openAlert.count({ where })
    ]);

    res.json({
      success: true,
      data: {
        openAlerts,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / parseInt(limit))
        }
      }
    });

  } catch (error) {
    console.error('오픈 알림 목록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '오픈 알림 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   PUT /api/open-alerts/:id/contact
 * @desc    오픈 알림 연락 완료 처리 (관리자용)
 * @access  Private (관리자만)
 */
router.put('/:id/contact', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    // 오픈 알림 존재 확인
    const openAlert = await prisma.openAlert.findUnique({
      where: { id }
    });

    if (!openAlert) {
      return res.status(404).json({
        success: false,
        error: '오픈 알림을 찾을 수 없습니다.'
      });
    }

    // 연락 완료 처리
    const updatedAlert = await prisma.openAlert.update({
      where: { id },
      data: {
        contacted: true,
        contactedAt: new Date(),
        adminNote: adminNote || null
      }
    });

    res.json({
      success: true,
      data: updatedAlert,
      message: '연락 완료 처리되었습니다.'
    });

  } catch (error) {
    console.error('오픈 알림 연락 완료 처리 오류:', error);
    res.status(500).json({
      success: false,
      error: '연락 완료 처리 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   DELETE /api/open-alerts/:id
 * @desc    오픈 알림 삭제 (관리자용)
 * @access  Private (관리자만)
 */
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // 오픈 알림 존재 확인
    const openAlert = await prisma.openAlert.findUnique({
      where: { id }
    });

    if (!openAlert) {
      return res.status(404).json({
        success: false,
        error: '오픈 알림을 찾을 수 없습니다.'
      });
    }

    // 오픈 알림 삭제
    await prisma.openAlert.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '오픈 알림이 삭제되었습니다.'
    });

  } catch (error) {
    console.error('오픈 알림 삭제 오류:', error);
    res.status(500).json({
      success: false,
      error: '오픈 알림 삭제 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;