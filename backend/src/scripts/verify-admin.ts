import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function reset() {
  const password = 'admin123';
  const salt = 12;
  const hp = await bcrypt.hash(password, salt);
  
  console.log('Target Username: admin');
  console.log('Target Password:', password);
  console.log('Generated Hash:', hp);

  try {
    const user = await prisma.user.upsert({
      where: { username: 'admin' },
      update: { 
        password: hp, 
        role: 'admin',
        is_active: true 
      },
      create: { 
        username: 'admin', 
        password: hp, 
        email: 'admin@inventrops.com', 
        role: 'admin',
        is_active: true
      }
    });
    console.log('User upserted successfully:', user.username);
    
    // Test verification immediately
    const isMatch = await bcrypt.compare(password, user.password);
    console.log('Immediate Verification Test:', isMatch ? 'SUCCESS' : 'FAILED');

  } catch (err) {
    console.error('Error during upsert:', err);
  } finally {
    await prisma.$disconnect();
  }
}

reset();
