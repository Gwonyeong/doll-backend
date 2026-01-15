const axios = require('axios');

/**
 * 실시간 이벤트 슬랙 알림 서비스
 */

const EVENT_SLACK_WEBHOOK_URL = process.env.EVENT_SLACK_WEBHOOK_URL;

/**
 * 이벤트용 슬랙 메시지 전송
 * @param {Object} message - 슬랙 메시지 객체
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendEventSlackMessage(message) {
  try {
    if (!EVENT_SLACK_WEBHOOK_URL) {
      console.error('이벤트 슬랙 웹훅 URL이 설정되지 않았습니다.');
      return false;
    }

    const response = await axios.post(EVENT_SLACK_WEBHOOK_URL, message, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000 // 5초 타임아웃
    });

    return response.status === 200;
  } catch (error) {
    console.error('이벤트 슬랙 메시지 전송 실패:', error.message);
    return false;
  }
}

/**
 * 새로운 광고 신청 알림
 * @param {Object} adRequestData - 광고 신청 데이터
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function notifyNewAdRequest(adRequestData) {
  try {
    const {
      id,
      userId,
      store,
      startDate,
      endDate,
      ownerName,
      ownerPhone,
      businessLicenseUrl,
      idCardUrl,
      createdAt
    } = adRequestData;

    // 날짜 포맷 함수
    const formatDate = (date) => {
      return new Date(date).toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
    };

    // 시간 포맷 함수
    const formatDateTime = (date) => {
      return new Date(date).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    };

    // 광고 기간 계산 (일수)
    const startDateObj = new Date(startDate);
    const endDateObj = new Date(endDate);
    const diffTime = Math.abs(endDateObj - startDateObj);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // +1 for inclusive

    // 슬랙 메시지 구성
    const message = {
      text: `🎯 새로운 광고 신청이 접수되었습니다!`,
      username: "DollCatcher Event Bot",
      icon_emoji: ":loudspeaker:",
      attachments: [
        {
          color: "#FF2D55", // 토스 빨간색
          title: "광고 신청 정보",
          fields: [
            {
              title: "신청 ID",
              value: id || 'N/A',
              short: true
            },
            {
              title: "신청자 ID",
              value: userId || 'N/A',
              short: true
            },
            {
              title: "매장명",
              value: store?.사업장명 || '직접 입력',
              short: false
            },
            {
              title: "광고 기간",
              value: `${formatDate(startDate)} ~ ${formatDate(endDate)} (${diffDays}일간)`,
              short: false
            }
          ]
        },
        {
          color: "#4a90e2",
          title: "사장님 정보",
          fields: [
            {
              title: "성함",
              value: ownerName || 'N/A',
              short: true
            },
            {
              title: "연락처",
              value: ownerPhone || 'N/A',
              short: true
            }
          ]
        },
        {
          color: "#36a64f",
          title: "첨부 서류",
          fields: [
            {
              title: "사업자등록증",
              value: businessLicenseUrl ? '✅ 첨부됨' : '❌ 미첨부',
              short: true
            },
            {
              title: "신분증",
              value: idCardUrl ? '✅ 첨부됨' : '❌ 미첨부',
              short: true
            }
          ]
        },
        {
          color: "#ff9800",
          title: "처리 필요",
          text: `⚡ 관리자 페이지에서 광고 신청을 검토하고 승인/거절 처리해주세요.\n\n✅ 이 메시지를 확인했으면 ✅ 이모지를 남겨주세요!`,
          footer: `신청 시간: ${formatDateTime(createdAt)}`,
          ts: Math.floor(new Date(createdAt).getTime() / 1000)
        }
      ]
    };

    // 매장 주소가 있으면 추가
    if (store?.소재지전체주소) {
      message.attachments[0].fields.push({
        title: "매장 주소",
        value: store.소재지전체주소,
        short: false
      });
    }

    // 슬랙으로 전송
    const result = await sendEventSlackMessage(message);

    if (result) {
      console.log('광고 신청 알림이 슬랙으로 전송되었습니다.');
    } else {
      console.error('광고 신청 알림 전송 실패');
    }

    return result;
  } catch (error) {
    console.error('광고 신청 알림 생성 중 오류:', error);
    return false;
  }
}

/**
 * 새로운 리뷰 알림
 * @param {Object} reviewData - 리뷰 데이터
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function notifyNewReview(reviewData) {
  try {
    const {
      id,
      rating,
      content,
      user,
      store,
      createdAt
    } = reviewData;

    // 별점 이모지 생성
    const getStarEmoji = (rating) => {
      return '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
    };

    // 시간 포맷 함수
    const formatDateTime = (date) => {
      return new Date(date).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // 슬랙 메시지 구성
    const message = {
      text: `✍️ 새로운 리뷰가 작성되었습니다!`,
      username: "DollCatcher Event Bot",
      icon_emoji: ":pencil2:",
      attachments: [
        {
          color: "#4a90e2",
          title: `${store?.사업장명 || '알 수 없는 매장'} - 새 리뷰`,
          fields: [
            {
              title: "평점",
              value: `${getStarEmoji(rating)} (${rating}/5)`,
              short: true
            },
            {
              title: "작성자",
              value: user?.name || '익명',
              short: true
            }
          ]
        }
      ]
    };

    // 리뷰 내용이 있으면 추가
    if (content) {
      message.attachments[0].fields.push({
        title: "리뷰 내용",
        value: content.length > 200 ? content.substring(0, 200) + '...' : content,
        short: false
      });
    }

    // 푸터 추가
    message.attachments.push({
      color: "#666666",
      footer: `작성 시간: ${formatDateTime(createdAt)}`,
      text: `✅ 이 메시지를 확인했으면 ✅ 이모지를 남겨주세요!`,
      ts: Math.floor(new Date(createdAt).getTime() / 1000)
    });

    // 슬랙으로 전송
    const result = await sendEventSlackMessage(message);

    if (result) {
      console.log('새 리뷰 알림이 슬랙으로 전송되었습니다.');
    } else {
      console.error('새 리뷰 알림 전송 실패');
    }

    return result;
  } catch (error) {
    console.error('새 리뷰 알림 생성 중 오류:', error);
    return false;
  }
}

/**
 * 새로운 매장 제보 알림
 * @param {Object} reportData - 제보 데이터
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function notifyNewStoreReport(reportData) {
  try {
    const {
      id,
      storeName,
      address,
      reporterName,
      reporterPhone,
      additionalInfo,
      createdAt
    } = reportData;

    // 시간 포맷 함수
    const formatDateTime = (date) => {
      return new Date(date).toLocaleString('ko-KR', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
    };

    // 슬랙 메시지 구성
    const message = {
      text: `🏪 새로운 매장이 제보되었습니다!`,
      username: "DollCatcher Event Bot",
      icon_emoji: ":convenience_store:",
      attachments: [
        {
          color: "#9c27b0",
          title: "제보된 매장 정보",
          fields: [
            {
              title: "매장명",
              value: storeName || 'N/A',
              short: true
            },
            {
              title: "제보자",
              value: reporterName || '익명',
              short: true
            },
            {
              title: "주소",
              value: address || 'N/A',
              short: false
            }
          ]
        }
      ]
    };

    // 추가 정보가 있으면 추가
    if (additionalInfo) {
      message.attachments[0].fields.push({
        title: "추가 정보",
        value: additionalInfo,
        short: false
      });
    }

    // 연락처가 있으면 추가
    if (reporterPhone) {
      message.attachments[0].fields.push({
        title: "제보자 연락처",
        value: reporterPhone,
        short: true
      });
    }

    // 처리 안내 추가
    message.attachments.push({
      color: "#ff9800",
      text: "⚡ 제보된 매장 정보를 검토하고 승인/거절 처리해주세요.\n\n✅ 이 메시지를 확인했으면 ✅ 이모지를 남겨주세요!",
      footer: `제보 시간: ${formatDateTime(createdAt)}`,
      ts: Math.floor(new Date(createdAt).getTime() / 1000)
    });

    // 슬랙으로 전송
    const result = await sendEventSlackMessage(message);

    if (result) {
      console.log('매장 제보 알림이 슬랙으로 전송되었습니다.');
    } else {
      console.error('매장 제보 알림 전송 실패');
    }

    return result;
  } catch (error) {
    console.error('매장 제보 알림 생성 중 오류:', error);
    return false;
  }
}

module.exports = {
  sendEventSlackMessage,
  notifyNewAdRequest,
  notifyNewReview,
  notifyNewStoreReport
};