import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const logs = await prisma.syncLog.findMany({
    orderBy: { created_at: 'desc' },
    take: 5,
    include: {
        integration: true
    }
  });

  console.log(JSON.stringify(logs, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
