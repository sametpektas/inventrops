import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import pptxgen from 'pptxgenjs';

export const generateBulletin = async (req: Request, res: Response) => {
  try {
    const { serialNumbers } = req.body;

    if (!Array.isArray(serialNumbers)) {
      return res.status(400).json({ error: 'serialNumbers must be an array of strings' });
    }

    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    // Fetch ALL storage devices to build location map
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

      if (xormonId) xormonLocationMap[xormonId] = location;
      xormonLocationMap[d.serial_number] = location;
      
      if (xormonId) serialToXormonMap[d.serial_number] = xormonId;
    });

    const selectedObjectIds = serialNumbers.map(sn => serialToXormonMap[sn] || sn);

    // 1. Fetch all capacity metrics for the general Bar chart
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        metric_name: { contains: 'capacity' },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    // 2. Fetch selected devices metrics
    const selectedMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: {
        object_id: { in: selectedObjectIds },
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    // Process data
    const generalCapacity = getLatestCapacityPerDevice(allStorageMetrics, xormonLocationMap);
    
    const selectedCapacity = processMetricsPerDevice(
      selectedMetrics.filter(m => m.metric_name.includes('capacity')), xormonLocationMap
    );
    const selectedIops = processMetricsPerDevice(
      selectedMetrics.filter(m => m.metric_name.includes('iops') || m.metric_name.includes('io_total')), xormonLocationMap
    );
    const selectedResponseTime = processMetricsPerDevice(
      selectedMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency')), xormonLocationMap
    );

    // Generate PPTX
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

    // === SLIDE 1 & 2: Genel Kapasite (Bar Chart) ===
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - Ankara (Prod)', generalCapacity.ankara);
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - İstanbul (DR)', generalCapacity.istanbul);

    // === SLIDE 3 & 4: Seçili Cihazlar Kapasite (Line Chart) ===
    addLineChartSlide(pres, 'Kapasite Kullanımı Trendi - Ankara (Prod)', selectedCapacity.ankara);
    addLineChartSlide(pres, 'Kapasite Kullanımı Trendi - İstanbul (DR)', selectedCapacity.istanbul);

    // === SLIDE 5 & 6: IOPS (Line Chart) ===
    addLineChartSlide(pres, 'IOPS Trendi - Ankara (Prod)', selectedIops.ankara);
    addLineChartSlide(pres, 'IOPS Trendi - İstanbul (DR)', selectedIops.istanbul);

    // === SLIDE 7 & 8: Response Time (Line Chart) ===
    addLineChartSlide(pres, 'Response Time / Gecikme - Ankara (Prod)', selectedResponseTime.ankara);
    addLineChartSlide(pres, 'Response Time / Gecikme - İstanbul (DR)', selectedResponseTime.istanbul);

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
 * For General Capacity: Gets the latest capacity metric for each individual device
 * Returns data suitable for a Bar Chart
 */
function getLatestCapacityPerDevice(metrics: any[], locationMap: Record<string, string>) {
  const ankaraLatest: Record<string, { label: string, val: number, time: number }> = {};
  const istanbulLatest: Record<string, { label: string, val: number, time: number }> = {};

  metrics.forEach(m => {
    const loc = (locationMap[m.object_id] || '').toLowerCase();
    const time = new Date(m.captured_at).getTime();
    const val = parseFloat(m.metric_value) || 0;
    const labelName = m.object_name || m.object_id;

    if (loc.includes('ankara')) {
      if (!ankaraLatest[m.object_id] || ankaraLatest[m.object_id].time < time) {
        ankaraLatest[m.object_id] = { label: labelName, val, time };
      }
    } else if (loc.includes('istanbul')) {
      if (!istanbulLatest[m.object_id] || istanbulLatest[m.object_id].time < time) {
        istanbulLatest[m.object_id] = { label: labelName, val, time };
      }
    }
  });

  const mapToChartData = (latestMap: Record<string, any>) => {
    const labels: string[] = [];
    const values: number[] = [];
    Object.values(latestMap).forEach(item => {
      labels.push(item.label);
      values.push(item.val);
    });
    return [{ name: 'Kapasite', labels, values }];
  };

  return {
    ankara: mapToChartData(ankaraLatest),
    istanbul: mapToChartData(istanbulLatest)
  };
}

/**
 * For Selected Devices: Groups metrics by day but keeps each device as a separate series
 * Returns an array of objects { name, labels, values } for Line Chart
 */
function processMetricsPerDevice(metrics: any[], locationMap: Record<string, string>) {
  const ankaraSeries: Record<string, Record<string, number>> = {};
  const istanbulSeries: Record<string, Record<string, number>> = {};
  
  const ankaraLabels = new Set<string>();
  const istanbulLabels = new Set<string>();
  const deviceNames: Record<string, string> = {};

  metrics.forEach(m => {
    const loc = (locationMap[m.object_id] || '').toLowerCase();
    const d = new Date(m.captured_at);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const value = parseFloat(m.metric_value) || 0;
    
    deviceNames[m.object_id] = m.object_name || m.object_id;

    if (loc.includes('ankara')) {
      ankaraLabels.add(dayKey);
      if (!ankaraSeries[m.object_id]) ankaraSeries[m.object_id] = {};
      ankaraSeries[m.object_id][dayKey] = value;
    } else if (loc.includes('istanbul')) {
      istanbulLabels.add(dayKey);
      if (!istanbulSeries[m.object_id]) istanbulSeries[m.object_id] = {};
      istanbulSeries[m.object_id][dayKey] = value;
    }
  });

  const buildChartData = (seriesMap: Record<string, Record<string, number>>, labelsSet: Set<string>) => {
    const labels = Array.from(labelsSet).sort();
    const chartData: any[] = [];
    
    Object.keys(seriesMap).forEach(deviceId => {
      // If a day is missing for a device, use the last known value or 0
      let lastVal = 0;
      const values = labels.map(l => {
        if (seriesMap[deviceId][l] !== undefined) {
          lastVal = seriesMap[deviceId][l];
        }
        return lastVal;
      });
      
      chartData.push({
        name: deviceNames[deviceId],
        labels,
        values
      });
    });
    
    return chartData;
  };

  return {
    ankara: buildChartData(ankaraSeries, ankaraLabels),
    istanbul: buildChartData(istanbulSeries, istanbulLabels)
  };
}

function addBarChartSlide(pres: pptxgen, title: string, chartData: any[]) {
  const slide = pres.addSlide();
  slide.addText(title, {
    x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1a1a2e', fontFace: 'Segoe UI'
  });

  if (!chartData || chartData.length === 0 || chartData[0].labels.length === 0) {
    slide.addText('Bu lokasyon için yeterli veri bulunamadı.', {
      x: 0.5, y: 3, w: '90%', fontSize: 16, color: '999999', fontFace: 'Segoe UI'
    });
    return;
  }

  slide.addChart(pres.ChartType.bar, chartData, {
    x: 0.5, y: 1.2, w: 12, h: 5.5,
    showLegend: false,
    barDir: 'col',
    showValue: true,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 9,
    dataLabelFontSize: 8,
    chartColors: ['457b9d']
  });
}

function addLineChartSlide(pres: pptxgen, title: string, chartData: any[]) {
  const slide = pres.addSlide();
  slide.addText(title, {
    x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1a1a2e', fontFace: 'Segoe UI'
  });

  if (!chartData || chartData.length === 0 || chartData[0].labels.length === 0) {
    slide.addText('Bu lokasyon için yeterli veri bulunamadı.', {
      x: 0.5, y: 3, w: '90%', fontSize: 16, color: '999999', fontFace: 'Segoe UI'
    });
    return;
  }

  slide.addChart(pres.ChartType.line, chartData, {
    x: 0.5, y: 1.2, w: 12, h: 5.5,
    showLegend: true,
    legendPos: 'b',
    lineSmooth: true,
    showValue: false,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 9,
    lineDataSymbol: 'circle',
    lineDataSymbolSize: 4
  });
}
