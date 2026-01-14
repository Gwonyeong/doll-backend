const axios = require('axios');

/**
 * Slack Webhook 관련 유틸리티 함수들
 */

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

/**
 * Slack으로 메시지를 전송하는 함수
 * @param {Object} message - Slack 메시지 객체
 * @param {string} message.text - 메시지 텍스트
 * @param {string} [message.username] - 사용자명
 * @param {string} [message.icon_emoji] - 이모지 아이콘
 * @param {string} [message.channel] - 채널
 * @param {Array} [message.attachments] - 첨부파일 배열
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendSlackMessage(message) {
  try {
    const response = await axios.post(SLACK_WEBHOOK_URL, message, {
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 5000 // 5초 타임아웃
    });

    return response.status === 200;
  } catch (error) {
    console.error('Slack 메시지 전송 실패:', error.message);
    return false;
  }
}

/**
 * 간단한 텍스트 메시지를 Slack으로 전송하는 함수
 * @param {string} text - 전송할 텍스트
 * @returns {Promise<boolean>} 전송 성공 여부
 */
async function sendSimpleSlackMessage(text) {
  return sendSlackMessage({ text });
}

module.exports = {
  sendSlackMessage,
  sendSimpleSlackMessage
};