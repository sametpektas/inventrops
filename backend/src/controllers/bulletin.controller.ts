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

    // Fetch ALL storage devices to build location map
    // Key: xormon_id (object_id in forecast table) -> Value: location label
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

    // Build TWO maps:
    // 1. xormonId -> location (for forecastMetricSnapshot matching)
    // 2. serialNumber -> xormonId (for selected device matching)
    const xormonLocationMap: Record<string, string> = {};
    const serialToXormonMap: Record<string, string> = {};

    allStorageDevices.forEach((d: any) => {
      const dcName = (d.rack?.room?.datacenter?.name || '').toLowerCase();
      const metadata = d.metadata as any;
      const xormonId = metadata?.xormon_id || '';

      let location = 'Bilinmeyen';
      if (dcName.includes('avm') || dcName.includes('ankara')) {
        location = 'Ankara';
      } else if (dcName.includes('varyap') || dcName.includes('istanbul')) {
        location = 'Istanbul';
      }

      // Map by xormon_id (this is what forecastMetricSnapshot.object_id stores)
      if (xormonId) {
        xormonLocationMap[xormonId] = location;
      }
      // Also map by serial_number for fallback
      xormonLocationMap[d.serial_number] = location;
      
      // Map serial -> xormon_id so we can query forecast table
      if (xormonId) {
        serialToXormonMap[d.serial_number] = xormonId;
      }
    });

    console.log('[Bulletin] Location map entries:', Object.keys(xormonLocationMap).length);
    console.log('[Bulletin] Serial->Xormon map:', JSON.stringify(serialToXormonMap));

    // Convert selected serial numbers to xormon object_ids for querying
    const selectedObjectIds = serialNumbers.map(sn => serialToXormonMap[sn] || sn);
    console.log('[Bulletin] Selected serials:', serialNumbers);
    console.log('[Bulletin] Mapped object_ids:', selectedObjectIds);

    // Fetch all storage metrics for the general capacity slide
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        metric_name: { contains: 'capacity' },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    console.log('[Bulletin] Total storage metrics found:', allStorageMetrics.length);

    // Fetch selected devices metrics (using xormon object_ids)
    const selectedMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        object_id: { in: selectedObjectIds },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    console.log('[Bulletin] Selected device metrics found:', selectedMetrics.length);

    // Group metrics by location
    const generalCapacity = processMetricsByLocation(allStorageMetrics, xormonLocationMap);
    const selectedCapacity = processMetricsByLocation(
      selectedMetrics.filter(m => m.metric_name.includes('capacity')), xormonLocationMap
    );
    const selectedIops = processMetricsByLocation(
      selectedMetrics.filter(m => m.metric_name.includes('iops')), xormonLocationMap
    );
    const selectedResponseTime = processMetricsByLocation(
      selectedMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency')), xormonLocationMap
    );

    // Generate PPTX
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

    // === SLIDE 1: Genel Kapasite - Ankara (Prod) ===
    addChartSlide(pres, 'Genel Depolama Kapasite - Ankara (Prod)', generalCapacity.ankara);

    // === SLIDE 2: Genel Kapasite - Istanbul (DR) ===
    addChartSlide(pres, 'Genel Depolama Kapasite - İstanbul (DR)', generalCapacity.istanbul);

    // === SLIDE 3: Seçili Cihazlar Kapasite - Ankara ===
    addChartSlide(pres, 'Kapasite Kullanımı - Ankara (Prod)', selectedCapacity.ankara);

    // === SLIDE 4: Seçili Cihazlar Kapasite - Istanbul ===
    addChartSlide(pres, 'Kapasite Kullanımı - İstanbul (DR)', selectedCapacity.istanbul);

    // === SLIDE 5: IOPS - Ankara ===
    addChartSlide(pres, 'IOPS - Ankara (Prod)', selectedIops.ankara);

    // === SLIDE 6: IOPS - Istanbul ===
    addChartSlide(pres, 'IOPS - İstanbul (DR)', selectedIops.istanbul);

    // === SLIDE 7: Response Time - Ankara ===
    addChartSlide(pres, 'Response Time - Ankara (Prod)', selectedResponseTime.ankara);

    // === SLIDE 8: Response Time - Istanbul ===
    addChartSlide(pres, 'Response Time - İstanbul (DR)', selectedResponseTime.istanbul);

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
 * Process metrics and return separate Ankara/Istanbul daily data
 */
function processMetricsByLocation(metrics: any[], locationMap: Record<string, string>) {
  const ankaraMap: Record<string, number[]> = {};
  const istanbulMap: Record<string, number[]> = {};

  metrics.forEach(m => {
    const d = new Date(m.captured_at);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const value = parseFloat(m.metric_value) || 0;

    const loc = (locationMap[m.object_id] || '').toLowerCase();

    if (loc.includes('ankara')) {
      if (!ankaraMap[dayKey]) ankaraMap[dayKey] = [];
      ankaraMap[dayKey].push(value);
    } else if (loc.includes('istanbul')) {
      if (!istanbulMap[dayKey]) istanbulMap[dayKey] = [];
      istanbulMap[dayKey].push(value);
    }
  });

  return {
    ankara: buildDailyAverage(ankaraMap),
    istanbul: buildDailyAverage(istanbulMap)
  };
}

function buildDailyAverage(dayMap: Record<string, number[]>) {
  const labels = Object.keys(dayMap).sort();
  const values = labels.map(l => {
    const arr = dayMap[l];
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  });
  return { labels, values };
}

function addChartSlide(pres: pptxgen, title: string, data: { labels: string[], values: number[] }) {
  const slide = pres.addSlide();
  slide.addText(title, {
    x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1a1a2e',
    fontFace: 'Segoe UI'
  });

  if (!data.labels || data.labels.length === 0) {
    slide.addText('Bu lokasyon için yeterli veri bulunamadı.', {
      x: 0.5, y: 3, w: '90%', fontSize: 16, color: '999999', fontFace: 'Segoe UI'
    });
    return;
  }

  const chartData = [
    {
      name: title.includes('Ankara') ? 'Ankara (Prod)' : 'İstanbul (DR)',
      labels: data.labels,
      values: data.values
    }
  ];

  slide.addChart(pres.ChartType.line, chartData, {
    x: 0.5,
    y: 1.2,
    w: 12,
    h: 5.5,
    showLegend: true,
    legendPos: 'b',
    lineSmooth: true,
    showValue: false,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 9,
    catAxisOrientation: 'minMax',
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 4,
    chartColors: [title.includes('Ankara') ? 'e63946' : '457b9d']
  });
}
