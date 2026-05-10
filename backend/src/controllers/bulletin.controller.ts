import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import pptxgen from 'pptxgenjs';

export const generateBulletin = async (req: Request, res: Response) => {
  try {
    const { serialNumbers } = req.body;

    if (!Array.isArray(serialNumbers)) {
      return res.status(400).json({ error: 'serialNumbers must be an array of strings' });
    }

    // Determine target months to look back (up to 6 months)
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Fetch ALL storage devices to build a global location map
    // We need this because ForecastMetricSnapshot doesn't have a direct relation to Rack
    const allStorageDevices = await prisma.inventoryItem.findMany({
      where: {
        model: {
          device_type: { in: ['storage'] }
        }
      },
      include: {
        rack: {
          include: {
            room: {
              include: {
                datacenter: true
              }
            }
          }
        }
      }
    });

    const globalLocationMap: Record<string, string> = {};
    allStorageDevices.forEach((d: any) => {
      const dcName = d.rack?.room?.datacenter?.name?.toLowerCase() || '';
      if (dcName.includes('ankara')) {
        globalLocationMap[d.serial_number] = 'Ankara (Prod)';
      } else if (dcName.includes('istanbul')) {
        globalLocationMap[d.serial_number] = 'Istanbul (DR)';
      } else {
        globalLocationMap[d.serial_number] = 'Bilinmeyen Lokasyon';
      }
    });

    // Fetch all storage metrics for the general capacity slide
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        metric_name: { contains: 'capacity' },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    // Process allStorageMetrics for General Capacity (grouped by DAY and Location)
    const generalCapacityData = processMetrics(allStorageMetrics, 'avm', 'varyap', globalLocationMap);

    // Fetch selected devices metrics
    const selectedMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        device_serial: { in: serialNumbers },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    // Process selected devices for Capacity, IOPS, Response Time
    const selectedCapacityData = processMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('capacity')),
      'avm', 'varyap', globalLocationMap
    );
    const selectedIopsData = processMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('iops')),
      'avm', 'varyap', globalLocationMap
    );
    const selectedResponseTimeData = processMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency')),
      'avm', 'varyap', globalLocationMap
    );

    // Generate PPTX
    const pres = new pptxgen();

    // 1. Genel Kapasite (Bütün Storageler)
    addChartSlide(pres, 'Genel Depolama Kapasite Kullanımı', generalCapacityData);

    // 2. Seçilen Cihazlar - Kapasite
    addChartSlide(pres, 'Kapasite Kullanımı (Seçili Cihazlar)', selectedCapacityData);

    // 3. Seçilen Cihazlar - IOPS
    addChartSlide(pres, 'IOPS (Seçili Cihazlar)', selectedIopsData);

    // 4. Seçilen Cihazlar - Response Time
    addChartSlide(pres, 'Response Time / Gecikme (Seçili Cihazlar)', selectedResponseTimeData);

    // Export Presentation
    // @ts-ignore
    const buffer = await pres.stream() as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="inventrops-bulten.pptx"');
    res.send(buffer);

  } catch (error) {
    console.error('[Bulletin Controller Error]', error);
    res.status(500).json({ error: 'Bülten oluşturulurken bir hata oluştu.' });
  }
};

/**
 * Process metrics and group by DAY (YYYY-MM-DD) and location (Ankara vs Istanbul)
 */
function processMetrics(metrics: any[], prodKeyword: string, drKeyword: string, locationMap: Record<string, string>) {
  const chartDataMap: Record<string, { prod: number[], dr: number[] }> = {};

  metrics.forEach(m => {
    const d = new Date(m.captured_at);
    // Group by Day instead of Month
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

    if (!chartDataMap[dayKey]) {
      chartDataMap[dayKey] = { prod: [], dr: [] };
    }

    let isProd = false;
    let isDr = false;

    if (m.object_id && locationMap[m.object_id]) {
      const loc = locationMap[m.object_id].toLowerCase();
      if (loc.includes(prodKeyword.toLowerCase())) isProd = true;
      else if (loc.includes(drKeyword.toLowerCase())) isDr = true;
    }

    const value = parseFloat(m.metric_value) || 0;

    if (isProd) {
      chartDataMap[dayKey].prod.push(value);
    } else if (isDr) {
      chartDataMap[dayKey].dr.push(value);
    }
  });

  const labels = Object.keys(chartDataMap).sort();
  const prodValues = labels.map(l => {
    const arr = chartDataMap[l].prod;
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; // Average per day
  });
  const drValues = labels.map(l => {
    const arr = chartDataMap[l].dr;
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; // Average per day
  });

  return { labels, prodValues, drValues };
}

function addChartSlide(pres: pptxgen, title: string, data: any) {
  const slide = pres.addSlide();
  slide.addText(title, { x: 0.5, y: 0.5, w: '90%', fontSize: 24, bold: true, color: '363636' });

  if (!data.labels || data.labels.length === 0) {
    slide.addText('Yeterli veri bulunamadı.', { x: 0.5, y: 2, w: '90%', fontSize: 14, color: '888888' });
    return;
  }

  const chartData = [
    {
      name: 'Ankara (Prod)',
      labels: data.labels,
      values: data.prodValues
    },
    {
      name: 'Istanbul (DR)',
      labels: data.labels,
      values: data.drValues
    }
  ];

  slide.addChart(pres.ChartType.line, chartData, {
    x: 0.5,
    y: 1.5,
    w: 9,
    h: 3.5,
    showLegend: true,
    legendPos: 'b',
    lineSmooth: true
  });
}
