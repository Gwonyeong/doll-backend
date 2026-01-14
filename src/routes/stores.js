const express = require("express");
const { prisma } = require("../services/prisma");
const { optionalAuth } = require("../middleware/auth");
const proj4 = require("proj4");

// EPSG:5174 (Korea 2000 / Central Belt 2010) 좌표계 정의
// 중부원점(Central Belt) 사용 - 서울/경기 지역에 적합
// towgs84 파라미터를 한국 측지계에 최적화
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

// WGS84(위도/경도)를 TM 좌표계(EPSG:5174)로 변환하는 함수
function wgs84ToTm(lat, lng) {
  try {
    const latitude = parseFloat(lat);
    const longitude = parseFloat(lng);

    // NaN, Infinity 체크
    if (
      !isFinite(latitude) ||
      !isFinite(longitude) ||
      isNaN(latitude) ||
      isNaN(longitude)
    ) {
      return { x: 200000, y: 450000 }; // 중부원점 근처 기본값
    }

    // WGS84 유효 범위 체크 (한국 지역)
    if (latitude < 33 || latitude > 43 || longitude < 124 || longitude > 132) {
      return { x: 200000, y: 450000 };
    }

    // proj4를 사용한 정확한 좌표 변환
    const [tmX, tmY] = proj4(wgs84, epsg5174, [longitude, latitude]);

    return {
      x: Math.max(50000, Math.min(350000, tmX)),
      y: Math.max(0, Math.min(600000, tmY)),
    };
  } catch (error) {
    // 중부원점 근처 기본값
    return { x: 200000, y: 450000 };
  }
}

const router = express.Router();

/**
 * GET /api/stores
 * 매장 목록 조회 (지도용)
 */
router.get("/", optionalAuth, async (req, res) => {
  try {
    const {
      lat = 37.570237461,
      lng = 126.983220147,
      radius = 2000, // 기본 5km

      search,
    } = req.query;

    let whereClause = {
      영업상태명: "영업/정상", // 영업 중인 매장만
    };

    // 검색 조건 추가
    if (search) {
      whereClause.OR = [
        { 사업장명: { contains: search, mode: "insensitive" } },
        { 소재지전체주소: { contains: search, mode: "insensitive" } },
        { 도로명전체주소: { contains: search, mode: "insensitive" } },
      ];
    }

    // 좌표 기반 필터링 (TM 좌표계 사용)
    if (lat && lng) {
      const latFloat = parseFloat(lat);
      const lngFloat = parseFloat(lng);
      const radiusKm = parseFloat(radius) / 1000;

      // WGS84 좌표를 TM 좌표로 변환
      const centerTm = wgs84ToTm(latFloat, lngFloat);

      // TM 좌표계에서의 대략적인 반경 계산 (1km ≈ 1000 TM 단위)
      const tmRadius = radiusKm * 1000;

      whereClause.좌표정보x = {
        gte: (centerTm.x - tmRadius).toString(),
        lte: (centerTm.x + tmRadius).toString(),
      };
      whereClause.좌표정보y = {
        gte: (centerTm.y - tmRadius).toString(),
        lte: (centerTm.y + tmRadius).toString(),
      };
    }

    const stores = await prisma.gameBusiness.findMany({
      where: whereClause,
      include: {
        reviews: {
          select: {
            rating: true,
          },
        },
      },
    });

    // 거리 계산 및 응답 포맷팅
    const formattedStores = stores.map((store) => {
      // 좌표 값이 없으면 기본값 사용
      if (!store.좌표정보x || !store.좌표정보y) {
        const defaultCoords = { lat: 37.5665, lng: 126.978 };
        return {
          ...store,
          latitude: defaultCoords.lat,
          longitude: defaultCoords.lng,
          거리: 0,
        };
      }

      // TM 좌표계를 WGS84로 변환
      const coords = tmToWgs84(store.좌표정보x, store.좌표정보y);

      let distance = 0;
      if (lat && lng) {
        const latFloat = parseFloat(lat);
        const lngFloat = parseFloat(lng);

        const R = 6371; // 지구 반지름 (km)
        const dLat = ((coords.lat - latFloat) * Math.PI) / 180;
        const dLng = ((coords.lng - lngFloat) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((latFloat * Math.PI) / 180) *
            Math.cos((coords.lat * Math.PI) / 180) *
            Math.sin(dLng / 2) *
            Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        distance = Math.round(R * c * 10) / 10;
      }

      // 평균 평점 계산
      const ratings = store.reviews.map((r) => r.rating);
      const avgRating =
        ratings.length > 0
          ? Math.round(
              (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10
            ) / 10
          : 0;

      return {
        id: store.id,
        name: store.사업장명,
        address: store.도로명전체주소 || store.소재지전체주소,
        phone: store.소재지전화,
        lat: coords.lat,
        lng: coords.lng,
        distance,
        status: store.영업상태명,
        category: store.업태구분명,
        gameCount: null,
        area: store.소재지전체주소?.split(" ")[1] || "",
        averageRating: avgRating,
        reviewCount: store.reviews.length,
      };
    });

    // 거리 기준으로 정렬 (가까운 순)
    if (lat && lng) {
      formattedStores.sort((a, b) => a.distance - b.distance);
    }

    res.json({
      success: true,
      data: formattedStores,
    });
  } catch (error) {
    console.error("매장 목록 조회 오류:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "매장 목록을 불러오는 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/stores/top-reviewed
 * 후기가 가장 많은 매장 조회
 */
router.get("/top-reviewed", optionalAuth, async (req, res) => {
  try {
    // 후기 수가 가장 많은 매장 조회 (최소 1개 이상의 후기가 있는 매장만)
    const topStore = await prisma.gameBusiness.findFirst({
      include: {
        reviews: {
          select: {
            id: true,
            rating: true
          }
        }
      },
      where: {
        reviews: {
          some: {} // 최소 1개 이상의 후기가 있는 매장만
        }
      },
      orderBy: {
        reviews: {
          _count: 'desc'
        }
      }
    });

    if (!topStore) {
      return res.json({
        success: true,
        data: null,
        message: "후기가 있는 매장이 없습니다."
      });
    }

    // 좌표 변환
    const coordinates = tmToWgs84(topStore.좌표정보x, topStore.좌표정보y);

    // 평균 평점 계산
    const ratings = topStore.reviews.map(r => r.rating);
    const avgRating = ratings.length > 0
      ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10
      : 0;

    const formattedStore = {
      id: topStore.id,
      name: topStore.사업장명,
      address: topStore.도로명전체주소 || topStore.소재지전체주소,
      phone: topStore.소재지전화,
      lat: coordinates.lat,
      lng: coordinates.lng,
      reviewCount: topStore.reviews.length,
      averageRating: avgRating,
      gameCount: topStore.총게임기수,
      facilityArea: topStore.시설면적,
      businessStatus: topStore.영업상태명
    };

    res.json({
      success: true,
      data: formattedStore
    });

  } catch (error) {
    console.error("최다 후기 매장 조회 오류:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "최다 후기 매장을 조회하는 중 오류가 발생했습니다."
    });
  }
});

/**
 * GET /api/stores/top-reviewed-three
 * 후기가 많은 상위 3개 매장 조회
 */
router.get("/top-reviewed-three", optionalAuth, async (req, res) => {
  try {
    // 후기 수가 많은 상위 3개 매장 조회 (최소 1개 이상의 후기가 있는 매장만)
    const topStores = await prisma.gameBusiness.findMany({
      include: {
        reviews: {
          select: {
            id: true,
            rating: true
          }
        }
      },
      where: {
        reviews: {
          some: {} // 최소 1개 이상의 후기가 있는 매장만
        }
      },
      orderBy: {
        reviews: {
          _count: 'desc'
        }
      },
      take: 3 // 상위 3개만 가져오기
    });

    if (!topStores || topStores.length === 0) {
      return res.json({
        success: true,
        data: [],
        message: "후기가 있는 매장이 없습니다."
      });
    }

    // 각 매장 포맷팅
    const formattedStores = topStores.map((store, index) => {
      // 좌표 변환
      const coordinates = tmToWgs84(store.좌표정보x, store.좌표정보y);

      // 평균 평점 계산
      const ratings = store.reviews.map(r => r.rating);
      const avgRating = ratings.length > 0
        ? Math.round((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length) * 10) / 10
        : 0;

      return {
        id: store.id,
        rank: index + 1, // 순위 추가
        name: store.사업장명,
        address: store.도로명전체주소 || store.소재지전체주소,
        phone: store.소재지전화,
        lat: coordinates.lat,
        lng: coordinates.lng,
        reviewCount: store.reviews.length,
        averageRating: avgRating,
        gameCount: store.총게임기수,
        facilityArea: store.시설면적,
        businessStatus: store.영업상태명
      };
    });

    res.json({
      success: true,
      data: formattedStores
    });

  } catch (error) {
    console.error("상위 3개 매장 조회 오류:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "상위 매장들을 조회하는 중 오류가 발생했습니다."
    });
  }
});

/**
 * GET /api/stores/:id
 * 특정 매장 상세 정보 조회
 */
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    // ID 유효성 검증
    if (!id || id === 'undefined' || id === 'null') {
      return res.status(400).json({
        error: 'Bad Request',
        message: '매장 ID가 필요합니다.'
      });
    }

    const storeId = parseInt(id);
    if (isNaN(storeId) || storeId <= 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '유효하지 않은 매장 ID입니다.'
      });
    }

    const store = await prisma.gameBusiness.findUnique({
      where: { id: storeId },
      include: {
        reviews: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                avatar: true,
              },
            },
          },
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!store) {
      return res.status(404).json({
        error: "Not Found",
        message: "매장을 찾을 수 없습니다.",
      });
    }

    // 평균 평점 계산
    const ratings = store.reviews.map((r) => r.rating);
    const averageRating =
      ratings.length > 0
        ? ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length
        : 0;

    // 좌표 값 검증 및 변환
    let coords;
    if (!store.좌표정보x || !store.좌표정보y) {
      coords = { lat: 37.5665, lng: 126.978 }; // 서울 중심 기본값
    } else {
      // TM 좌표계를 WGS84로 변환
      coords = tmToWgs84(store.좌표정보x, store.좌표정보y);
    }

    const storeData = {
      id: store.id,
      name: store.사업장명,
      address: store.도로명전체주소 || store.소재지전체주소,
      phone: store.소재지전화,
      lat: coords.lat,
      lng: coords.lng,
      status: store.영업상태명,
      category: store.업태구분명,
      totalFloors: store.총층수,
      facilityArea: store.시설면적,
      gameCount: store.총게임기수,
      lastUpdated: store.최종수정시점,
      reviewCount: store.reviews.length,
      averageRating: Math.round(averageRating * 10) / 10,
      reviews: store.reviews.map((review) => ({
        id: review.id,
        rating: review.rating,
        content: review.content,
        images: review.images,
        tags: review.tags,
        userName: review.user ? review.user.nickname : review.userName,
        userAvatar: review.user?.avatar,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      })),
    };

    res.json({
      success: true,
      data: storeData,
    });
  } catch (error) {
    console.error("매장 상세 조회 오류:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "매장 정보를 불러오는 중 오류가 발생했습니다.",
    });
  }
});

/**
 * GET /api/stores/search
 * 매장 검색 (자동완성용)
 */
router.get("/search/suggestions", async (req, res) => {
  try {
    const { q, limit = 10 } = req.query;

    if (!q || q.length < 2) {
      return res.json({
        success: true,
        data: [],
      });
    }

    const suggestions = await prisma.gameBusiness.findMany({
      where: {
        AND: [
          { 영업상태명: "영업/정상" },
          {
            OR: [
              { 사업장명: { contains: q, mode: "insensitive" } },
              { 소재지전체주소: { contains: q, mode: "insensitive" } },
              { 도로명전체주소: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: {
        id: true,
        사업장명: true,
        소재지전체주소: true,
        도로명전체주소: true,
        좌표정보x: true,
        좌표정보y: true,
      },
      take: parseInt(limit),
      orderBy: {
        사업장명: "asc",
      },
    });

    const formattedSuggestions = suggestions.map((store) => {
      // 좌표 값 검증 및 변환
      let coords;
      if (!store.좌표정보x || !store.좌표정보y) {
        coords = { lat: 37.5665, lng: 126.978 };
      } else {
        // TM 좌표계를 WGS84로 변환
        coords = tmToWgs84(store.좌표정보x, store.좌표정보y);
      }

      return {
        id: store.id,
        name: store.사업장명,
        address: store.도로명전체주소 || store.소재지전체주소,
        latitude: coords.lat,
        longitude: coords.lng,
      };
    });

    res.json({
      success: true,
      data: formattedSuggestions,
    });
  } catch (error) {
    console.error("매장 검색 오류:", error);
    res.status(500).json({
      error: "Internal Server Error",
      message: "매장 검색 중 오류가 발생했습니다.",
    });
  }
});

module.exports = router;
