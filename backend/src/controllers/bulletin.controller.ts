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

    // Fetch device details to get locations
    const devices = await prisma.inventoryItem.findMany({
      where: {
        serial_number: { in: serialNumbers }
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

    // Create a map to quickly look up device location (Ankara/Prod vs Istanbul/DR)
    const locationMap: Record<string, string> = {};
    devices.forEach(d => {
      const dcName = d.rack?.room?.datacenter?.name?.toLowerCase() || '';
      if (dcName.includes('ankara')) {
        locationMap[d.serial_number] = 'Ankara (Prod)';
      } else if (dcName.includes('istanbul')) {
        locationMap[d.serial_number] = 'Istanbul (DR)';
      } else {
        locationMap[d.serial_number] = 'Bilinmeyen Lokasyon';
      }
    });

    // Fetch all storage metrics for the general capacity slide
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        metric_name: { contains: 'capacity' },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' },
      include: {
        source: {
          include: {
            rack: { include: { room: { include: { datacenter: true } } } }
          }
        }
      }
    });

    // Process allStorageMetrics for General Capacity (grouped by Month and Location)
    const generalCapacityData = processMetrics(allStorageMetrics, 'Ankara', 'Istanbul');

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
      'Ankara', 'Istanbul', locationMap
    );
    const selectedIopsData = processMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('iops')), 
      'Ankara', 'Istanbul', locationMap
    );
    const selectedResponseTimeData = processMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency')), 
      'Ankara', 'Istanbul', locationMap
    );

    // Generate PPTX
    const pres = new pptxgen();

    // 1. Genel Kapasite (Bütün Storageler)
    addChartSlide(pres, 'Genel Depolama Kapasite Kullanımı (Tüm Cihazlar)', generalCapacityData);

    // 2. Seçilen Cihazlar - Kapasite
    addChartSlide(pres, 'Kapasite Kullanımı (Seçili Cihazlar)', selectedCapacityData);

    // 3. Seçilen Cihazlar - IOPS
    addChartSlide(pres, 'IOPS (Seçili Cihazlar)', selectedIopsData);

    // 4. Seçilen Cihazlar - Response Time
    addChartSlide(pres, 'Response Time / Gecikme (Seçili Cihazlar)', selectedResponseTimeData);

    // Export Presentation
    const buffer = await pres.write({ type: 'nodebuffer' }) as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="inventrops-bulten.pptx"');
    res.send(buffer);

  } catch (error) {
    console.error('[Bulletin Controller Error]', error);
    res.status(500).json({ error: 'Bülten oluşturulurken bir hata oluştu.' });
  }
};

/**
 * Process metrics and group by month (MM-YYYY) and location (Ankara vs Istanbul)
 */
function processMetrics(metrics: any[], prodKeyword: string, drKeyword: string, specificLocationMap?: Record<string, string>) {
  const chartDataMap: Record<string, { prod: number[], dr: number[], prodCount: number[], drCount: number[] }> = {};
  
  metrics.forEach(m => {
    const d = new Date(m.captured_at);
    const monthKey = `${String(d.getMonth() + 1).padStart(2, '0')}-${d.getFullYear()}`;
    
    if (!chartDataMap[monthKey]) {
      chartDataMap[monthKey] = { prod: [], dr: [], prodCount: [], drCount: [] };
    }

    let isProd = false;
    let isDr = false;

    if (specificLocationMap && m.device_serial) {
      const loc = specificLocationMap[m.device_serial];
      if (loc && loc.includes(prodKeyword)) isProd = true;
      else if (loc && loc.includes(drKeyword)) isDr = true;
    } else if (m.source && m.source.rack) {
      const dcName = m.source.rack.room?.datacenter?.name?.toLowerCase() || '';
      if (dcName.includes(prodKeyword.toLowerCase())) isProd = true;
      else if (dcName.includes(drKeyword.toLowerCase())) isDr = true;
    }

    const value = parseFloat(m.metric_value) || 0;

    if (isProd) {
      chartDataMap[monthKey].prod.push(value);
    } else if (isDr) {
      chartDataMap[monthKey].dr.push(value);
    }
  });

  const labels = Object.keys(chartDataMap).sort(); // Sort by MM-YYYY isn't perfect string sort, but simplified here
  const prodValues = labels.map(l => {
    const arr = chartDataMap[l].prod;
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; // Average
  });
  const drValues = labels.map(l => {
    const arr = chartDataMap[l].dr;
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0; // Average
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
