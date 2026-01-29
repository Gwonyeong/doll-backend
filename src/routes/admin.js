const express = require('express');
const { prisma } = require('../services/prisma');
const proj4 = require("proj4");
// const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// EPSG:5174 (Korea 2000 / Central Belt 2010) 좌표계 정의
const epsg5174 =
  "+proj=tmerc +lat_0=38 +lon_0=127 +k=1 +x_0=200000 +y_0=500000 +ellps=GRS80 +units=m +no_defs";

// WGS84 좌표계 정의
const wgs84 = "+proj=longlat +datum=WGS84 +no_defs";

// TM 좌표계(EPSG:5174)를 WGS84(위도/경도)로 변환하는 함수
function tmToWgs84(x, y) {
  try {
    const tmX = parseFloat(x);
    const tmY = parseFloat(y);

    // NaN, Infinity 체크
    if (!isFinite(tmX) || !isFinite(tmY) || isNaN(tmX) || isNaN(tmY)) {
      return { lat: 37.5665, lng: 126.978 }; // 서울 중심 기본값
    }

    // 이미 WGS84 좌표계인 경우 (경도 100~140, 위도 30~45 범위)
    if (tmX >= 100 && tmX <= 140 && tmY >= 30 && tmY <= 45) {
      return { lat: tmY, lng: tmX };
    }

    // TM 좌표계 유효 범위 체크 (한국 좌표 범위)
    if (tmX < 50000 || tmX > 350000 || tmY < 0 || tmY > 700000) {
      return { lat: 37.5665, lng: 126.978 };
    }

    // proj4를 사용한 정확한 좌표 변환
    const [lng, lat] = proj4(epsg5174, wgs84, [tmX, tmY]);

    // 시스템적 오차 보정 (평균 오차 적용)
    // 분석 결과: 위도 +0.002747도, 경도 +0.000790도 보정 필요
    const correctedLat = lat + 0.002747;
    const correctedLng = lng + 0.00079;

    return {
      lat: Math.max(33, Math.min(43, correctedLat)),
      lng: Math.max(124, Math.min(132, correctedLng)),
    };
  } catch (error) {
    // 서울 중심 기본값
    return { lat: 37.5665, lng: 126.978 };
  }
}

// 인증 요구사항 제거 - 개발환경에서 어드민 대시보드 접근 편의성을 위해
// router.use(authenticateToken);
// router.use(requireAdmin);

/**
 * GET /api/admin/stats
 * 대시보드 통계 데이터
 */
router.get('/stats', async (req, res) => {
  try {
    const [
      totalStores,
      activeStores,
      totalReviews,
      totalUsers,
      recentReviews,
      pendingStoreReports,
      totalFavorites,
      recentFavorites,
      pendingOpenAlerts,
      pendingAdRequests,
      totalAdRequests,
      approvedAdRequests
    ] = await Promise.all([
      // 전체 매장 수
      prisma.gameBusiness.count(),

      // 영업 중인 매장 수
      prisma.gameBusiness.count({
        where: { 영업상태명: '영업/정상' }
      }),

      // 전체 리뷰 수
      prisma.review.count(),

      // 전체 사용자 수
      prisma.user.count(),

      // 최근 리뷰 (최근 7일)
      prisma.review.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),

      // pending 상태인 매장 제보 수
      prisma.storeReport.count({
        where: { status: 'pending' }
      }),

      // 전체 즐겨찾기 수
      prisma.favorite.count(),

      // 최근 즐겨찾기 (최근 7일)
      prisma.favorite.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
          }
        }
      }),

      // contacted가 false인 오픈 알림 수
      prisma.openAlert.count({
        where: { contacted: false }
      }),

      // pending 상태인 광고 신청 수
      prisma.adRequest.count({
        where: { status: 'pending' }
      }),

      // 전체 광고 신청 수
      prisma.adRequest.count(),

      // 승인된 광고 신청 수
      prisma.adRequest.count({
        where: { status: 'approved' }
      })
    ]);

    // 월별 리뷰 통계 (최근 6개월)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const monthlyReviews = await prisma.review.groupBy({
      by: ['createdAt'],
      where: {
        createdAt: {
          gte: sixMonthsAgo
        }
      },
      _count: {
        id: true
      }
    });

    // 월별 데이터 정리
    const monthlyStats = {};
    monthlyReviews.forEach(review => {
      const month = review.createdAt.toISOString().substring(0, 7); // YYYY-MM
      monthlyStats[month] = (monthlyStats[month] || 0) + review._count.id;
    });

    res.json({
      success: true,
      data: {
        overview: {
          totalStores,
          activeStores,
          totalReviews,
          totalUsers,
          recentReviews,
          totalFavorites,
          recentFavorites,
          pendingStoreReports,
          pendingOpenAlerts,
          pendingAdRequests,
          totalAdRequests,
          approvedAdRequests
        },
        monthlyReviews: monthlyStats
      }
    });

  } catch (error) {
    console.error('관리자 통계 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '통계 데이터를 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/stores
 * 매장 관리 목록
 */
router.get('/stores', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      sortBy = 'updatedAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (search) {
      whereClause.OR = [
        { 사업장명: { contains: search, mode: 'insensitive' } },
        { 소재지전체주소: { contains: search, mode: 'insensitive' } },
        { 도로명전체주소: { contains: search, mode: 'insensitive' } }
      ];
    }

    if (status) {
      whereClause.영업상태명 = status;
    }

    // 정렬 조건
    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [stores, totalCount] = await Promise.all([
      prisma.gameBusiness.findMany({
        where: whereClause,
        include: {
          reviews: {
            select: {
              id: true,
              rating: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.gameBusiness.count({ where: whereClause })
    ]);

    // 매장 데이터 가공
    const formattedStores = stores.map(store => {
      const ratings = store.reviews.map(r => r.rating);
      const avgRating = ratings.length > 0 ?
        ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length : 0;

      return {
        id: store.id,
        name: store.사업장명,
        address: store.도로명전체주소 || store.소재지전체주소,
        phone: store.소재지전화,
        status: store.영업상태명,
        businessType: store.업태구분명,
        gameCount: store.총게임기수,
        reviewCount: store.reviews.length,
        averageRating: Math.round(avgRating * 10) / 10,
        lastUpdated: store.최종수정시점,
        createdAt: store.createdAt,
        updatedAt: store.updatedAt
      };
    });

    res.json({
      success: true,
      data: formattedStores,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 매장 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '매장 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/reviews
 * 리뷰 관리 목록
 */
router.get('/reviews', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      storeId,
      rating,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (storeId) {
      whereClause.storeId = parseInt(storeId);
    }

    if (rating) {
      whereClause.rating = parseInt(rating);
    }

    // 정렬 조건
    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: whereClause,
        include: {
          store: {
            select: {
              id: true,
              사업장명: true,
              소재지전체주소: true
            }
          },
          user: {
            select: {
              id: true,
              nickname: true,
              email: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.review.count({ where: whereClause })
    ]);

    const formattedReviews = reviews.map(review => ({
      id: review.id,
      rating: review.rating,
      content: review.content,
      images: review.images,
      tags: review.tags,
      dollCount: review.dollCount,
      spentAmount: review.spentAmount,
      dollImages: review.dollImages,
      store: {
        id: review.store.id,
        name: review.store.사업장명,
        address: review.store.소재지전체주소
      },
      user: review.user ? {
        id: review.user.id,
        nickname: review.user.nickname,
        email: review.user.email
      } : {
        nickname: review.userName
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    }));

    res.json({
      success: true,
      data: formattedReviews,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 리뷰 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * DELETE /api/admin/reviews/:id
 * 리뷰 삭제 (관리자)
 */
router.delete('/reviews/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      return res.status(404).json({
        error: 'Not Found',
        message: '리뷰를 찾을 수 없습니다.'
      });
    }

    await prisma.review.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '리뷰가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('관리자 리뷰 삭제 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 삭제 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/users
 * 사용자 관리 목록
 */
router.get('/users', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (search) {
      whereClause.OR = [
        { nickname: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { name: { contains: search, mode: 'insensitive' } }
      ];
    }

    // 정렬 조건
    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [users, totalCount] = await Promise.all([
      prisma.user.findMany({
        where: whereClause,
        include: {
          reviews: {
            select: {
              id: true,
              rating: true,
              createdAt: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.user.count({ where: whereClause })
    ]);

    const formattedUsers = users.map(user => ({
      id: user.id,
      tossId: user.tossId,
      nickname: user.nickname,
      email: user.email,
      name: user.name,
      phone: user.phone,
      reviewCount: user.reviews.length,
      lastReviewAt: user.reviews.length > 0 ?
        Math.max(...user.reviews.map(r => new Date(r.createdAt).getTime())) : null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    }));

    res.json({
      success: true,
      data: formattedUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 사용자 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '사용자 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/store-reports
 * 제보 목록 관리 (관리자용)
 */
router.get('/store-reports', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (status) {
      whereClause.status = status;
    }

    // 먼저 데이터를 가져온 후 정렬
    const [allReports, totalCount] = await Promise.all([
      prisma.storeReport.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              nickname: true,
              phone: true
            }
          }
        }
      }),
      prisma.storeReport.count({ where: whereClause })
    ]);

    // 상태 우선순위 정의 (pending이 가장 높은 우선순위)
    const statusPriority = {
      'pending': 1,
      'approved': 2,
      'rejected': 3
    };

    // 커스텀 정렬: 1) 상태별 우선순위, 2) 지정된 정렬 조건
    const sortedReports = allReports.sort((a, b) => {
      // 첫 번째 정렬: 상태 우선순위
      const statusA = statusPriority[a.status] || 999;
      const statusB = statusPriority[b.status] || 999;

      if (statusA !== statusB) {
        return statusA - statusB;
      }

      // 두 번째 정렬: 지정된 컬럼
      const valueA = a[sortBy];
      const valueB = b[sortBy];

      if (sortOrder === 'desc') {
        return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
      } else {
        return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
      }
    });

    // 페이지네이션 적용
    const reports = sortedReports.slice(offset, offset + parseInt(limit));

    res.json({
      success: true,
      data: reports,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 제보 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '제보 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/store-reports/:id/status
 * 제보 상태 변경 (관리자용)
 */
router.patch('/store-reports/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '유효하지 않은 상태입니다. (pending, approved, rejected 중 선택)'
      });
    }

    const report = await prisma.storeReport.findUnique({
      where: { id }
    });

    if (!report) {
      return res.status(404).json({
        error: 'Not Found',
        message: '제보를 찾을 수 없습니다.'
      });
    }

    const updatedReport = await prisma.storeReport.update({
      where: { id },
      data: {
        status,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updatedReport,
      message: '제보 상태가 변경되었습니다.'
    });

  } catch (error) {
    console.error('관리자 제보 상태 변경 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '제보 상태 변경 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/store-reports/:id/note
 * 제보 관리자 메모 수정 (관리자용)
 */
router.patch('/store-reports/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const report = await prisma.storeReport.findUnique({
      where: { id }
    });

    if (!report) {
      return res.status(404).json({
        error: 'Not Found',
        message: '제보를 찾을 수 없습니다.'
      });
    }

    const updatedReport = await prisma.storeReport.update({
      where: { id },
      data: {
        adminNote,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updatedReport,
      message: '관리자 메모가 수정되었습니다.'
    });

  } catch (error) {
    console.error('관리자 제보 메모 수정 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '제보 메모 수정 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/open-alerts
 * 오픈 알림 목록 조회 (관리자용)
 */
router.get('/open-alerts', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      contacted,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (contacted !== undefined) {
      whereClause.contacted = contacted === 'true';
    }

    // 정렬 조건
    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [alerts, totalCount] = await Promise.all([
      prisma.openAlert.findMany({
        where: whereClause,
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.openAlert.count({ where: whereClause })
    ]);

    res.json({
      success: true,
      data: alerts,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 오픈 알림 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '오픈 알림 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/open-alerts/:id/contact
 * 오픈 알림 연락 완료 처리 (관리자용)
 */
router.patch('/open-alerts/:id/contact', async (req, res) => {
  try {
    const { id } = req.params;
    const { contacted, adminNote } = req.body;

    const alert = await prisma.openAlert.findUnique({
      where: { id }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Not Found',
        message: '오픈 알림을 찾을 수 없습니다.'
      });
    }

    const updateData = {
      contacted: contacted !== undefined ? contacted : true,
      updatedAt: new Date()
    };

    if (contacted) {
      updateData.contactedAt = new Date();
    }

    if (adminNote !== undefined) {
      updateData.adminNote = adminNote;
    }

    const updatedAlert = await prisma.openAlert.update({
      where: { id },
      data: updateData
    });

    res.json({
      success: true,
      data: updatedAlert,
      message: '오픈 알림 상태가 변경되었습니다.'
    });

  } catch (error) {
    console.error('관리자 오픈 알림 상태 변경 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '오픈 알림 상태 변경 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/open-alerts/:id/note
 * 오픈 알림 관리자 메모 수정 (관리자용)
 */
router.patch('/open-alerts/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const alert = await prisma.openAlert.findUnique({
      where: { id }
    });

    if (!alert) {
      return res.status(404).json({
        error: 'Not Found',
        message: '오픈 알림을 찾을 수 없습니다.'
      });
    }

    const updatedAlert = await prisma.openAlert.update({
      where: { id },
      data: {
        adminNote,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updatedAlert,
      message: '관리자 메모가 수정되었습니다.'
    });

  } catch (error) {
    console.error('관리자 오픈 알림 메모 수정 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '오픈 알림 메모 수정 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/reviews
 * 리뷰 목록 조회 (관리자용)
 */
router.get('/reviews', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      storeId,
      rating,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (storeId) {
      whereClause.storeId = parseInt(storeId);
    }

    if (rating) {
      whereClause.rating = parseInt(rating);
    }

    // 정렬 조건
    const orderBy = {};
    orderBy[sortBy] = sortOrder;

    const [reviews, totalCount] = await Promise.all([
      prisma.review.findMany({
        where: whereClause,
        include: {
          store: {
            select: {
              id: true,
              사업장명: true,
              소재지전체주소: true
            }
          },
          user: {
            select: {
              id: true,
              nickname: true,
              email: true
            }
          }
        },
        orderBy,
        skip: offset,
        take: parseInt(limit)
      }),
      prisma.review.count({ where: whereClause })
    ]);

    const formattedReviews = reviews.map(review => ({
      id: review.id,
      rating: review.rating,
      content: review.content,
      images: review.images,
      tags: review.tags,
      dollCount: review.dollCount,
      spentAmount: review.spentAmount,
      dollImages: review.dollImages,
      store: {
        id: review.store?.id,
        name: review.store?.사업장명,
        address: review.store?.소재지전체주소
      },
      user: review.user ? {
        id: review.user.id,
        nickname: review.user.nickname,
        email: review.user.email
      } : {
        nickname: review.userName || 'Unknown'
      },
      createdAt: review.createdAt,
      updatedAt: review.updatedAt
    }));

    res.json({
      success: true,
      data: formattedReviews,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 리뷰 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * DELETE /api/admin/reviews/:id
 * 리뷰 삭제 (관리자용)
 */
router.delete('/reviews/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      return res.status(404).json({
        error: 'Not Found',
        message: '리뷰를 찾을 수 없습니다.'
      });
    }

    await prisma.review.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '리뷰가 삭제되었습니다.'
    });

  } catch (error) {
    console.error('관리자 리뷰 삭제 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 삭제 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/ad-requests
 * 광고 신청 목록 조회 (관리자용)
 */
router.get('/ad-requests', async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);

    // 검색 조건 구성
    let whereClause = {};

    if (status) {
      whereClause.status = status;
    }

    // 먼저 데이터를 가져온 후 정렬
    const [allAdRequests, totalCount] = await Promise.all([
      prisma.adRequest.findMany({
        where: whereClause,
        include: {
          user: {
            select: {
              id: true,
              nickname: true,
              email: true,
              phone: true
            }
          },
          store: {
            select: {
              id: true,
              사업장명: true,
              소재지전체주소: true,
              도로명전체주소: true
            }
          }
        }
      }),
      prisma.adRequest.count({ where: whereClause })
    ]);

    // 상태 우선순위 정의 (pending이 가장 높은 우선순위)
    const statusPriority = {
      'pending': 1,
      'approved': 2,
      'rejected': 3
    };

    // 커스텀 정렬: 1) 상태별 우선순위, 2) 지정된 정렬 조건
    const sortedAdRequests = allAdRequests.sort((a, b) => {
      // 첫 번째 정렬: 상태 우선순위
      const statusA = statusPriority[a.status] || 999;
      const statusB = statusPriority[b.status] || 999;

      if (statusA !== statusB) {
        return statusA - statusB;
      }

      // 두 번째 정렬: 지정된 컬럼
      const valueA = a[sortBy];
      const valueB = b[sortBy];

      if (sortOrder === 'desc') {
        return valueA < valueB ? 1 : valueA > valueB ? -1 : 0;
      } else {
        return valueA > valueB ? 1 : valueA < valueB ? -1 : 0;
      }
    });

    // 페이지네이션 적용
    const adRequests = sortedAdRequests.slice(offset, offset + parseInt(limit));

    // 응답 데이터 포맷팅
    const formattedAdRequests = adRequests.map(request => ({
      id: request.id,
      user: {
        id: request.user.id,
        nickname: request.user.nickname,
        email: request.user.email,
        phone: request.user.phone
      },
      store: request.store ? {
        id: request.store.id,
        name: request.store.사업장명,
        address: request.store.도로명전체주소 || request.store.소재지전체주소
      } : null,
      startDate: request.startDate,
      endDate: request.endDate,
      ownerName: request.ownerName,
      ownerPhone: request.ownerPhone,
      businessLicenseUrl: request.businessLicenseUrl,
      idCardUrl: request.idCardUrl,
      status: request.status,
      adminNote: request.adminNote,
      approvedAt: request.approvedAt,
      approvedBy: request.approvedBy,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt
    }));

    res.json({
      success: true,
      data: formattedAdRequests,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: totalCount,
        totalPages: Math.ceil(totalCount / parseInt(limit))
      }
    });

  } catch (error) {
    console.error('관리자 광고 신청 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '광고 신청 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/ad-requests/:id
 * 광고 신청 상세 조회 (관리자용)
 */
router.get('/ad-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const adRequest = await prisma.adRequest.findUnique({
      where: { id },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            email: true,
            phone: true,
            name: true
          }
        },
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
            도로명전체주소: true,
            소재지전화: true,
            영업상태명: true
          }
        }
      }
    });

    if (!adRequest) {
      return res.status(404).json({
        error: 'Not Found',
        message: '광고 신청을 찾을 수 없습니다.'
      });
    }

    const formattedAdRequest = {
      id: adRequest.id,
      user: {
        id: adRequest.user.id,
        nickname: adRequest.user.nickname,
        email: adRequest.user.email,
        phone: adRequest.user.phone,
        name: adRequest.user.name
      },
      store: adRequest.store ? {
        id: adRequest.store.id,
        name: adRequest.store.사업장명,
        address: adRequest.store.도로명전체주소 || adRequest.store.소재지전체주소,
        phone: adRequest.store.소재지전화,
        status: adRequest.store.영업상태명
      } : null,
      startDate: adRequest.startDate,
      endDate: adRequest.endDate,
      ownerName: adRequest.ownerName,
      ownerPhone: adRequest.ownerPhone,
      businessLicenseUrl: adRequest.businessLicenseUrl,
      idCardUrl: adRequest.idCardUrl,
      status: adRequest.status,
      adminNote: adRequest.adminNote,
      approvedAt: adRequest.approvedAt,
      approvedBy: adRequest.approvedBy,
      createdAt: adRequest.createdAt,
      updatedAt: adRequest.updatedAt
    };

    res.json({
      success: true,
      data: formattedAdRequest
    });

  } catch (error) {
    console.error('관리자 광고 신청 상세 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '광고 신청 상세 정보를 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/ad-requests/:id/status
 * 광고 신청 상태 변경 (관리자용)
 */
router.patch('/ad-requests/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNote } = req.body;

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '유효하지 않은 상태입니다. (pending, approved, rejected 중 선택)'
      });
    }

    const adRequest = await prisma.adRequest.findUnique({
      where: { id }
    });

    if (!adRequest) {
      return res.status(404).json({
        error: 'Not Found',
        message: '광고 신청을 찾을 수 없습니다.'
      });
    }

    const updateData = {
      status,
      updatedAt: new Date()
    };

    // approved 상태로 변경시 승인 정보 추가
    if (status === 'approved') {
      updateData.approvedAt = new Date();
      // TODO: 실제 관리자 인증 구현시 관리자 ID 추가
      // updateData.approvedBy = req.user.id;
    }

    // 관리자 메모가 있으면 추가
    if (adminNote !== undefined) {
      updateData.adminNote = adminNote;
    }

    const updatedAdRequest = await prisma.adRequest.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            nickname: true,
            email: true
          }
        },
        store: {
          select: {
            사업장명: true
          }
        }
      }
    });

    res.json({
      success: true,
      data: updatedAdRequest,
      message: `광고 신청이 ${status === 'approved' ? '승인' : status === 'rejected' ? '거절' : '대기 상태로 변경'}되었습니다.`
    });

  } catch (error) {
    console.error('관리자 광고 신청 상태 변경 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '광고 신청 상태 변경 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PATCH /api/admin/ad-requests/:id/note
 * 광고 신청 관리자 메모 수정 (관리자용)
 */
router.patch('/ad-requests/:id/note', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNote } = req.body;

    const adRequest = await prisma.adRequest.findUnique({
      where: { id }
    });

    if (!adRequest) {
      return res.status(404).json({
        error: 'Not Found',
        message: '광고 신청을 찾을 수 없습니다.'
      });
    }

    const updatedAdRequest = await prisma.adRequest.update({
      where: { id },
      data: {
        adminNote,
        updatedAt: new Date()
      }
    });

    res.json({
      success: true,
      data: updatedAdRequest,
      message: '관리자 메모가 수정되었습니다.'
    });

  } catch (error) {
    console.error('관리자 광고 신청 메모 수정 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '광고 신청 메모 수정 중 오류가 발생했습니다.'
    });
  }
});

/**
 * DELETE /api/admin/ad-requests/:id
 * 광고 신청 삭제 (관리자용)
 */
router.delete('/ad-requests/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const adRequest = await prisma.adRequest.findUnique({
      where: { id }
    });

    if (!adRequest) {
      return res.status(404).json({
        error: 'Not Found',
        message: '광고 신청을 찾을 수 없습니다.'
      });
    }

    await prisma.adRequest.delete({
      where: { id }
    });

    res.json({
      success: true,
      message: '광고 신청이 삭제되었습니다.'
    });

  } catch (error) {
    console.error('관리자 광고 신청 삭제 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '광고 신청 삭제 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/admin/active-ads
 * 현재 활성화된 광고 목록 조회 (사용자용 - 프론트엔드에서 광고 배너 표시용)
 */
router.get('/active-ads', async (req, res) => {
  try {
    const now = new Date();

    // 승인되었고 광고 기간이 현재 날짜에 해당하는 광고들 조회
    const activeAds = await prisma.adRequest.findMany({
      where: {
        status: 'approved',
        startDate: {
          lte: now
        },
        endDate: {
          gte: now
        }
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
            도로명전체주소: true,
            좌표정보x: true,
            좌표정보y: true
          }
        },
        user: {
          select: {
            nickname: true
          }
        }
      },
      orderBy: {
        approvedAt: 'desc'
      }
    });

    // 응답 데이터 포맷팅
    const formattedAds = activeAds.map(ad => {
      // 좌표 변환
      let coordinates = { lat: 37.5665, lng: 126.978 }; // 기본값
      if (ad.store && ad.store.좌표정보x && ad.store.좌표정보y) {
        coordinates = tmToWgs84(ad.store.좌표정보x, ad.store.좌표정보y);
      }

      return {
        id: ad.id,
        store: ad.store ? {
          id: ad.store.id,
          name: ad.store.사업장명,
          address: ad.store.도로명전체주소 || ad.store.소재지전체주소,
          lat: coordinates.lat,
          lng: coordinates.lng
        } : null,
        startDate: ad.startDate,
        endDate: ad.endDate,
        approvedAt: ad.approvedAt
      };
    });

    res.json({
      success: true,
      data: formattedAds
    });

  } catch (error) {
    console.error('활성 광고 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '활성 광고 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;