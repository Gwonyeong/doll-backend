const express = require('express');
const { prisma } = require('../services/prisma');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

/**
 * GET /api/reviews/store/:storeId
 * 특정 매장의 리뷰 목록 조회
 * - 로그인하지 않은 사용자: 최신 1개만 표시, 나머지는 블라인드
 * - 로그인한 사용자 (해금 전): 최신 1개만 표시, 나머지는 블라인드
 * - 로그인한 사용자 (해금 후): 모든 리뷰 표시
 */
router.get('/store/:storeId', optionalAuth, async (req, res) => {
  try {
    const { storeId } = req.params;
    const { limit = 20, offset = 0, sortBy = 'latest' } = req.query;

    // 정렬 조건 설정
    let orderBy = { createdAt: 'desc' }; // 기본: 최신순
    if (sortBy === 'rating_high') {
      orderBy = { rating: 'desc' };
    } else if (sortBy === 'rating_low') {
      orderBy = { rating: 'asc' };
    }

    // 해금 여부 확인
    let isUnlocked = false;
    if (req.user) {
      const unlockRecord = await prisma.userUnlockedStoreReview.findUnique({
        where: {
          unique_user_store_review_unlock: {
            userId: req.user.id,
            storeId: parseInt(storeId)
          }
        }
      });
      isUnlocked = !!unlockRecord;
    }

    const reviews = await prisma.review.findMany({
      where: {
        storeId: parseInt(storeId)
      },
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true
          }
        }
      },
      orderBy,
      skip: parseInt(offset),
      take: parseInt(limit)
    });

    const totalCount = await prisma.review.count({
      where: {
        storeId: parseInt(storeId)
      }
    });

    // 리뷰 포맷팅 (해금 여부에 따라 블라인드 처리)
    const formattedReviews = reviews.map((review, index) => {
      const baseReview = {
        id: review.id,
        rating: review.rating,
        content: review.content,
        images: review.images,
        tags: review.tags,
        dollCount: review.dollCount,
        spentAmount: review.spentAmount,
        dollImages: review.dollImages,
        userName: review.user ? review.user.nickname : review.userName,
        userAvatar: review.user?.avatar,
        isOwner: req.user && review.userId === req.user.id,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        isBlinded: false
      };

      // 해금되지 않은 경우: 첫 번째 리뷰만 표시, 나머지는 블라인드
      if (!isUnlocked && index > 0) {
        return {
          ...baseReview,
          content: '광고를 시청하면 후기를 볼 수 있어요',
          images: [],
          tags: [],
          dollImages: [],
          isBlinded: true
        };
      }

      return baseReview;
    });

    res.json({
      success: true,
      data: formattedReviews,
      isUnlocked, // 해금 여부 전달
      pagination: {
        total: totalCount,
        limit: parseInt(limit),
        offset: parseInt(offset),
        hasMore: parseInt(offset) + parseInt(limit) < totalCount
      }
    });

  } catch (error) {
    console.error('리뷰 목록 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 목록을 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/reviews
 * 새 리뷰 작성
 */
router.post('/', optionalAuth, async (req, res) => {
  try {
    const { storeId, rating, content, images = [], tags = [], userName } = req.body;

    // 필수 필드 검증
    if (!storeId || !rating || !content) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '매장 ID, 평점, 내용은 필수입니다.'
      });
    }

    // 평점 범위 검증
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '평점은 1~5 사이의 값이어야 합니다.'
      });
    }

    // 매장 존재 여부 확인
    const store = await prisma.gameBusiness.findUnique({
      where: { id: parseInt(storeId) }
    });

    if (!store) {
      return res.status(404).json({
        error: 'Not Found',
        message: '매장을 찾을 수 없습니다.'
      });
    }

    // 리뷰 데이터 준비
    const reviewData = {
      storeId: parseInt(storeId),
      rating: parseInt(rating),
      content,
      images: Array.isArray(images) ? images : [],
      tags: Array.isArray(tags) ? tags : []
    };

    // 로그인한 사용자인 경우
    if (req.user) {
      reviewData.userId = req.user.id;
    } else {
      // 익명 사용자인 경우
      reviewData.userName = userName || '익명';
    }

    const newReview = await prisma.review.create({
      data: reviewData,
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true
          }
        }
      }
    });

    const formattedReview = {
      id: newReview.id,
      rating: newReview.rating,
      content: newReview.content,
      images: newReview.images,
      tags: newReview.tags,
      userName: newReview.user ? newReview.user.nickname : newReview.userName,
      userAvatar: newReview.user?.avatar,
      isOwner: true,
      createdAt: newReview.createdAt,
      updatedAt: newReview.updatedAt
    };

    res.status(201).json({
      success: true,
      message: '리뷰가 작성되었습니다.',
      data: formattedReview
    });

  } catch (error) {
    console.error('리뷰 작성 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 작성 중 오류가 발생했습니다.'
    });
  }
});

/**
 * PUT /api/reviews/:id
 * 리뷰 수정
 */
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { rating, content, images, tags } = req.body;

    const review = await prisma.review.findUnique({
      where: { id }
    });

    if (!review) {
      return res.status(404).json({
        error: 'Not Found',
        message: '리뷰를 찾을 수 없습니다.'
      });
    }

    // 권한 확인
    if (review.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: '자신이 작성한 리뷰만 수정할 수 있습니다.'
      });
    }

    // 수정할 데이터 준비
    const updateData = {};
    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({
          error: 'Bad Request',
          message: '평점은 1~5 사이의 값이어야 합니다.'
        });
      }
      updateData.rating = parseInt(rating);
    }
    if (content !== undefined) updateData.content = content;
    if (images !== undefined) updateData.images = Array.isArray(images) ? images : [];
    if (tags !== undefined) updateData.tags = Array.isArray(tags) ? tags : [];

    const updatedReview = await prisma.review.update({
      where: { id },
      data: updateData,
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true
          }
        }
      }
    });

    const formattedReview = {
      id: updatedReview.id,
      rating: updatedReview.rating,
      content: updatedReview.content,
      images: updatedReview.images,
      tags: updatedReview.tags,
      userName: updatedReview.user ? updatedReview.user.nickname : updatedReview.userName,
      userAvatar: updatedReview.user?.avatar,
      isOwner: true,
      createdAt: updatedReview.createdAt,
      updatedAt: updatedReview.updatedAt
    };

    res.json({
      success: true,
      message: '리뷰가 수정되었습니다.',
      data: formattedReview
    });

  } catch (error) {
    console.error('리뷰 수정 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 수정 중 오류가 발생했습니다.'
    });
  }
});

/**
 * DELETE /api/reviews/:id
 * 리뷰 삭제
 */
router.delete('/:id', authenticateToken, async (req, res) => {
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

    // 권한 확인
    if (review.userId !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: '자신이 작성한 리뷰만 삭제할 수 있습니다.'
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
    console.error('리뷰 삭제 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 삭제 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/reviews/v2
 * 새 리뷰 작성 (v2 - 인형 자랑하기 포함)
 */
router.post('/v2', optionalAuth, async (req, res) => {
  try {
    const {
      storeId,
      rating,
      content,
      images = [],
      tags = [],
      dollCount = 0,
      spentAmount = 0,
      dollImages = [],
      userName
    } = req.body;

    // 필수 필드 검증
    if (!storeId || !rating || !content) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '매장 ID, 평점, 내용은 필수입니다.'
      });
    }

    // 평점 범위 검증
    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '평점은 1~5 사이의 값이어야 합니다.'
      });
    }

    // 인형 수 검증 (음수 방지)
    if (dollCount < 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '인형 수는 0개 이상이어야 합니다.'
      });
    }

    // 인형 이미지 수 검증 (최대 4개)
    if (dollImages.length > 4) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '인형 사진은 최대 4개까지 업로드할 수 있습니다.'
      });
    }

    // 사용 금액 검증
    if (spentAmount < 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '사용 금액은 0원 이상이어야 합니다.'
      });
    }

    // 매장 존재 여부 확인
    const store = await prisma.gameBusiness.findUnique({
      where: { id: parseInt(storeId) }
    });

    if (!store) {
      return res.status(404).json({
        error: 'Not Found',
        message: '매장을 찾을 수 없습니다.'
      });
    }

    // 리뷰 데이터 준비
    const reviewData = {
      storeId: parseInt(storeId),
      rating: parseInt(rating),
      content,
      images: Array.isArray(images) ? images : [],
      tags: Array.isArray(tags) ? tags : [],
      dollCount: parseInt(dollCount),
      spentAmount: parseInt(spentAmount),
      dollImages: Array.isArray(dollImages) ? dollImages : []
    };

    // 로그인한 사용자인 경우
    if (req.user) {
      reviewData.userId = req.user.id;
    } else {
      // 익명 사용자인 경우
      reviewData.userName = userName || '익명';
    }

    const newReview = await prisma.review.create({
      data: reviewData,
      include: {
        user: {
          select: {
            id: true,
            nickname: true,
            avatar: true
          }
        }
      }
    });

    const formattedReview = {
      id: newReview.id,
      rating: newReview.rating,
      content: newReview.content,
      images: newReview.images,
      tags: newReview.tags,
      dollCount: newReview.dollCount,
      spentAmount: newReview.spentAmount,
      dollImages: newReview.dollImages,
      userName: newReview.user ? newReview.user.nickname : newReview.userName,
      userAvatar: newReview.user?.avatar,
      isOwner: true,
      createdAt: newReview.createdAt,
      updatedAt: newReview.updatedAt
    };

    res.status(201).json({
      success: true,
      message: '리뷰가 작성되었습니다.',
      data: formattedReview
    });

  } catch (error) {
    console.error('리뷰 v2 작성 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 작성 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/reviews/top-catchers
 * 인형을 가장 많이 뽑은 상위 3명의 유저 조회
 * 각 유저별 총 뽑은 인형 개수와 총 사용 금액을 집계
 * 3명 미만일 경우 랜덤 유저로 채움
 */
router.get('/top-catchers', async (req, res) => {
  try {
    // 유저별 dollCount 합계로 그룹핑하여 상위 유저 조회 (인형을 뽑은 유저)
    // Prisma groupBy로 집계 후 유저 정보 조회
    const topCatcherAggregates = await prisma.review.groupBy({
      by: ['userId'],
      where: {
        userId: { not: null },
        dollCount: { gt: 0 },
        user: { phone: { not: null } }
      },
      _sum: {
        dollCount: true,
        spentAmount: true
      },
      orderBy: {
        _sum: { dollCount: 'desc' }
      },
      take: 3
    });

    // 유저 정보 조회
    const topUserIds = topCatcherAggregates.map(a => a.userId).filter(Boolean);
    const topUsers = await prisma.user.findMany({
      where: { id: { in: topUserIds } },
      select: { id: true, phone: true, nickname: true }
    });

    // 집계 결과와 유저 정보 결합
    const topCatchers = topCatcherAggregates.map(agg => {
      const user = topUsers.find(u => u.id === agg.userId);
      return {
        userId: agg.userId,
        phone: user?.phone || null,
        nickname: user?.nickname || null,
        totalDollCount: agg._sum.dollCount || 0,
        totalSpentAmount: agg._sum.spentAmount || 0
      };
    });

    // 3명 미만일 경우 랜덤 유저로 채우기
    let allCatchers = [...topCatchers];

    if (allCatchers.length < 3) {
      const needed = 3 - allCatchers.length;
      const existingUserIds = allCatchers.map(c => c.userId).filter(Boolean);

      // 리뷰를 작성한 유저 중 아직 선택되지 않은 유저를 랜덤으로 가져오기
      const additionalAggregates = await prisma.review.groupBy({
        by: ['userId'],
        where: {
          userId: { not: null, notIn: existingUserIds.length > 0 ? existingUserIds : undefined },
          user: { phone: { not: null } }
        },
        _sum: {
          dollCount: true,
          spentAmount: true
        }
      });

      // 유저 정보 조회
      const additionalUserIds = additionalAggregates.map(a => a.userId).filter(Boolean);
      const additionalUsersData = await prisma.user.findMany({
        where: { id: { in: additionalUserIds } },
        select: { id: true, phone: true, nickname: true }
      });

      // 집계 결과와 유저 정보 결합
      let additionalUsers = additionalAggregates.map(agg => {
        const user = additionalUsersData.find(u => u.id === agg.userId);
        return {
          userId: agg.userId,
          phone: user?.phone || null,
          nickname: user?.nickname || null,
          totalDollCount: agg._sum.dollCount || 0,
          totalSpentAmount: agg._sum.spentAmount || 0
        };
      });

      // 랜덤 셔플 후 필요한 수만큼 가져오기
      additionalUsers = additionalUsers
        .sort(() => Math.random() - 0.5)
        .slice(0, needed);

      allCatchers = [...allCatchers, ...additionalUsers];
    }

    // 전화번호 마스킹 처리 (뒷자리 4자리 중 앞 2자리만 표시, 뒤 2자리는 **)
    const formattedCatchers = allCatchers.map((catcher, index) => {
      let maskedPhone = '****';
      if (catcher.phone) {
        // 전화번호에서 마지막 4자리 추출
        const phoneDigits = catcher.phone.replace(/[^0-9]/g, '');
        if (phoneDigits.length >= 4) {
          const lastFour = phoneDigits.slice(-4);
          maskedPhone = lastFour.slice(0, 2) + '**';
        }
      }

      return {
        rank: index + 1,
        maskedPhone,
        nickname: catcher.nickname || '익명',
        totalDollCount: Number(catcher.totalDollCount || 0),
        totalSpentAmount: Number(catcher.totalSpentAmount || 0)
      };
    });

    res.json({
      success: true,
      data: formattedCatchers
    });

  } catch (error) {
    console.error('상위 유저 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '상위 유저 정보를 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/reviews/stats/:storeId
 * 매장 리뷰 통계 조회
 */
router.get('/stats/:storeId', async (req, res) => {
  try {
    const { storeId } = req.params;

    const stats = await prisma.review.groupBy({
      by: ['rating'],
      where: {
        storeId: parseInt(storeId)
      },
      _count: {
        rating: true
      }
    });

    const totalReviews = await prisma.review.count({
      where: {
        storeId: parseInt(storeId)
      }
    });

    const averageRating = await prisma.review.aggregate({
      where: {
        storeId: parseInt(storeId)
      },
      _avg: {
        rating: true
      }
    });

    // 평점별 분포 생성
    const ratingDistribution = {
      1: 0, 2: 0, 3: 0, 4: 0, 5: 0
    };

    stats.forEach(stat => {
      ratingDistribution[stat.rating] = stat._count.rating;
    });

    res.json({
      success: true,
      data: {
        totalReviews,
        averageRating: averageRating._avg.rating ? Math.round(averageRating._avg.rating * 10) / 10 : 0,
        ratingDistribution
      }
    });

  } catch (error) {
    console.error('리뷰 통계 조회 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 통계를 불러오는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * GET /api/reviews/unlock-status/:storeId
 * 매장 리뷰 해금 상태 확인
 */
router.get('/unlock-status/:storeId', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    const userId = req.user.id;

    const unlockRecord = await prisma.userUnlockedStoreReview.findUnique({
      where: {
        unique_user_store_review_unlock: {
          userId,
          storeId: parseInt(storeId)
        }
      }
    });

    res.json({
      success: true,
      data: {
        isUnlocked: !!unlockRecord,
        unlockedAt: unlockRecord?.unlockedAt || null
      }
    });

  } catch (error) {
    console.error('리뷰 해금 상태 확인 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 해금 상태를 확인하는 중 오류가 발생했습니다.'
    });
  }
});

/**
 * POST /api/reviews/unlock/:storeId
 * 매장 리뷰 해금 (광고 시청 보상)
 */
router.post('/unlock/:storeId', authenticateToken, async (req, res) => {
  try {
    const { storeId } = req.params;
    const userId = req.user.id;

    // 매장 존재 여부 확인
    const store = await prisma.gameBusiness.findUnique({
      where: { id: parseInt(storeId) }
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        message: '매장을 찾을 수 없습니다.'
      });
    }

    // 이미 해금되었는지 확인
    const existingUnlock = await prisma.userUnlockedStoreReview.findUnique({
      where: {
        unique_user_store_review_unlock: {
          userId,
          storeId: parseInt(storeId)
        }
      }
    });

    if (existingUnlock) {
      return res.json({
        success: true,
        message: '이미 해금된 매장입니다.',
        data: {
          isUnlocked: true,
          unlockedAt: existingUnlock.unlockedAt
        }
      });
    }

    // 새로운 해금 레코드 생성
    const unlock = await prisma.userUnlockedStoreReview.create({
      data: {
        userId,
        storeId: parseInt(storeId)
      }
    });

    res.json({
      success: true,
      message: '매장 리뷰가 해금되었습니다.',
      data: {
        isUnlocked: true,
        unlockedAt: unlock.unlockedAt
      }
    });

  } catch (error) {
    console.error('리뷰 해금 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '리뷰 해금 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;