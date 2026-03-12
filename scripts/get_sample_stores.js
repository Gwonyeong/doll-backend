/**
 * 샘플 매장 데이터 조회 스크립트
 * 실행: node scripts/get_sample_stores.js
 */

const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

async function main() {
  try {
    // 영업 중인 매장 3개 조회 (좌표 정보가 있는 것만)
    const stores = await prisma.gameBusiness.findMany({
      where: {
        영업상태명: '영업/정상',
        좌표정보x: { not: null },
        좌표정보y: { not: null },
      },
      select: {
        id: true,
        사업장명: true,
        소재지전체주소: true,
        도로명전체주소: true,
        소재지전화: true,
        업태구분명: true,
        좌표정보x: true,
        좌표정보y: true,
      },
      take: 10, // 10개 조회해서 그 중 3개 선택
    });

    console.log('\n========================================');
    console.log('샘플 매장 데이터 (크롤링 테스트용)');
    console.log('========================================\n');

    stores.slice(0, 3).forEach((store, index) => {
      console.log(`[${index + 1}] ${store.사업장명}`);
      console.log(`    - ID: ${store.id}`);
      console.log(`    - 주소: ${store.도로명전체주소 || store.소재지전체주소}`);
      console.log(`    - 전화: ${store.소재지전화 || '없음'}`);
      console.log(`    - 업종: ${store.업태구분명 || '미분류'}`);
      console.log('');
    });

    // JSON 형식으로도 출력
    console.log('\n========================================');
    console.log('JSON 형식 (크롤러 입력용)');
    console.log('========================================\n');

    const storesForCrawler = stores.slice(0, 3).map(store => ({
      id: store.id,
      name: store.사업장명,
      address: store.도로명전체주소 || store.소재지전체주소,
      phone: store.소재지전화,
    }));

    console.log(JSON.stringify(storesForCrawler, null, 2));

  } catch (error) {
    console.error('오류 발생:', error);
  } finally {
    await prisma.$disconnect();
  }
}

main();
