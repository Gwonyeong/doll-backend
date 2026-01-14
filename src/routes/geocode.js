const express = require("express");
const router = express.Router();
const axios = require("axios");

/**
 * @route   GET /api/geocode/reverse
 * @desc    좌표를 주소로 변환 (역지오코딩)
 * @access  Public
 */
router.get("/reverse", async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({
        success: false,
        error: "위도와 경도가 필요합니다.",
      });
    }

    // 네이버 지도 API 키 확인
    const clientId = process.env.NAVER_MAP_CLIENT_ID;
    const clientSecret = process.env.NAVER_MAP_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      // API 키가 없는 경우 대체 방법 사용 (임시 주소 반환)
      const tempAddress = `위도 ${parseFloat(lat).toFixed(
        4
      )}, 경도 ${parseFloat(lng).toFixed(4)} 주변`;
      return res.json({
        success: true,
        address: tempAddress,
        isTemp: true,
      });
    }

    // 네이버 Reverse Geocoding API 호출
    const naverApiUrl =
      "https://maps.apigw.ntruss.com/map-reversegeocode/v2/gc";

    const response = await axios.get(naverApiUrl, {
      params: {
        coords: `${lng},${lat}`, // 경도,위도 순서 주의
        orders: "addr,roadaddr",
        output: "json",
      },
      headers: {
        "X-NCP-APIGW-API-KEY-ID": clientId,
        "X-NCP-APIGW-API-KEY": clientSecret,
      },
    });


    // 응답 파싱
    if (response.data.status.code === 0 && response.data.results?.length > 0) {
      // addr(지번주소)와 roadaddr(도로명주소) 찾기
      const addrResult = response.data.results.find(r => r.name === "addr");
      const roadResult = response.data.results.find(r => r.name === "roadaddr");

      let jibunAddress = "";
      let roadAddress = "";
      let finalAddress = "";

      // 지번 주소 조합
      if (addrResult) {
        const region = addrResult.region;
        const land = addrResult.land;

        jibunAddress = [
          region.area1?.name,
          region.area2?.name,
          region.area3?.name,
          region.area4?.name,
          land?.number1 && `${land.number1}${land.number2 ? `-${land.number2}` : ""}`
        ]
          .filter(Boolean)
          .join(" ");
      }

      // 도로명 주소 조합
      if (roadResult) {
        const region = roadResult.region;
        const land = roadResult.land;

        roadAddress = [
          region.area1?.name,
          region.area2?.name,
          region.area3?.name,
          land?.name,
          land?.number1,
          land?.number2
        ]
          .filter(Boolean)
          .join(" ");
      }

      // 우선순위: 도로명 주소 > 지번 주소
      finalAddress = roadAddress || jibunAddress || "주소를 찾을 수 없습니다";

      return res.json({
        success: true,
        address: finalAddress,
        detail: {
          jibun: jibunAddress || null,
          road: roadAddress || null,
          region: addrResult?.region || roadResult?.region || null,
          land: {
            jibun: addrResult?.land || null,
            road: roadResult?.land || null
          }
        },
      });
    } else {
      // 주소를 찾을 수 없는 경우
      return res.json({
        success: true,
        address: `위도 ${parseFloat(lat).toFixed(4)}, 경도 ${parseFloat(
          lng
        ).toFixed(4)}`,
        isTemp: true,
        message: "정확한 주소를 찾을 수 없습니다",
      });
    }
  } catch (error) {

    // 에러 발생 시에도 좌표는 표시
    const { lat, lng } = req.query;
    res.json({
      success: true,
      address: `위도 ${parseFloat(lat).toFixed(4)}, 경도 ${parseFloat(
        lng
      ).toFixed(4)}`,
      isTemp: true,
      error: "주소를 가져올 수 없습니다",
    });
  }
});

module.exports = router;
