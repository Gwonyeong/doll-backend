/**
 * CSV 파일을 이용한 데이터베이스 업데이트 스크립트
 * - 관리번호를 기준으로 기존 데이터 업데이트 또는 새로 생성 (upsert)
 *
 * 실행: node scripts/update_from_csv.js <csv_file_path>
 * 예시: node scripts/update_from_csv.js "../문화_청소년게임제공업 - 문화_청소년게임제공업.csv"
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('../src/generated/prisma');

const prisma = new PrismaClient();

// CSV 컬럼 → DB 컬럼 매핑
const COLUMN_MAPPING = {
  '개방자치단체코드': '개방자치단체코드',
  '관리번호': '관리번호',
  '인허가일자': '인허가일자',
  '인허가취소일자': '인허가취소일자',
  '영업상태명': '영업상태명',
  '폐업일자': '폐업일자',
  '휴업시작일자': '휴업시작일자',
  '휴업종료일자': '휴업종료일자',
  '소재지우편번호': '소재지우편번호',
  '도로명우편번호': '도로명우편번호',
  '사업장명': '사업장명',
  '데이터갱신구분': '데이터갱신구분',
  '건물용도명': '건물용도명',
  '기존게임업외업종명': '기존게임업외업종명',
  '노래방실수': '노래방실수',
  '데이터갱신시점': '최종수정시점',
  '도로명주소': '도로명전체주소',
  '문화사업자구분명': '문화사업자구분명',
  '문화체육업종명': '문화체육업종명',
  '방음시설여부': '방음시설여부',
  '비디오재생기명': '비디오재생기명',
  '비상계단여부': '비상계단여부',
  '비상구여부': '비상구여부',
  '상세영업상태명': '상세영업상태명',
  '상세영업상태코드': '상세영업상태코드',
  '소방시설여부': '소방시설여부',
  '시설면적': '시설면적',
  '영업상태코드': '영업상태구분코드',
  '음향시설여부': '음향시설여부',
  '자동환기여부': '자동환기여부',
  '전화번호': '소재지전화',
  '제공게임물명': '제공게임물명',
  '제작취급품목내용': '제작취급품목내용',
  '조명시설유무': '조명시설유무',
  '조명시설조도': '조명시설조도',
  '좌표정보(X)': '좌표정보x',
  '좌표정보(Y)': '좌표정보y',
  '주변환경명': '주변환경명',
  '지번주소': '소재지전체주소',
  '지상층수': '지상층수',
  '지역구분명': '지역구분명',
  '지하층수': '지하층수',
  '청소년실수': '청소년실수',
  '청소년실여부': '청소년실여부',
  '총게임기수': '총게임기수',
  '총층수': '총층수',
  '통로너비': '통로너비',
  '특수조명여부': '특수조명여부',
  '편의시설여부': '편의시설여부',
  '최종수정시점': '최종수정시점',
};

/**
 * RFC 4180 표준 CSV 파싱 함수
 * - 따옴표로 감싸진 필드 내 쉼표 처리
 * - 이스케이프된 따옴표("") 처리
 * - 줄바꿈이 포함된 필드 처리
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // 다음 문자가 또 따옴표면 이스케이프된 따옴표
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        } else {
          // 따옴표 종료
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        current += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        // 따옴표 시작
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        // 필드 구분자
        result.push(current.trim());
        current = '';
        i++;
        continue;
      } else {
        current += char;
        i++;
        continue;
      }
    }
  }

  // 마지막 필드 추가
  result.push(current.trim());

  return result;
}

/**
 * CSV 행을 DB 데이터 객체로 변환
 */
function mapRowToDbData(headers, values) {
  const data = {};

  headers.forEach((header, index) => {
    const trimmedHeader = header.trim();
    const dbColumn = COLUMN_MAPPING[trimmedHeader];

    if (dbColumn && values[index] !== undefined) {
      // 빈 문자열은 null로 처리
      let value = values[index];

      if (value === '' || value === null || value === undefined) {
        data[dbColumn] = null;
      } else {
        // 문자열 정리 (앞뒤 공백 제거)
        value = String(value).trim();
        data[dbColumn] = value === '' ? null : value;
      }
    }
  });

  return data;
}

/**
 * 배치 upsert 함수
 */
async function batchUpsert(records, batchSize = 100) {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map(async (record) => {
        if (!record.관리번호) {
          throw new Error('관리번호가 없습니다');
        }

        // 기존 레코드 찾기
        const existing = await prisma.gameBusiness.findFirst({
          where: { 관리번호: record.관리번호 }
        });

        if (existing) {
          // 업데이트 (기존 데이터는 좌표 없어도 업데이트)
          await prisma.gameBusiness.update({
            where: { id: existing.id },
            data: record,
          });
          return 'updated';
        } else {
          // 새로 생성 - 좌표정보가 없으면 스킵
          if (!record.좌표정보x || !record.좌표정보y) {
            return 'skipped';
          }

          await prisma.gameBusiness.create({
            data: record,
          });
          return 'created';
        }
      })
    );

    // 결과 집계
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        if (result.value === 'created') created++;
        else if (result.value === 'updated') updated++;
        else if (result.value === 'skipped') skipped++;
      } else {
        errors++;
        if (errors <= 5) {
          console.error(`\n오류 (${batch[idx]?.관리번호 || 'unknown'}):`, result.reason?.message);
        }
      }
    });

    // 진행 상황 출력
    const progress = Math.min(i + batchSize, records.length);
    process.stdout.write(`\r진행: ${progress}/${records.length} (생성: ${created}, 업데이트: ${updated}, 스킵: ${skipped}, 오류: ${errors})`);
  }

  console.log(''); // 줄바꿈
  return { created, updated, skipped, errors };
}

/**
 * 디버그: 첫 몇 행 파싱 결과 출력
 */
function debugParsing(headers, lines, count = 3) {
  console.log('\n========================================');
  console.log('파싱 디버그 (처음 몇 행)');
  console.log('========================================');

  console.log('\n헤더 개수:', headers.length);
  console.log('헤더 목록:');
  headers.forEach((h, i) => {
    const dbCol = COLUMN_MAPPING[h.trim()];
    console.log(`  [${i}] "${h}" → ${dbCol || '(매핑 없음)'}`);
  });

  for (let i = 1; i <= Math.min(count, lines.length - 1); i++) {
    console.log(`\n--- 행 ${i} ---`);
    const values = parseCSVLine(lines[i]);
    console.log('값 개수:', values.length);

    // 주요 컬럼 확인
    const importantCols = ['관리번호', '사업장명', '영업상태명', '인허가일자', '제공게임물명', '개방자치단체코드', '좌표정보(X)', '좌표정보(Y)'];
    importantCols.forEach(col => {
      const idx = headers.findIndex(h => h.trim() === col);
      if (idx !== -1) {
        console.log(`  ${col} [${idx}]: "${values[idx] || '(빈값)'}"`);
      }
    });
  }
  console.log('\n========================================\n');
}

async function main() {
  const args = process.argv.slice(2);
  const debugMode = args.includes('--debug');
  const csvPathArg = args.find(arg => !arg.startsWith('--'));

  if (!csvPathArg) {
    console.log('사용법: node scripts/update_from_csv.js <csv_file_path> [--debug]');
    console.log('예시: node scripts/update_from_csv.js "../문화_청소년게임제공업.csv"');
    console.log('옵션:');
    console.log('  --debug  처음 몇 행의 파싱 결과를 출력하고 종료');
    process.exit(1);
  }

  const csvPath = path.resolve(csvPathArg);

  if (!fs.existsSync(csvPath)) {
    console.error(`파일을 찾을 수 없습니다: ${csvPath}`);
    process.exit(1);
  }

  console.log('========================================');
  console.log('CSV 데이터베이스 업데이트 스크립트');
  console.log('========================================\n');
  console.log(`파일: ${csvPath}`);

  try {
    // CSV 파일 읽기
    console.log('\nCSV 파일 읽는 중...');
    const content = fs.readFileSync(csvPath, 'utf-8');
    const lines = content.split('\n').filter(line => line.trim());

    if (lines.length < 2) {
      console.error('CSV 파일에 데이터가 없습니다');
      process.exit(1);
    }

    // 헤더 파싱
    const headers = parseCSVLine(lines[0]);
    console.log(`컬럼 수: ${headers.length}`);
    console.log(`데이터 행 수: ${lines.length - 1}`);

    // 디버그 모드
    if (debugMode) {
      debugParsing(headers, lines, 5);
      console.log('디버그 모드 종료. 실제 업데이트를 실행하려면 --debug 옵션을 제거하세요.');
      process.exit(0);
    }

    // 데이터 파싱
    console.log('\n데이터 파싱 중...');
    const records = [];
    let parseErrors = 0;

    for (let i = 1; i < lines.length; i++) {
      try {
        const values = parseCSVLine(lines[i]);

        // 컬럼 수 불일치 체크
        if (values.length !== headers.length) {
          parseErrors++;
          if (parseErrors <= 3) {
            console.warn(`\n경고: 행 ${i}의 컬럼 수 불일치 (헤더: ${headers.length}, 값: ${values.length})`);
          }
          continue;
        }

        const data = mapRowToDbData(headers, values);

        if (data.관리번호) {
          records.push(data);
        }
      } catch (err) {
        parseErrors++;
        if (parseErrors <= 3) {
          console.error(`\n파싱 오류 (행 ${i}):`, err.message);
        }
      }
    }

    console.log(`유효한 레코드 수: ${records.length}`);
    if (parseErrors > 0) {
      console.log(`파싱 오류: ${parseErrors}건`);
    }

    // 데이터베이스 업데이트
    console.log('\n데이터베이스 업데이트 중...');
    const startTime = Date.now();

    const { created, updated, skipped, errors } = await batchUpsert(records);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);

    console.log('\n========================================');
    console.log('완료!');
    console.log('========================================');
    console.log(`- 새로 생성: ${created}건`);
    console.log(`- 업데이트: ${updated}건`);
    console.log(`- 스킵 (좌표 없음): ${skipped}건`);
    console.log(`- 오류: ${errors}건`);
    console.log(`- 소요 시간: ${elapsed}초`);

  } catch (error) {
    console.error('\n오류 발생:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
