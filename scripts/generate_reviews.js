/**
 * 후기 생성기 스크립트
 * - 가짜 유저 3명 생성
 * - 영업 중인 매장에 1~5개의 랜덤 후기 생성
 *
 * 실행: node scripts/generate_reviews.js [options]
 * 옵션:
 *   --dry-run     실제 생성 없이 미리보기
 *   --stores N    처리할 매장 수 제한
 *   --min N       매장당 최소 후기 수 (기본: 1)
 *   --max N       매장당 최대 후기 수 (기본: 5)
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

// 태그 목록 (WriteReviewPage.js에서 가져옴)
const ALL_TAGS = [
  // 기기/상품
  "기기 상태가 좋아요",
  "상품이 다양해요",
  "신상품이 자주 들어와요",
  "고장 없이 잘 작동해요",
  "인기 캐릭터가 많아요",
  // 가격/혜택
  "가격이 저렴해요",
  "이벤트/서비스가 좋아요",
  "경품 교환이 쉬워요",
  // 분위기/환경
  "매장이 깨끗해요",
  "사진 찍기 좋아요",
  "분위기가 좋아요",
  "가족끼리 가기 좋아요",
  // 접근성
  "위치가 좋아요",
  "주차하기 편해요",
  "찾기 쉬워요",
];

// 긍정 태그 (4-5점용)
const POSITIVE_TAGS = ALL_TAGS;

// 중립 태그 (3점용)
const NEUTRAL_TAGS = [
  "위치가 좋아요",
  "상품이 다양해요",
];

// Supabase 이미지 URL 베이스
const SUPABASE_IMAGE_BASE = 'https://zstwgwszakivdnhwbuei.supabase.co/storage/v1/object/public/dollpickmap/mock_review_images';

// 후기 이미지 파일 목록 (mock_review_images 폴더 기반)
const REVIEW_IMAGES = [
  '1.jpg', '2.jpg', '3.jpg', '4.jpg', '5.jpg', '6.jpg',
  '7.jpeg', '8.jpeg', '9.jpeg', '10.jpeg', '11.jpeg', '12.jpg',
  '13.jpeg', '14.jpeg', '15.jpeg', '16.jpeg', '17.jpeg', '18.jpeg',
  '19.jpeg', '20.jpeg', '21.jpeg', '22.jpeg', '23.jpg', '24.jpeg',
  '25.jpeg', '26.jpeg', '27.jpeg', '28.jpeg', '29.jpeg', '30.jpeg',
  '31.jpeg', '32.jpeg', '33.jpeg', '34.jpg', '35.jpeg', '36.jpeg',
  '37.jpeg', '38.jpeg', '39.jpeg', '40.jpeg', '41.jpeg', '42.jpeg',
  '43.jpeg', '44.jpeg', '45.jpg', '46.jpeg', '47.jpeg', '48.jpeg',
  '49.jpg', '50.jpg', '51.jpg', '52.jpg',
];

// 가짜 유저 닉네임 목록
const FAKE_NICKNAMES = [
  "뽑기왕",
  "인형러버",
  "크레인마스터",
];

/**
 * 01x로 시작하는 가짜 전화번호 생성
 * (010이 아닌 011~019 사용)
 */
function generateFakePhone() {
  const prefix = '01' + (Math.floor(Math.random() * 9) + 1); // 011-019
  const middle = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  const last = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
  return `${prefix}-${middle}-${last}`;
}

/**
 * 랜덤 날짜 생성 (최근 1~6개월)
 */
function getRandomDate() {
  const now = new Date();
  const monthsAgo = Math.floor(Math.random() * 6) + 1; // 1~6개월 전
  const daysAgo = Math.floor(Math.random() * 30); // 0~29일 전
  const date = new Date(now);
  date.setMonth(date.getMonth() - monthsAgo);
  date.setDate(date.getDate() - daysAgo);
  date.setHours(Math.floor(Math.random() * 24));
  date.setMinutes(Math.floor(Math.random() * 60));
  return date;
}

/**
 * 랜덤 후기 이미지 선택 (3점 이상, 70% 확률로 1~4개)
 */
function getRandomReviewImages(rating) {
  // 3점 미만은 이미지 없음
  if (rating < 3) return [];

  // 70% 확률로 이미지 포함
  if (Math.random() > 0.7) return [];

  // 1~4개 랜덤 선택
  const count = getRandomInt(1, 4);
  const shuffled = [...REVIEW_IMAGES].sort(() => Math.random() - 0.5);
  const selectedImages = shuffled.slice(0, count);

  return selectedImages.map(filename => `${SUPABASE_IMAGE_BASE}/${filename}`);
}

/**
 * 랜덤 태그 선택 (0~3개)
 */
function getRandomTags(rating) {
  // 1-2점은 태그 없음
  if (rating <= 2) return [];

  // 3점은 0~1개
  if (rating === 3) {
    if (Math.random() < 0.5) return [];
    const tag = NEUTRAL_TAGS[Math.floor(Math.random() * NEUTRAL_TAGS.length)];
    return [tag];
  }

  // 4-5점은 1~3개
  const count = Math.floor(Math.random() * 3) + 1;
  const shuffled = [...POSITIVE_TAGS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

/**
 * 랜덤 정수 (min~max)
 */
function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 가짜 유저 생성
 */
async function createFakeUsers(dryRun = false) {
  console.log('\n가짜 유저 생성 중...');

  const users = [];

  for (let i = 0; i < FAKE_NICKNAMES.length; i++) {
    const nickname = FAKE_NICKNAMES[i];
    const phone = generateFakePhone();

    if (dryRun) {
      console.log(`  [DRY-RUN] 유저: ${nickname}, 전화번호: ${phone}`);
      users.push({ id: `fake-${i}`, nickname, phone });
    } else {
      // 이미 존재하는지 확인 (닉네임으로)
      let user = await prisma.user.findFirst({
        where: { nickname }
      });

      if (!user) {
        user = await prisma.user.create({
          data: {
            nickname,
            phone,
          }
        });
        console.log(`  생성됨: ${nickname} (${phone})`);
      } else {
        console.log(`  이미 존재: ${nickname}`);
      }

      users.push(user);
    }
  }

  return users;
}

/**
 * 후기 생성
 */
async function generateReviews(options = {}) {
  const {
    dryRun = false,
    storeLimit = null,
    minReviews = 1,
    maxReviews = 5,
  } = options;

  console.log('========================================');
  console.log('후기 생성기');
  console.log('========================================\n');

  if (dryRun) {
    console.log('*** DRY-RUN 모드 (실제 생성 없음) ***\n');
  }

  // 1. 리뷰 템플릿 로드
  const reviewsPath = path.resolve(__dirname, '../../reviews_all.json');
  if (!fs.existsSync(reviewsPath)) {
    console.error('reviews_all.json 파일을 찾을 수 없습니다.');
    console.error(`경로: ${reviewsPath}`);
    process.exit(1);
  }

  const reviewsData = JSON.parse(fs.readFileSync(reviewsPath, 'utf-8'));
  const reviewTemplates = reviewsData.reviews;
  console.log(`리뷰 템플릿: ${reviewTemplates.length}개 로드됨`);

  // 평점별로 분류
  const templatesByRating = {
    1: reviewTemplates.filter(r => r.rating === 1),
    2: reviewTemplates.filter(r => r.rating === 2),
    3: reviewTemplates.filter(r => r.rating === 3),
    4: reviewTemplates.filter(r => r.rating === 4),
    5: reviewTemplates.filter(r => r.rating === 5),
  };

  console.log('평점별 템플릿 수:');
  for (let i = 5; i >= 1; i--) {
    console.log(`  ${i}점: ${templatesByRating[i].length}개`);
  }

  // 2. 가짜 유저 생성
  const fakeUsers = await createFakeUsers(dryRun);

  // 3. 영업 중인 매장 조회
  console.log('\n영업 중인 매장 조회 중...');
  let stores = await prisma.gameBusiness.findMany({
    where: {
      영업상태명: '영업/정상',
      좌표정보x: { not: null },
      좌표정보y: { not: null },
    },
    select: {
      id: true,
      사업장명: true,
    },
    orderBy: {
      id: 'asc'
    }
  });

  if (storeLimit) {
    stores = stores.slice(0, storeLimit);
  }

  console.log(`대상 매장: ${stores.length}개`);

  // 4. 각 매장에 후기 생성
  console.log('\n후기 생성 중...');
  let totalCreated = 0;
  let totalSkipped = 0;

  for (let i = 0; i < stores.length; i++) {
    const store = stores[i];
    const reviewCount = getRandomInt(minReviews, maxReviews);

    // 평점 가중치 (4-5점이 더 많이 나오도록)
    // 5점: 40%, 4점: 35%, 3점: 15%, 2점: 7%, 1점: 3%
    const ratingWeights = [
      { rating: 5, weight: 40 },
      { rating: 4, weight: 35 },
      { rating: 3, weight: 15 },
      { rating: 2, weight: 7 },
      { rating: 1, weight: 3 },
    ];

    for (let j = 0; j < reviewCount; j++) {
      // 가중치 기반 평점 선택
      const rand = Math.random() * 100;
      let cumulative = 0;
      let selectedRating = 5;
      for (const { rating, weight } of ratingWeights) {
        cumulative += weight;
        if (rand < cumulative) {
          selectedRating = rating;
          break;
        }
      }

      // 해당 평점의 템플릿에서 랜덤 선택
      const templates = templatesByRating[selectedRating];
      if (templates.length === 0) continue;

      const template = templates[Math.floor(Math.random() * templates.length)];

      // 랜덤 유저 선택
      const user = fakeUsers[Math.floor(Math.random() * fakeUsers.length)];

      // 랜덤 태그 선택
      const tags = getRandomTags(selectedRating);

      // 랜덤 날짜
      const createdAt = getRandomDate();

      // 랜덤 후기 이미지 (3점 이상, 70% 확률)
      const images = getRandomReviewImages(selectedRating);

      // 인형 자랑 데이터 (항상 0)
      const dollCount = 0;
      const spentAmount = 0;

      if (dryRun) {
        if (i < 3 && j === 0) { // 처음 3개 매장의 첫 후기만 출력
          console.log(`\n[DRY-RUN] ${store.사업장명}`);
          console.log(`  평점: ${selectedRating}, 내용: ${template.text.substring(0, 30)}...`);
          console.log(`  유저: ${user.nickname}, 태그: ${tags.join(', ') || '없음'}`);
          console.log(`  이미지: ${images.length}개`);
        }
        totalCreated++;
      } else {
        try {
          await prisma.review.create({
            data: {
              storeId: store.id,
              rating: selectedRating,
              content: template.text,
              images,
              tags,
              dollCount,
              spentAmount,
              dollImages: [],
              userId: user.id,
              userName: user.nickname,
              createdAt,
            }
          });
          totalCreated++;
        } catch (error) {
          totalSkipped++;
          if (totalSkipped <= 3) {
            console.error(`\n오류 (${store.사업장명}):`, error.message);
          }
        }
      }
    }

    // 진행 상황 출력
    if ((i + 1) % 100 === 0 || i === stores.length - 1) {
      process.stdout.write(`\r진행: ${i + 1}/${stores.length} 매장 (후기 ${totalCreated}개 생성)`);
    }
  }

  console.log('\n\n========================================');
  console.log('완료!');
  console.log('========================================');
  console.log(`- 처리된 매장: ${stores.length}개`);
  console.log(`- 생성된 후기: ${totalCreated}개`);
  if (totalSkipped > 0) {
    console.log(`- 스킵된 후기: ${totalSkipped}개`);
  }
}

async function main() {
  const args = process.argv.slice(2);

  const options = {
    dryRun: args.includes('--dry-run'),
    storeLimit: null,
    minReviews: 1,
    maxReviews: 5,
  };

  // --stores N
  const storesIdx = args.indexOf('--stores');
  if (storesIdx !== -1 && args[storesIdx + 1]) {
    options.storeLimit = parseInt(args[storesIdx + 1]);
  }

  // --min N
  const minIdx = args.indexOf('--min');
  if (minIdx !== -1 && args[minIdx + 1]) {
    options.minReviews = parseInt(args[minIdx + 1]);
  }

  // --max N
  const maxIdx = args.indexOf('--max');
  if (maxIdx !== -1 && args[maxIdx + 1]) {
    options.maxReviews = parseInt(args[maxIdx + 1]);
  }

  try {
    await generateReviews(options);
  } catch (error) {
    console.error('\n오류 발생:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
