const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { supabase } = require('../config/supabase');

const router = express.Router();

// Multer 설정: 메모리에 파일 저장
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB 제한
  },
  fileFilter: (req, file, cb) => {
    // 이미지 파일만 허용
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('이미지 파일만 업로드 가능합니다.'), false);
    }
  }
});

/**
 * POST /api/upload/images
 * 이미지 파일들을 Supabase Storage에 업로드
 */
router.post('/images', upload.array('images', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '업로드할 이미지가 없습니다.'
      });
    }

    const uploadedUrls = [];

    for (const file of req.files) {
      // 고유한 파일명 생성
      const fileExtension = file.originalname.split('.').pop();
      const fileName = `${uuidv4()}.${fileExtension}`;
      const filePath = `review-images/${fileName}`;

      // Supabase Storage에 파일 업로드
      const { data, error } = await supabase.storage
        .from('dollpickmap')
        .upload(filePath, file.buffer, {
          contentType: file.mimetype,
          cacheControl: '3600',
          upsert: false
        });

      if (error) {
        console.error('Supabase 업로드 오류:', error);
        return res.status(500).json({
          error: 'Storage Error',
          message: '이미지 업로드 중 오류가 발생했습니다.'
        });
      }

      // 공개 URL 생성
      const { data: publicUrlData } = supabase.storage
        .from('dollpickmap')
        .getPublicUrl(filePath);

      uploadedUrls.push(publicUrlData.publicUrl);
    }

    res.json({
      success: true,
      message: '이미지가 성공적으로 업로드되었습니다.',
      data: {
        urls: uploadedUrls
      }
    });

  } catch (error) {
    console.error('이미지 업로드 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '이미지 업로드 중 오류가 발생했습니다.'
    });
  }
});

/**
 * DELETE /api/upload/images
 * Supabase Storage에서 이미지 파일 삭제
 */
router.delete('/images', async (req, res) => {
  try {
    const { urls } = req.body;

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return res.status(400).json({
        error: 'Bad Request',
        message: '삭제할 이미지 URL이 없습니다.'
      });
    }

    const filePaths = urls.map(url => {
      // URL에서 파일 경로 추출
      const urlParts = url.split('/');
      return urlParts.slice(-2).join('/'); // review-images/filename.ext 형태
    });

    const { error } = await supabase.storage
      .from('dollpickmap')
      .remove(filePaths);

    if (error) {
      console.error('Supabase 삭제 오류:', error);
      return res.status(500).json({
        error: 'Storage Error',
        message: '이미지 삭제 중 오류가 발생했습니다.'
      });
    }

    res.json({
      success: true,
      message: '이미지가 성공적으로 삭제되었습니다.'
    });

  } catch (error) {
    console.error('이미지 삭제 오류:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: '이미지 삭제 중 오류가 발생했습니다.'
    });
  }
});

module.exports = router;