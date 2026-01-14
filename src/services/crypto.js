const crypto = require('crypto');

/**
 * 토스에서 제공하는 개별 필드 암호화 데이터를 복호화합니다.
 * @param {string} encryptedData Base64로 인코딩된 암호화 데이터
 * @param {string} encryptionKey 32바이트 암호화 키
 * @param {string} aad AAD (Additional Authenticated Data)
 * @returns {string} 복호화된 문자열
 */
function decryptTossField(encryptedData, encryptionKey, aad) {
  try {
    // Base64 디코딩
    const buffer = Buffer.from(encryptedData, 'base64');

    // IV (처음 12바이트)
    const iv = buffer.subarray(0, 12);

    // 암호화된 데이터 (마지막 16바이트 제외)
    const encrypted = buffer.subarray(12, buffer.length - 16);

    // 인증 태그 (마지막 16바이트)
    const authTag = buffer.subarray(buffer.length - 16);

    // 암호화 키 생성 (32바이트)
    const key = Buffer.from(encryptionKey, 'utf-8').subarray(0, 32);

    // AES-256-GCM 복호화
    const decipher = crypto.createDecipherGCM('aes-256-gcm');
    decipher.setAuthTag(authTag);

    if (aad) {
      decipher.setAAD(Buffer.from(aad, 'utf-8'));
    }

    let decrypted = decipher.update(encrypted, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('복호화 오류:', error);
    throw new Error('데이터 복호화에 실패했습니다.');
  }
}

/**
 * 토스 사용자 정보를 복호화합니다.
 * @param {Object} encryptedUserInfo 암호화된 사용자 정보
 * @param {string} encryptionKey 암호화 키
 * @returns {Object} 복호화된 사용자 정보
 */
function decryptTossUserInfo(encryptedUserInfo, encryptionKey) {
  try {
    const userInfo = {};

    // 각 필드별로 복호화
    if (encryptedUserInfo.user_key) {
      userInfo.id = decryptTossField(encryptedUserInfo.user_key, encryptionKey);
    }

    if (encryptedUserInfo.user_name) {
      userInfo.name = decryptTossField(encryptedUserInfo.user_name, encryptionKey);
      userInfo.nickname = userInfo.name; // 닉네임으로 실명 사용
    }

    if (encryptedUserInfo.user_email) {
      userInfo.email = decryptTossField(encryptedUserInfo.user_email, encryptionKey);
    }

    if (encryptedUserInfo.user_phone) {
      userInfo.phone = decryptTossField(encryptedUserInfo.user_phone, encryptionKey);
    }

    if (encryptedUserInfo.user_birthday) {
      userInfo.birthday = decryptTossField(encryptedUserInfo.user_birthday, encryptionKey);
    }

    if (encryptedUserInfo.user_gender) {
      userInfo.gender = decryptTossField(encryptedUserInfo.user_gender, encryptionKey);
    }

    if (encryptedUserInfo.user_ci) {
      userInfo.ci = decryptTossField(encryptedUserInfo.user_ci, encryptionKey);
    }

    if (encryptedUserInfo.user_di) {
      userInfo.di = decryptTossField(encryptedUserInfo.user_di, encryptionKey);
    }

    return userInfo;
  } catch (error) {
    console.error('사용자 정보 복호화 오류:', error);
    throw new Error('사용자 정보 복호화에 실패했습니다.');
  }
}

/**
 * JWT 토큰의 만료 여부를 확인합니다.
 * @param {string} token JWT 토큰
 * @returns {boolean} 만료 여부
 */
function isTokenExpired(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    const now = Math.floor(Date.now() / 1000);
    return payload.exp < now;
  } catch (error) {
    console.error('토큰 확인 오류:', error);
    return true; // 오류 시 만료된 것으로 간주
  }
}

module.exports = {
  decryptTossField,
  decryptTossUserInfo,
  isTokenExpired
};