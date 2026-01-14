const express = require("express");
const router = express.Router();
const { PrismaClient } = require("../generated/prisma");
const { authenticateToken } = require("../middleware/auth");

const prisma = new PrismaClient();

// 모든 광고 신청 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

/**
 * @route   POST /api/ad-requests
 * @desc    광고 신청 생성
 * @access  Private (인증 필요)
 */
router.post("/", async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    const {
      storeId,
      startDate,
      endDate,
      ownerName,
      ownerPhone,
      businessLicenseUrl,
      idCardUrl,
    } = req.body;

    // 필수 필드 검증
    if (!startDate || !endDate || !ownerName || !ownerPhone) {
      return res.status(400).json({
        success: false,
        error: "필수 정보를 모두 입력해주세요.",
      });
    }

    // 날짜 유효성 검증
    const start = new Date(startDate);
    const end = new Date(endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (start < today) {
      return res.status(400).json({
        success: false,
        error: "시작일은 오늘 이후여야 합니다.",
      });
    }

    if (end <= start) {
      return res.status(400).json({
        success: false,
        error: "종료일은 시작일보다 늦어야 합니다.",
      });
    }

    // 매장 존재 확인 (storeId가 제공된 경우)
    if (storeId) {
      const store = await prisma.gameBusiness.findUnique({
        where: { id: parseInt(storeId) },
      });

      if (!store) {
        return res.status(404).json({
          success: false,
          error: "선택한 매장을 찾을 수 없습니다.",
        });
      }
    }

    // 광고 신청 생성
    const adRequest = await prisma.adRequest.create({
      data: {
        userId,
        storeId: storeId ? parseInt(storeId) : null,
        startDate: start,
        endDate: end,
        ownerName: ownerName.trim(),
        ownerPhone: ownerPhone.trim(),
        businessLicenseUrl,
        idCardUrl,
        status: "pending",
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: adRequest.id,
        message: "광고 신청이 성공적으로 접수되었습니다.",
        adRequest: {
          id: adRequest.id,
          startDate: adRequest.startDate,
          endDate: adRequest.endDate,
          ownerName: adRequest.ownerName,
          status: adRequest.status,
          store: adRequest.store,
          createdAt: adRequest.createdAt,
        },
      },
    });
  } catch (error) {
    console.error("광고 신청 생성 오류:", error);
    res.status(500).json({
      success: false,
      error: "광고 신청 처리 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   GET /api/ad-requests/user
 * @desc    사용자의 광고 신청 목록 조회
 * @access  Private (인증 필요)
 */
router.get("/user", async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    const adRequests = await prisma.adRequest.findMany({
      where: {
        userId: userId,
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
          },
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    const processedRequests = adRequests.map((request) => ({
      id: request.id,
      startDate: request.startDate,
      endDate: request.endDate,
      ownerName: request.ownerName,
      ownerPhone: request.ownerPhone,
      status: request.status,
      store: request.store
        ? {
            id: request.store.id,
            name: request.store.사업장명,
            address: request.store.소재지전체주소,
          }
        : null,
      adminNote: request.adminNote,
      createdAt: request.createdAt,
      approvedAt: request.approvedAt,
    }));

    res.json({
      success: true,
      data: processedRequests,
    });
  } catch (error) {
    console.error("광고 신청 목록 조회 오류:", error);
    res.status(500).json({
      success: false,
      error: "광고 신청 목록 조회 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   GET /api/ad-requests/:id
 * @desc    특정 광고 신청 상세 조회
 * @access  Private (인증 필요)
 */
router.get("/:id", async (req, res) => {
  try {
    const userId = req.user?.id;
    const requestId = req.params.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    const adRequest = await prisma.adRequest.findUnique({
      where: {
        id: requestId,
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
          },
        },
        user: {
          select: {
            id: true,
            nickname: true,
          },
        },
      },
    });

    if (!adRequest) {
      return res.status(404).json({
        success: false,
        error: "광고 신청을 찾을 수 없습니다.",
      });
    }

    // 본인의 신청만 조회 가능 (관리자 권한 추후 확장 가능)
    if (adRequest.userId !== userId) {
      return res.status(403).json({
        success: false,
        error: "접근 권한이 없습니다.",
      });
    }

    const processedRequest = {
      id: adRequest.id,
      startDate: adRequest.startDate,
      endDate: adRequest.endDate,
      ownerName: adRequest.ownerName,
      ownerPhone: adRequest.ownerPhone,
      businessLicenseUrl: adRequest.businessLicenseUrl,
      idCardUrl: adRequest.idCardUrl,
      status: adRequest.status,
      store: adRequest.store
        ? {
            id: adRequest.store.id,
            name: adRequest.store.사업장명,
            address: adRequest.store.소재지전체주소,
          }
        : null,
      adminNote: adRequest.adminNote,
      createdAt: adRequest.createdAt,
      approvedAt: adRequest.approvedAt,
      approvedBy: adRequest.approvedBy,
    };

    res.json({
      success: true,
      data: processedRequest,
    });
  } catch (error) {
    console.error("광고 신청 상세 조회 오류:", error);
    res.status(500).json({
      success: false,
      error: "광고 신청 상세 조회 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   GET /api/ad-requests
 * @desc    모든 광고 신청 목록 조회 (관리자용)
 * @access  Private (관리자 인증 필요)
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    // TODO: 관리자 권한 확인 로직 추가
    // 현재는 모든 인증된 사용자가 조회 가능

    const { status, page = 1, limit = 10 } = req.query;
    const skip = (page - 1) * limit;

    const where = {};
    if (status) {
      where.status = status;
    }

    const [adRequests, total] = await Promise.all([
      prisma.adRequest.findMany({
        where,
        include: {
          store: {
            select: {
              id: true,
              사업장명: true,
              소재지전체주소: true,
            },
          },
          user: {
            select: {
              id: true,
              nickname: true,
              phone: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: parseInt(skip),
        take: parseInt(limit),
      }),
      prisma.adRequest.count({ where }),
    ]);

    const processedRequests = adRequests.map((request) => ({
      id: request.id,
      startDate: request.startDate,
      endDate: request.endDate,
      ownerName: request.ownerName,
      ownerPhone: request.ownerPhone,
      status: request.status,
      store: request.store
        ? {
            id: request.store.id,
            name: request.store.사업장명,
            address: request.store.소재지전체주소,
          }
        : null,
      user: {
        id: request.user.id,
        nickname: request.user.nickname,
        phone: request.user.phone,
      },
      adminNote: request.adminNote,
      createdAt: request.createdAt,
      approvedAt: request.approvedAt,
      approvedBy: request.approvedBy,
    }));

    res.json({
      success: true,
      data: {
        adRequests: processedRequests,
        pagination: {
          total,
          page: parseInt(page),
          limit: parseInt(limit),
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("광고 신청 목록 조회 오류:", error);
    res.status(500).json({
      success: false,
      error: "광고 신청 목록 조회 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   PUT /api/ad-requests/:id/status
 * @desc    광고 신청 상태 업데이트 (관리자용)
 * @access  Private (관리자 인증 필요)
 */
router.put("/:id/status", async (req, res) => {
  try {
    const userId = req.user?.id;
    const requestId = req.params.id;
    const { status, adminNote } = req.body;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    // TODO: 관리자 권한 확인 로직 추가

    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({
        success: false,
        error: "유효하지 않은 상태입니다.",
      });
    }

    const existingRequest = await prisma.adRequest.findUnique({
      where: { id: requestId },
    });

    if (!existingRequest) {
      return res.status(404).json({
        success: false,
        error: "광고 신청을 찾을 수 없습니다.",
      });
    }

    const updatedRequest = await prisma.adRequest.update({
      where: { id: requestId },
      data: {
        status,
        adminNote,
        approvedAt: status === "approved" ? new Date() : null,
        approvedBy: status === "approved" ? userId : null,
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
          },
        },
      },
    });

    res.json({
      success: true,
      data: {
        id: updatedRequest.id,
        status: updatedRequest.status,
        adminNote: updatedRequest.adminNote,
        approvedAt: updatedRequest.approvedAt,
        approvedBy: updatedRequest.approvedBy,
        message: `광고 신청이 ${
          status === "approved"
            ? "승인"
            : status === "rejected"
            ? "거절"
            : "대기중으로 변경"
        }되었습니다.`,
      },
    });
  } catch (error) {
    console.error("광고 신청 상태 업데이트 오류:", error);
    res.status(500).json({
      success: false,
      error: "광고 신청 상태 업데이트 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;