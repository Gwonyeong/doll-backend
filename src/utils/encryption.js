const crypto = require('crypto');

/**
 * Toss에서 제공하는 AES-GCM 암호화된 데이터를 복호화합니다.
 *
 * @param {string} encryptedData - Base64 인코딩된 암호화된 데이터 (IV + 암호문 + 태그)
 * @param {string} key - Base64 인코딩된 복호화 키 (256비트)
 * @param {string} aad - Additional Authenticated Data
 * @returns {string|null} - 복호화된 평문 또는 null (실패 시)
 */
function decryptTossData(encryptedData, key, aad) {
  try {
    if (!encryptedData || !key || !aad) {
      return null;
    }

    // Base64 디코딩
    const encryptedBuffer = Buffer.from(encryptedData, 'base64');
    const keyBuffer = Buffer.from(key, 'base64');
    const aadBuffer = Buffer.from(aad, 'utf8');

    // IV(Nonce) 추출 (첫 12바이트)
    const ivLength = 12;
    const iv = encryptedBuffer.subarray(0, ivLength);

    // 태그 추출 (마지막 16바이트)
    const tagLength = 16;
    const tag = encryptedBuffer.subarray(encryptedBuffer.length - tagLength);

    // 암호문 추출 (IV와 태그 사이)
    const ciphertext = encryptedBuffer.subarray(ivLength, encryptedBuffer.length - tagLength);

    // 복호화 객체 생성
    const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(aadBuffer);

    // 복호화 수행
    let decrypted = decipher.update(ciphertext, null, 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (error) {
    console.error('Toss 데이터 복호화 실패:', error.message);
    return null;
  }
}

/**
 * 여러 필드를 일괄 복호화합니다.
 *
 * @param {Object} encryptedFields - 암호화된 필드들의 객체
 * @param {string} key - 복호화 키
 * @param {string} aad - AAD
 * @returns {Object} - 복호화된 필드들의 객체
 */
function decryptMultipleFields(encryptedFields, key, aad) {
  const decryptedFields = {};

  for (const [fieldName, encryptedValue] of Object.entries(encryptedFields)) {
    if (encryptedValue && typeof encryptedValue === 'string') {
      const decryptedValue = decryptTossData(encryptedValue, key, aad);
      decryptedFields[fieldName] = decryptedValue;

      // 복호화 실패 시 원본 값 유지 (로깅은 제거)
      if (decryptedValue === null) {
        decryptedFields[fieldName] = encryptedValue;
      }
    } else {
      // 암호화되지 않은 값은 그대로 유지
      decryptedFields[fieldName] = encryptedValue;
    }
  }

  return decryptedFields;
}

/**
 * 사용자 정보 객체의 암호화된 필드들을 복호화합니다.
 *
 * @param {Object} userInfo - Toss에서 받은 사용자 정보
 * @param {string} key - 복호화 키
 * @param {string} aad - AAD
 * @returns {Object} - 복호화된 사용자 정보
 */
function decryptUserInfo(userInfo, key, aad) {
  if (!userInfo || !userInfo.success) {
    return userInfo;
  }

  const encryptedFields = {
    name: userInfo.success.name,
    phone: userInfo.success.phone,
    email: userInfo.success.email,
    gender: userInfo.success.gender,
    birthday: userInfo.success.birthday,
    nationality: userInfo.success.nationality,
    ci: userInfo.success.ci
  };

  const decryptedFields = decryptMultipleFields(encryptedFields, key, aad);

  return {
    ...userInfo,
    success: {
      ...userInfo.success,
      ...decryptedFields
    },
    // 복호화된 필드들을 별도로 제공
    decrypted: decryptedFields
  };
}

module.exports = {
  decryptTossData,
  decryptMultipleFields,
  decryptUserInfo
};