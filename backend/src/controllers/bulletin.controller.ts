import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import pptxgen from 'pptxgenjs';
import fs from 'fs';
import path from 'path';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

export const generateBulletin = async (req: Request, res: Response) => {
  try {
    const { serialNumbers, targetMonth, targetYear, customNotes } = req.body;

    if (!Array.isArray(serialNumbers)) {
      return res.status(400).json({ error: 'serialNumbers must be an array of strings' });
    }

    // Determine target month/year (default: previous month)
    const now = new Date();
    const prevMonth = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
    const prevYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    
    const tMonth = targetMonth !== undefined ? targetMonth : prevMonth; // 0-indexed
    const tYear = targetYear !== undefined ? targetYear : prevYear;

    // Calculate date ranges based on target month
    const monthStart = new Date(tYear, tMonth, 1);
    const monthEnd = new Date(tYear, tMonth + 1, 0, 23, 59, 59); // Last day of target month
    
    // Capacity charts: 6 months ending at the target month
    const sixMonthsBefore = new Date(tYear, tMonth - 5, 1); // 6 months back from target

    const targetMonthName = MONTHS_TR[tMonth];

    const allStorageDevices = await prisma.inventoryItem.findMany({
      where: { model: { device_type: { in: ['storage'] } } },
      include: { rack: { include: { room: { include: { datacenter: true } } } } }
    });

    const xormonLocationMap: Record<string, string> = {};
    const serialToXormonMap: Record<string, string> = {};
    const xormonToNameMap: Record<string, string> = {};

    allStorageDevices.forEach((d: any) => {
      const dcName = (d.rack?.room?.datacenter?.name || '').toLowerCase();
      const metadata = d.metadata as any;
      const xormonId = metadata?.xormon_id || '';

      let location = 'Bilinmeyen';
      if (dcName.includes('avm') || dcName.includes('ankara')) location = 'Ankara';
      else if (dcName.includes('varyap') || dcName.includes('istanbul')) location = 'Istanbul';

      if (xormonId) {
        xormonLocationMap[xormonId] = location;
        xormonToNameMap[xormonId] = d.hostname || d.serial_number;
      }
      xormonLocationMap[d.serial_number] = location;
      xormonToNameMap[d.serial_number] = d.hostname || d.serial_number;
      if (xormonId) serialToXormonMap[d.serial_number] = xormonId;
    });

    const selectedObjectIds = serialNumbers.map(sn => serialToXormonMap[sn] || sn);

    // Fetch capacity metrics (6 months ending at target month)
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: { metric_name: 'capacity_used_percent', captured_at: { gte: sixMonthsBefore, lte: monthEnd } },
      orderBy: { captured_at: 'asc' }
    });

    const selectedCapacityMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: { object_id: { in: selectedObjectIds }, metric_name: 'capacity_used_percent', captured_at: { gte: sixMonthsBefore, lte: monthEnd } },
      orderBy: { captured_at: 'asc' }
    });

    // Fetch IOPS & Response Time metrics (target month only)
    const selectedPerfMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: { 
        object_id: { in: selectedObjectIds }, 
        metric_name: { in: ['iops', 'io_total', 'response_time', 'latency'] },
        captured_at: { gte: monthStart, lte: monthEnd } 
      },
      orderBy: { captured_at: 'asc' }
    });

    // Process data
    const generalCapacity = getLatestCapacityPerDevice(allStorageMetrics, xormonLocationMap);
    
    const deviceCapacities = processIndividualDeviceMetrics(
      selectedCapacityMetrics
    );
    const deviceIops = processIndividualDeviceMetrics(
      selectedPerfMetrics.filter(m => m.metric_name.includes('iops') || m.metric_name.includes('io_total'))
    );
    const deviceResponseTime = processIndividualDeviceMetrics(
      selectedPerfMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency'))
    );

    // Group selected devices by location
    const { ankaraDevices, istanbulDevices } = groupDevicesByLocation(selectedObjectIds, xormonLocationMap);

    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

    // --- ROBUST LOGO DETECTION ---
    let foundLogoPath: string | undefined = undefined;
    const possiblePaths = [
      path.join(process.cwd(), 'assets/logo.png'),
      path.join(process.cwd(), 'assets/logo.jpg'),
      path.join(process.cwd(), 'assets/logo.jpeg'),
      path.join(process.cwd(), 'backend/assets/logo.png'),
      path.join(process.cwd(), 'logo.png'),
      path.join(__dirname, '../../assets/logo.png'),
      path.join(__dirname, '../../../assets/logo.png')
    ];

    for (const p of possiblePaths) {
      if (fs.existsSync(p)) {
        foundLogoPath = p;
        break;
      }
    }

    const hasLogo = !!foundLogoPath;

    // === SLIDE 0: Kapak Slaytı (Cover Slide) ===
    const coverSlide = pres.addSlide();
    coverSlide.background = { color: 'FFFFFF' };
    
    // Header bar
    coverSlide.addShape(pres.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 1.5,
      fill: { color: '1a5276' }
    });

    coverSlide.addText('BT Storage Yönetimi', {
      x: 0.5, y: 0.2, w: 10, h: 0.6,
      fontSize: 32, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI'
    });

    coverSlide.addText('BT Açık Sistemler Depolama ve Yedekleme Sistemleri Yönetimi', {
      x: 0.5, y: 0.8, w: 10, h: 0.5,
      fontSize: 16, color: 'B0C4DE', fontFace: 'Segoe UI'
    });

    if (hasLogo && foundLogoPath) {
      coverSlide.addImage({ path: foundLogoPath, x: 10.8, y: 0.2, w: 2, h: 1.0 });
    }

    // Main title area
    coverSlide.addText(`Storage ${targetMonthName} Ayı Bülteni`, {
      x: '10%', y: '35%', w: '80%', h: 1.5,
      fontSize: 44, bold: true, color: '1a5276', align: 'center', fontFace: 'Segoe UI'
    });

    coverSlide.addText(`${tYear} Yılı Altyapı Kapasite ve Performans Raporu`, {
      x: '10%', y: '55%', w: '80%', h: 1,
      fontSize: 22, color: '666666', align: 'center', fontFace: 'Segoe UI'
    });

    // === CHART SLIDES ===
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - Ankara (Prod)', generalCapacity.ankara, foundLogoPath);
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - İstanbul (DR)', generalCapacity.istanbul, foundLogoPath);

    generateSideBySideSlides(pres, ankaraDevices, deviceCapacities, 'capacity', 'Kapasite Kullanımı - Ankara (Prod)', foundLogoPath);
    generateSideBySideSlides(pres, ankaraDevices, deviceCapacities, 'capacity_trend', 'Kapasite Trendi - Ankara (Prod)', foundLogoPath);
    generateSideBySideSlides(pres, ankaraDevices, deviceIops, 'iops', 'IOPS - Ankara (Prod)', foundLogoPath);
    generateSideBySideSlides(pres, ankaraDevices, deviceResponseTime, 'responsetime', 'Response Time / Gecikme - Ankara (Prod)', foundLogoPath);

    generateSideBySideSlides(pres, istanbulDevices, deviceCapacities, 'capacity', 'Kapasite Kullanımı - İstanbul (DR)', foundLogoPath);
    generateSideBySideSlides(pres, istanbulDevices, deviceCapacities, 'capacity_trend', 'Kapasite Trendi - İstanbul (DR)', foundLogoPath);
    generateSideBySideSlides(pres, istanbulDevices, deviceIops, 'iops', 'IOPS - İstanbul (DR)', foundLogoPath);
    generateSideBySideSlides(pres, istanbulDevices, deviceResponseTime, 'responsetime', 'Response Time / Gecikme - İstanbul (DR)', foundLogoPath);

    // === LAST SLIDE: Değerlendirme (Evaluation) ===
    const evalSlide = pres.addSlide();
    evalSlide.background = { color: 'FFFFFF' };

    // Header bar (same as cover)
    evalSlide.addShape(pres.ShapeType.rect, {
      x: 0, y: 0, w: '100%', h: 1.2,
      fill: { color: '1a5276' }
    });

    evalSlide.addText('BT Storage Yönetimi', {
      x: 0.5, y: 0.15, w: 10, h: 0.4,
      fontSize: 24, bold: true, color: 'FFFFFF', fontFace: 'Segoe UI'
    });

    evalSlide.addText('BT Açık Sistemler Depolama ve Yedekleme Sistemleri Yönetimi', {
      x: 0.5, y: 0.55, w: 10, h: 0.4,
      fontSize: 13, color: 'B0C4DE', fontFace: 'Segoe UI'
    });

    if (hasLogo && foundLogoPath) {
      evalSlide.addImage({ path: foundLogoPath, x: 10.8, y: 0.15, w: 1.8, h: 0.9 });
    }

    // Section title
    evalSlide.addText(`Değerlendirme (Disk - SAN) – ${targetMonthName} -${tYear}`, {
      x: 1, y: 1.5, w: 11, h: 0.6,
      fontSize: 18, bold: true, color: '1a5276', fontFace: 'Segoe UI'
    });

    // Build bullet points
    const bulletPoints: Array<{ text: string; options: any }> = [];

    // 1. Manual notes first
    const notes = Array.isArray(customNotes) ? customNotes : [];
    for (const note of notes) {
      if (typeof note === 'string' && note.trim()) {
        bulletPoints.push({ text: note.trim(), options: { bullet: true, fontSize: 13, color: '333333', fontFace: 'Segoe UI', paraSpaceAfter: 10 } });
      }
    }

    // 2. Auto-generated IOPS/Response Time summaries per device
    for (const objId of selectedObjectIds) {
      const deviceName = xormonToNameMap[objId] || objId;
      const iopsData = deviceIops[objId];
      const rtData = deviceResponseTime[objId];

      if (iopsData || rtData) {
        const avgIops = iopsData?.values?.length 
          ? Math.round(iopsData.values.reduce((a: number, b: number) => a + b, 0) / iopsData.values.length) 
          : null;
        const avgRt = rtData?.values?.length 
          ? (rtData.values.reduce((a: number, b: number) => a + b, 0) / rtData.values.length).toFixed(1) 
          : null;

        let text = `${deviceName} disklerinde`;
        if (avgRt !== null) {
          text += ` cevap süreleri ${avgRt} ms seyretmektedir.`;
        }
        if (avgIops !== null) {
          text += `  Disk I/O rate ay ortalamasında ${avgIops} IOPS civarındadır.`;
        }

        if (avgIops !== null || avgRt !== null) {
          bulletPoints.push({ text, options: { bullet: true, fontSize: 13, color: '333333', fontFace: 'Segoe UI', paraSpaceAfter: 10 } });
        }
      }
    }

    if (bulletPoints.length > 0) {
      evalSlide.addText(bulletPoints, {
        x: 1.2, y: 2.3, w: 10.5, h: 4.5,
        valign: 'top'
      });
    } else {
      evalSlide.addText('Bu dönem için değerlendirme verisi bulunamadı.', {
        x: 1.2, y: 3, w: 10.5, fontSize: 14, color: '999999', fontFace: 'Segoe UI'
      });
    }

    const buffer = await pres.stream() as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', `attachment; filename="bulten-${targetMonthName}-${tYear}.pptx"`);
    res.send(buffer);

  } catch (error) {
    console.error('[Bulletin Controller Error]', error);
    res.status(500).json({ error: 'Bülten oluşturulurken bir hata oluştu.' });
  }
};

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
    return [{ name: '% Kullanım (Used %)', labels, values }];
  };

  return {
    ankara: mapToChartData(ankaraLatest),
    istanbul: mapToChartData(istanbulLatest)
  };
}

function processIndividualDeviceMetrics(metrics: any[]) {
  const deviceData: Record<string, { name: string, dataMap: Record<string, number> }> = {};

  metrics.forEach(m => {
    const d = new Date(m.captured_at);
    const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const value = parseFloat(m.metric_value) || 0;

    if (!deviceData[m.object_id]) {
      deviceData[m.object_id] = { name: m.object_name || m.object_id, dataMap: {} };
    }
    deviceData[m.object_id].dataMap[dayKey] = value;
  });

  const result: Record<string, { labels: string[], values: number[], name: string }> = {};

  Object.keys(deviceData).forEach(deviceId => {
    const labels = Object.keys(deviceData[deviceId].dataMap).sort();
    const values = labels.map(l => deviceData[deviceId].dataMap[l]);
    result[deviceId] = {
      name: deviceData[deviceId].name,
      labels,
      values
    };
  });

  return result;
}

function groupDevicesByLocation(objectIds: string[], locationMap: Record<string, string>) {
  const ankaraDevices: string[] = [];
  const istanbulDevices: string[] = [];

  objectIds.forEach(id => {
    const loc = (locationMap[id] || '').toLowerCase();
    if (loc.includes('ankara')) ankaraDevices.push(id);
    else if (loc.includes('istanbul')) istanbulDevices.push(id);
  });

  return { ankaraDevices, istanbulDevices };
}

function generateSideBySideSlides(
  pres: pptxgen, 
  devices: string[], 
  deviceDataMap: Record<string, { labels: string[], values: number[], name: string }>, 
  metricType: 'capacity' | 'capacity_trend' | 'iops' | 'responsetime',
  slideTitle: string,
  logoPath?: string
) {
  if (devices.length === 0) {
    const slide = pres.addSlide();
    if (logoPath) slide.addImage({ path: logoPath, x: 11.5, y: 0.15, w: 1.5, h: 0.75 });
    slide.addText(slideTitle, { x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1a1a2e', fontFace: 'Segoe UI' });
    slide.addText('Bu lokasyon için yeterli cihaz bulunamadı.', { x: 0.5, y: 3, w: '90%', fontSize: 16, color: '999999', fontFace: 'Segoe UI' });
    return;
  }

  // Process 2 devices per slide
  for (let i = 0; i < devices.length; i += 2) {
    const dev1Id = devices[i];
    const dev2Id = devices[i+1];

    const data1 = deviceDataMap[dev1Id];
    const data2 = dev2Id ? deviceDataMap[dev2Id] : null;

    const slide = pres.addSlide();
    if (logoPath) slide.addImage({ path: logoPath, x: 11.5, y: 0.15, w: 1.5, h: 0.75 });
    slide.addText(slideTitle, { x: 0.5, y: 0.3, w: '90%', fontSize: 22, bold: true, color: '1a1a2e', fontFace: 'Segoe UI' });

    if (!data1 && !data2) {
      slide.addText('Bu lokasyon ve metrik için yeterli veri bulunamadı.', { x: 0.5, y: 3, w: '90%', fontSize: 16, color: '999999', fontFace: 'Segoe UI' });
      continue;
    }

    if (data1) {
      addDeviceChart(pres, slide, data1, metricType, 0.5);
    }
    if (data2) {
      addDeviceChart(pres, slide, data2, metricType, 6.8);
    }
  }
}

function addDeviceChart(
  pres: pptxgen, 
  slide: pptxgen.Slide, 
  data: { labels: string[], values: number[], name: string }, 
  metricType: 'capacity' | 'capacity_trend' | 'iops' | 'responsetime', 
  xPos: number
) {
  if (!data.labels || data.labels.length === 0) {
    slide.addText(`Veri bulunamadı: ${data.name}`, { x: xPos, y: 3, w: 6, fontSize: 14, color: '999999' });
    return;
  }

  let title = '';
  let chartData: any[] = [];
  let yAxisFormat = 'General';
  let yAxisMax: number | undefined = undefined;

  let chartColors = ['5b9bd5', 'ed7d31', 'a5a5a5']; // Default colors

  if (metricType === 'capacity' || metricType === 'capacity_trend') {
    title = data.name;
    yAxisFormat = '0"%"';
    yAxisMax = 100;
    
    // 3 lines: Used %, Capacity % (100), Critical Capacity % (80)
    const capacityLine = data.labels.map(() => 100);
    const criticalLine = data.labels.map(() => 80);

    chartData = [
      { name: 'Used Capacity (%)', labels: data.labels, values: data.values },
      { name: 'Capacity (%)', labels: data.labels, values: capacityLine },
      { name: 'Critical Capacity (%)', labels: data.labels, values: criticalLine }
    ];

    if (metricType === 'capacity_trend') {
      // Calculate linear regression trendline
      const n = data.values.length;
      let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
      for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += data.values[i];
        sumXY += i * data.values[i];
        sumXX += i * i;
      }
      const m = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const b = (sumY - m * sumX) / n;
      const trendlineValues = data.values.map((_, i) => m * i + b);

      // Add trendline as 4th series with dark red color
      chartData.push({ name: 'Linear (Used Capacity (%))', labels: data.labels, values: trendlineValues });
      chartColors = ['5b9bd5', 'ed7d31', 'a5a5a5', 'C00000'];
    }

  } else if (metricType === 'iops') {
    title = `${data.name}\nTotal I/O Rate - overall (ops/s)`;
    chartData = [
      { name: 'IOPS', labels: data.labels, values: data.values }
    ];
  } else if (metricType === 'responsetime') {
    title = `${data.name}\nOverall Response Time (ms/op)`;
    chartData = [
      { name: 'Response Time (ms)', labels: data.labels, values: data.values }
    ];
  }

  // Thin out x-axis labels to prevent overlap (show every Nth label)
  const totalPoints = data.labels.length;
  const labelFreq = totalPoints > 60 ? 14 : totalPoints > 30 ? 7 : totalPoints > 14 ? 3 : 1;

  // Chart title
  slide.addText(title, {
    x: xPos, y: 0.5, w: 6, h: 0.6, fontSize: 14, align: 'center', color: '333333'
  });

  // Main chart (includes trendline as 4th series if applicable)
  slide.addChart(pres.ChartType.line, chartData, {
    x: xPos, y: 1.2, w: 6, h: 4.5,
    showLegend: true,
    legendPos: 'b',
    legendFontSize: 7,
    lineSmooth: false,
    showValue: false,
    catAxisLabelFontSize: 7,
    catAxisLabelFreq: labelFreq,
    catAxisOrientation: 'minMax',
    valAxisLabelFontSize: 9,
    valAxisMaxVal: yAxisMax,
    valAxisLabelFormatCode: yAxisFormat,
    lineDataSymbol: 'none',
    chartColors: chartColors
  } as any);
}

function addBarChartSlide(pres: pptxgen, title: string, chartData: any[], logoPath?: string) {
  const slide = pres.addSlide();
  if (logoPath) slide.addImage({ path: logoPath, x: 11.5, y: 0.15, w: 1.5, h: 0.75 });
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
    dataLabelFormatCode: '0"%"', 
    valAxisLabelFormatCode: '0"%"',
    valAxisMaxVal: 100,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 9,
    dataLabelFontSize: 9,
    chartColors: ['5b9bd5'] // Light blue matching screenshot
  });
}
