import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const items = await prisma.inventoryItem.findMany({
    select: {
      id: true,
      serial_number: true,
      hostname: true,
      ip_address: true,
      model: {
        select: { name: true, vendor: { select: { name: true } } }
      }
    }
  });

  console.log('--- CURRENT INVENTORY ---');
  console.log(JSON.stringify(items, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
