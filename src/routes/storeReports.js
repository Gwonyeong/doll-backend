const express = require('express');
const router = express.Router();
const { PrismaClient } = require('../generated/prisma');
const { authenticateToken } = require('../middleware/auth');

const prisma = new PrismaClient();

// 모든 매장 제보 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

/**
 * @route   GET /api/store-reports
 * @desc    사용자의 매장 제보 목록 조회
 * @access  Private (인증 필요)
 */
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '로그인이 필요합니다.'
      });
    }

    // 사용자의 매장 제보 목록 조회
    const storeReports = await prisma.storeReport.findMany({
      where: {
        userId: userId
      },
      orderBy: {
        createdAt: 'desc' // 최근 제보한 순으로 정렬
      },
      include: {
        approvedStore: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
            영업상태명: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: storeReports
    });

  } catch (error) {
    console.error('매장 제보 목록 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '매장 제보 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   POST /api/store-reports
 * @desc    새로운 매장 제보
 * @access  Private (인증 필요)
 */
router.post('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    const { storeName, address, phone, description, latitude, longitude } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '로그인이 필요합니다.'
      });
    }

    // 필수 필드 검증
    if (!storeName || !address) {
      return res.status(400).json({
        success: false,
        error: '매장명과 주소는 필수 항목입니다.'
      });
    }

    // 중복 제보 방지 (같은 사용자가 같은 매장명과 주소로 제보하는 경우)
    const existingReport = await prisma.storeReport.findFirst({
      where: {
        userId: userId,
        storeName: storeName,
        address: address,
        status: {
          not: 'rejected' // 거절된 제보가 아닌 경우만 중복으로 처리
        }
      }
    });

    if (existingReport) {
      return res.status(409).json({
        success: false,
        error: '이미 제보한 매장입니다.'
      });
    }

    // 새로운 매장 제보 생성
    const storeReport = await prisma.storeReport.create({
      data: {
        userId: userId,
        storeName: storeName.trim(),
        address: address.trim(),
        phone: phone?.trim() || null,
        description: description?.trim() || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null,
        status: 'pending'
      }
    });

    res.status(201).json({
      success: true,
      data: {
        id: storeReport.id,
        message: `${storeName} 매장 제보가 성공적으로 등록되었습니다.`
      }
    });

  } catch (error) {
    console.error('매장 제보 등록 오류:', error);
    res.status(500).json({
      success: false,
      error: '매장 제보 등록 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   GET /api/store-reports/:id
 * @desc    특정 매장 제보 상세 조회
 * @access  Private (인증 필요)
 */
router.get('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '로그인이 필요합니다.'
      });
    }

    // 자신의 제보만 조회 가능
    const storeReport = await prisma.storeReport.findFirst({
      where: {
        id: reportId,
        userId: userId
      },
      include: {
        approvedStore: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
            영업상태명: true,
            좌표정보x: true,
            좌표정보y: true
          }
        }
      }
    });

    if (!storeReport) {
      return res.status(404).json({
        success: false,
        error: '매장 제보를 찾을 수 없습니다.'
      });
    }

    res.json({
      success: true,
      data: storeReport
    });

  } catch (error) {
    console.error('매장 제보 상세 조회 오류:', error);
    res.status(500).json({
      success: false,
      error: '매장 제보 상세 조회 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   PUT /api/store-reports/:id
 * @desc    매장 제보 수정 (pending 상태일 때만 가능)
 * @access  Private (인증 필요)
 */
router.put('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = req.params.id;
    const { storeName, address, phone, description, latitude, longitude } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '로그인이 필요합니다.'
      });
    }

    // 기존 제보 확인
    const existingReport = await prisma.storeReport.findFirst({
      where: {
        id: reportId,
        userId: userId
      }
    });

    if (!existingReport) {
      return res.status(404).json({
        success: false,
        error: '매장 제보를 찾을 수 없습니다.'
      });
    }

    // pending 상태일 때만 수정 가능
    if (existingReport.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: '검토 중이거나 처리된 제보는 수정할 수 없습니다.'
      });
    }

    // 필수 필드 검증
    if (!storeName || !address) {
      return res.status(400).json({
        success: false,
        error: '매장명과 주소는 필수 항목입니다.'
      });
    }

    // 매장 제보 수정
    const updatedReport = await prisma.storeReport.update({
      where: {
        id: reportId
      },
      data: {
        storeName: storeName.trim(),
        address: address.trim(),
        phone: phone?.trim() || null,
        description: description?.trim() || null,
        latitude: latitude ? parseFloat(latitude) : null,
        longitude: longitude ? parseFloat(longitude) : null
      }
    });

    res.json({
      success: true,
      data: {
        id: updatedReport.id,
        message: '매장 제보가 성공적으로 수정되었습니다.'
      }
    });

  } catch (error) {
    console.error('매장 제보 수정 오류:', error);
    res.status(500).json({
      success: false,
      error: '매장 제보 수정 중 오류가 발생했습니다.'
    });
  }
});

/**
 * @route   DELETE /api/store-reports/:id
 * @desc    매장 제보 삭제 (pending 상태일 때만 가능)
 * @access  Private (인증 필요)
 */
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    const reportId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: '로그인이 필요합니다.'
      });
    }

    // 기존 제보 확인
    const existingReport = await prisma.storeReport.findFirst({
      where: {
        id: reportId,
        userId: userId
      }
    });

    if (!existingReport) {
      return res.status(404).json({
        success: false,
        error: '매장 제보를 찾을 수 없습니다.'
      });
    }

    // pending 상태일 때만 삭제 가능
    if (existingReport.status !== 'pending') {
      return res.status(400).json({
        success: false,
        error: '검토 중이거나 처리된 제보는 삭제할 수 없습니다.'
      });
    }

    // 매장 제보 삭제
    await prisma.storeReport.delete({
      where: {
        id: reportId
      }
    });

    res.json({
      success: true,
      data: {
        message: '매장 제보가 성공적으로 삭제되었습니다.'
      }
    });

  } catch (error) {
    console.error('매장 제보 삭제 오류:', error);
    res.status(500).json({
      success: false,
      error: '매장 제보 삭제 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;