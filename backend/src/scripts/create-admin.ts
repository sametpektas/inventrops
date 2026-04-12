import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

// Correct Prisma 7+ syntax for manual connection string
const prisma = new PrismaClient();

async function main() {
  const username = 'admin';
  const password = 'admin123';
  const email = 'admin@inventrops.com';
  const hashedPassword = await bcrypt.hash(password, 10);

  try {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      await prisma.user.update({
        where: { id: existing.id },
        data: {
          password: hashedPassword,
          role: 'admin',
          is_active: true
        }
      });
      console.log(`[Admin] Admin user '${username}' updated successfully.`);
    } else {
      await prisma.user.create({
        data: {
          username,
          password: hashedPassword,
          email,
          role: 'admin',
          is_active: true
        }
      });
      console.log(`[Admin] Admin user '${username}' created successfully.`);
    }
  } catch (err) {
    console.error('[Admin] Error creating admin:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
