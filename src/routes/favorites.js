const express = require("express");
const router = express.Router();
const { PrismaClient } = require("../generated/prisma");
const { authenticateToken } = require("../middleware/auth");
const proj4 = require("proj4");

const prisma = new PrismaClient();

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

// 모든 즐겨찾기 라우트에 인증 미들웨어 적용
router.use(authenticateToken);

/**
 * @route   GET /api/favorites
 * @desc    사용자의 즐겨찾기 목록 조회
 * @access  Private (인증 필요)
 */
router.get("/", async (req, res) => {
  try {
    const userId = req.user?.id; // 토스 인증에서 제공하는 사용자 ID

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    // 즐겨찾기 목록 조회 (매장 정보 포함)
    const favorites = await prisma.favorite.findMany({
      where: {
        userId: userId,
      },
      include: {
        store: {
          select: {
            id: true,
            사업장명: true,
            소재지전체주소: true,
            도로명전체주소: true,
            좌표정보x: true,
            좌표정보y: true,
            영업상태명: true,
            총게임기수: true,
            시설면적: true,
            소재지전화: true,
            // 리뷰 통계 정보도 포함
            reviews: {
              select: {
                rating: true,
              },
            },
          },
        },
      },
      orderBy: {
        createdAt: "desc", // 최근 추가한 순으로 정렬
      },
    });

    // 매장 정보 가공
    const processedFavorites = favorites.map((favorite) => {
      const store = favorite.store;
      const reviews = store.reviews || [];

      // 평점 계산
      const averageRating =
        reviews.length > 0
          ? (
              reviews.reduce((sum, review) => sum + review.rating, 0) /
              reviews.length
            ).toFixed(1)
          : null;

      // 좌표 변환 (TM → WGS84)
      const coords = tmToWgs84(store.좌표정보x, store.좌표정보y);

      return {
        id: favorite.id,
        createdAt: favorite.createdAt,
        store: {
          id: store.id,
          name: store.사업장명,
          address: store.소재지전체주소 || store.도로명전체주소,
          lat: coords.lat,
          lng: coords.lng,
          status: store.영업상태명,
          gameCount: store.총게임기수,
          facilityArea: store.시설면적,
          phone: store.소재지전화,
          averageRating: averageRating,
          reviewCount: reviews.length,
        },
      };
    });

    res.json({
      success: true,
      data: processedFavorites,
    });
  } catch (error) {
    console.error("즐겨찾기 목록 조회 오류:", error);
    res.status(500).json({
      success: false,
      error: "즐겨찾기 목록을 불러오는 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   POST /api/favorites/:storeId
 * @desc    즐겨찾기 추가
 * @access  Private (인증 필요)
 */
router.post("/:storeId", async (req, res) => {
  try {
    const userId = req.user?.id;
    const storeId = parseInt(req.params.storeId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    if (!storeId || isNaN(storeId)) {
      return res.status(400).json({
        success: false,
        error: "유효하지 않은 매장 ID입니다.",
      });
    }

    // 매장 존재 확인
    const store = await prisma.gameBusiness.findUnique({
      where: { id: storeId },
    });

    if (!store) {
      return res.status(404).json({
        success: false,
        error: "매장을 찾을 수 없습니다.",
      });
    }

    // 이미 즐겨찾기에 추가되어 있는지 확인
    const existingFavorite = await prisma.favorite.findUnique({
      where: {
        unique_user_store_favorite: {
          userId: userId,
          storeId: storeId,
        },
      },
    });

    if (existingFavorite) {
      return res.status(409).json({
        success: false,
        error: "이미 즐겨찾기에 추가된 매장입니다.",
      });
    }

    // 즐겨찾기 추가
    const favorite = await prisma.favorite.create({
      data: {
        userId: userId,
        storeId: storeId,
      },
      include: {
        store: {
          select: {
            사업장명: true,
            소재지전체주소: true,
          },
        },
      },
    });

    res.status(201).json({
      success: true,
      data: {
        id: favorite.id,
        message: `${favorite.store.사업장명}이(가) 즐겨찾기에 추가되었습니다.`,
      },
    });
  } catch (error) {
    console.error("즐겨찾기 추가 오류:", error);
    res.status(500).json({
      success: false,
      error: "즐겨찾기 추가 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   DELETE /api/favorites/:storeId
 * @desc    즐겨찾기 삭제
 * @access  Private (인증 필요)
 */
router.delete("/:storeId", async (req, res) => {
  try {
    const userId = req.user?.id;
    const storeId = parseInt(req.params.storeId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    if (!storeId || isNaN(storeId)) {
      return res.status(400).json({
        success: false,
        error: "유효하지 않은 매장 ID입니다.",
      });
    }

    // 즐겨찾기 존재 확인 및 삭제
    const favorite = await prisma.favorite.findUnique({
      where: {
        unique_user_store_favorite: {
          userId: userId,
          storeId: storeId,
        },
      },
      include: {
        store: {
          select: {
            사업장명: true,
          },
        },
      },
    });

    if (!favorite) {
      return res.status(404).json({
        success: false,
        error: "즐겨찾기에서 찾을 수 없습니다.",
      });
    }

    await prisma.favorite.delete({
      where: {
        id: favorite.id,
      },
    });

    res.json({
      success: true,
      data: {
        message: `${favorite.store.사업장명}이(가) 즐겨찾기에서 삭제되었습니다.`,
      },
    });
  } catch (error) {
    console.error("즐겨찾기 삭제 오류:", error);
    res.status(500).json({
      success: false,
      error: "즐겨찾기 삭제 중 오류가 발생했습니다.",
    });
  }
});

/**
 * @route   GET /api/favorites/check/:storeId
 * @desc    특정 매장의 즐겨찾기 상태 확인
 * @access  Private (인증 필요)
 */
router.get("/check/:storeId", async (req, res) => {
  try {
    const userId = req.user?.id;
    const storeId = parseInt(req.params.storeId);

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "로그인이 필요합니다.",
      });
    }

    if (!storeId || isNaN(storeId)) {
      return res.status(400).json({
        success: false,
        error: "유효하지 않은 매장 ID입니다.",
      });
    }

    const favorite = await prisma.favorite.findUnique({
      where: {
        unique_user_store_favorite: {
          userId: userId,
          storeId: storeId,
        },
      },
    });

    res.json({
      success: true,
      data: {
        isFavorite: !!favorite,
        favoriteId: favorite?.id || null,
      },
    });
  } catch (error) {
    console.error("즐겨찾기 상태 확인 오류:", error);
    res.status(500).json({
      success: false,
      error: "즐겨찾기 상태 확인 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
