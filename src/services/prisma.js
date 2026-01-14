const { PrismaClient } = require("../generated/prisma");

// Prisma 클라이언트 인스턴스 생성
const prisma = new PrismaClient({
  // log: process.env.NODE_ENV === 'development' ? ['query', 'info', 'warn', 'error'] : ['error'],
});

// 프로세스 종료 시 Prisma 연결 정리
process.on("beforeExit", async () => {
  await prisma.$disconnect();
});

module.exports = { prisma };
