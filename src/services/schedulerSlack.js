const axios = require('axios');
const { PrismaClient } = require('../../src/generated/prisma');

const prisma = new PrismaClient();

/**
 * 스케줄러용 슬랙 알림 서비스
 */

const SCHEDULER_SLACK_WEBHOOK_URL = process.env.SCHEDULER_SLACK_WEBHOOK_URL;

/**
 * 스케줄러용 슬랙 메시지 전송
 * @param {Object} message - 슬랙 메시지 객체
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendSchedulerSlackMessage(message) {
  try {
    if (!SCHEDULER_SLACK_WEBHOOK_URL) {
      console.error('스케줄러 슬랙 웹훅 URL이 설정되지 않았습니다.');
      return false;
    }

    const response = await axios.post(SCHEDULER_SLACK_WEBHOOK_URL, message, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 10000 // 10초 타임아웃
    });

    return response.status === 200;
  } catch (error) {
    console.error('스케줄러 슬랙 메시지 전송 실패:', error.message);
    return false;
  }
}

/**
 * 일일 통계 리포트 생성 및 전송
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendDailyReport() {
  try {
    console.log('일일 리포트 생성 시작...');

    // 오늘 날짜 계산 (오늘 00:00)
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 어제 날짜 계산 (어제 00:00 ~ 23:59:59)
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayEnd = new Date(today);
    yesterdayEnd.setMilliseconds(-1); // 오늘 00:00 - 1ms = 어제 23:59:59.999

    // 통계 데이터 수집
    // 1. 어제 하루 가입한 유저 수
    const yesterdayNewUsers = await prisma.user.count({
      where: {
        createdAt: {
          gte: yesterday,
          lt: today
        }
      }
    });

    // 2. 총 유저 수
    const totalUsers = await prisma.user.count();

    // 3. 어제 하루 남겨진 후기 수
    const yesterdayReviews = await prisma.review.count({
      where: {
        createdAt: {
          gte: yesterday,
          lt: today
        }
      }
    });

    // 4. 총 후기 수
    const totalReviews = await prisma.review.count();

    // 5. 처리되지 않은 광고 신청 (pending 상태)
    const pendingAdRequests = await prisma.adRequest.findMany({
      where: {
        status: 'pending'
      },
      select: {
        id: true,
        startDate: true,
        endDate: true,
        createdAt: true,
        store: {
          select: {
            사업장명: true
          }
        }
      },
      orderBy: {
        createdAt: 'asc' // 오래된 순서대로
      }
    });

    // 6. 어제 하루 저장된 즐겨찾기 수
    const yesterdayFavorites = await prisma.favorite.count({
      where: {
        createdAt: {
          gte: yesterday,
          lt: today
        }
      }
    });

    // 7. 총 즐겨찾기 수
    const totalFavorites = await prisma.favorite.count();

    // 날짜 포맷 함수
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    };

    // 슬랙 메시지 구성
    const message = {
      text: `📊 DollCatcher 일일 리포트 (${formatDate(yesterday)} 집계)`,
      username: "DollCatcher Daily Reporter",
      icon_emoji: ":chart_with_upwards_trend:",
      attachments: [
        {
          color: "#36a64f",
          title: "👥 사용자 통계",
          fields: [
            {
              title: "어제 신규 가입",
              value: `${yesterdayNewUsers}명`,
              short: true
            },
            {
              title: "전체 사용자",
              value: `${totalUsers.toLocaleString()}명`,
              short: true
            }
          ]
        },
        {
          color: "#4a90e2",
          title: "✍️ 리뷰 통계",
          fields: [
            {
              title: "어제 작성된 리뷰",
              value: `${yesterdayReviews}개`,
              short: true
            },
            {
              title: "전체 리뷰",
              value: `${totalReviews.toLocaleString()}개`,
              short: true
            }
          ]
        },
        {
          color: "#ff9800",
          title: "⭐ 즐겨찾기 통계",
          fields: [
            {
              title: "어제 추가된 즐겨찾기",
              value: `${yesterdayFavorites}개`,
              short: true
            },
            {
              title: "전체 즐겨찾기",
              value: `${totalFavorites.toLocaleString()}개`,
              short: true
            }
          ]
        }
      ]
    };

    // 미처리 광고 신청 추가
    if (pendingAdRequests.length > 0) {
      const adRequestsText = pendingAdRequests.slice(0, 5).map((ad, index) => {
        const storeName = ad.store?.사업장명 || '직접 입력';
        return `${index + 1}. ${storeName}\n   기간: ${formatDate(ad.startDate)} ~ ${formatDate(ad.endDate)}`;
      }).join('\n\n');

      const additionalText = pendingAdRequests.length > 5
        ? `\n\n... 외 ${pendingAdRequests.length - 5}건`
        : '';

      message.attachments.push({
        color: "#e91e63",
        title: `🔔 미처리 광고 신청 (${pendingAdRequests.length}건)`,
        text: adRequestsText + additionalText
      });
    } else {
      message.attachments.push({
        color: "good",
        title: "✅ 광고 신청",
        text: "처리 대기 중인 광고 신청이 없습니다."
      });
    }

    // 요약 통계 추가
    const summaryText = [
      `📅 집계 날짜: ${formatDate(yesterday)}`,
      `🆕 어제의 활동: 신규 유저 ${yesterdayNewUsers}명, 리뷰 ${yesterdayReviews}개, 즐겨찾기 ${yesterdayFavorites}개`,
      pendingAdRequests.length > 0 ? `⚠️ 처리 필요: 광고 신청 ${pendingAdRequests.length}건` : ''
    ].filter(Boolean).join('\n');

    message.attachments.push({
      color: "#666666",
      title: "📝 요약",
      text: summaryText,
      footer: "DollCatcher Backend Scheduler",
      footer_icon: "https://platform.slack-edge.com/img/default_application_icon.png",
      ts: Math.floor(Date.now() / 1000)
    });

    // 슬랙으로 전송
    const result = await sendSchedulerSlackMessage(message);

    if (result) {
      console.log('일일 리포트가 슬랙으로 전송되었습니다.');
    } else {
      console.error('일일 리포트 슬랙 전송 실패');
    }

    return result;
  } catch (error) {
    console.error('일일 리포트 생성 중 오류:', error);

    // 에러 발생 시 에러 메시지도 슬랙으로 전송
    await sendSchedulerSlackMessage({
      text: `⚠️ DollCatcher 일일 리포트 생성 실패`,
      username: "DollCatcher Daily Reporter",
      icon_emoji: ":warning:",
      attachments: [
        {
          color: "danger",
          title: "오류 정보",
          text: `${error.message}`,
          footer: "DollCatcher Backend Scheduler",
          ts: Math.floor(Date.now() / 1000)
        }
      ]
    });

    return false;
  }
}

module.exports = {
  sendSchedulerSlackMessage,
  sendDailyReport
};