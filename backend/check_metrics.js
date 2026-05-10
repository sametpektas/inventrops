const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkMetrics() {
  try {
    const iopsCount = await prisma.forecastMetricSnapshot.count({
      where: { metric_name: 'iops' }
    });
    const rtCount = await prisma.forecastMetricSnapshot.count({
      where: { metric_name: 'response_time' }
    });

    console.log(`IOPS records: ${iopsCount}`);
    console.log(`Response Time records: ${rtCount}`);

    const sample = await prisma.forecastMetricSnapshot.findMany({
      where: { metric_name: { in: ['iops', 'response_time'] } },
      take: 5
    });

    console.log('Sample records:', sample);

    // Also check what metrics ACTUALLY exist
    const distinctMetrics = await prisma.forecastMetricSnapshot.findMany({
      distinct: ['metric_name'],
      select: { metric_name: true }
    });
    console.log('Available metrics in DB:', distinctMetrics.map(m => m.metric_name));

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

checkMetrics();
