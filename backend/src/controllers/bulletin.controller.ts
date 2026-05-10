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

    const allStorageDevices = await prisma.inventoryItem.findMany({
      where: { model: { device_type: { in: ['storage'] } } },
      include: { rack: { include: { room: { include: { datacenter: true } } } } }
    });

    const xormonLocationMap: Record<string, string> = {};
    const serialToXormonMap: Record<string, string> = {};

    allStorageDevices.forEach((d: any) => {
      const dcName = (d.rack?.room?.datacenter?.name || '').toLowerCase();
      const metadata = d.metadata as any;
      const xormonId = metadata?.xormon_id || '';

      let location = 'Bilinmeyen';
      if (dcName.includes('avm') || dcName.includes('ankara')) location = 'Ankara';
      else if (dcName.includes('varyap') || dcName.includes('istanbul')) location = 'Istanbul';

      if (xormonId) xormonLocationMap[xormonId] = location;
      xormonLocationMap[d.serial_number] = location;
      if (xormonId) serialToXormonMap[d.serial_number] = xormonId;
    });

    const selectedObjectIds = serialNumbers.map(sn => serialToXormonMap[sn] || sn);

    // Fetch metrics
    const allStorageMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: { metric_name: 'capacity_used_percent', captured_at: { gte: sixMonthsAgo } },
      orderBy: { captured_at: 'asc' }
    });

    const selectedMetrics = await prisma.forecastMetricSnapshot.findMany({
      where: { object_id: { in: selectedObjectIds }, captured_at: { gte: sixMonthsAgo } },
      orderBy: { captured_at: 'asc' }
    });

    // Process data
    const generalCapacity = getLatestCapacityPerDevice(allStorageMetrics, xormonLocationMap);
    
    // Process selected devices into individual device data structures
    const deviceCapacities = processIndividualDeviceMetrics(
      selectedMetrics.filter(m => m.metric_name === 'capacity_used_percent')
    );
    const deviceIops = processIndividualDeviceMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('iops') || m.metric_name.includes('io_total'))
    );
    const deviceResponseTime = processIndividualDeviceMetrics(
      selectedMetrics.filter(m => m.metric_name.includes('response_time') || m.metric_name.includes('latency'))
    );

    // Group selected devices by location
    const { ankaraDevices, istanbulDevices } = groupDevicesByLocation(selectedObjectIds, xormonLocationMap);

    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 inches

    // === SLIDE 1 & 2: Genel Kapasite (Bar Chart) ===
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - Ankara (Prod)', generalCapacity.ankara);
    addBarChartSlide(pres, 'Genel Depolama Kapasite Kullanımı - İstanbul (DR)', generalCapacity.istanbul);

    // Generate Side-by-Side Slides for Ankara
    generateSideBySideSlides(pres, ankaraDevices, deviceCapacities, 'capacity');
    generateSideBySideSlides(pres, ankaraDevices, deviceIops, 'iops');
    generateSideBySideSlides(pres, ankaraDevices, deviceResponseTime, 'responsetime');

    // Generate Side-by-Side Slides for Istanbul
    generateSideBySideSlides(pres, istanbulDevices, deviceCapacities, 'capacity');
    generateSideBySideSlides(pres, istanbulDevices, deviceIops, 'iops');
    generateSideBySideSlides(pres, istanbulDevices, deviceResponseTime, 'responsetime');

    const buffer = await pres.stream() as Buffer;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
    res.setHeader('Content-Disposition', 'attachment; filename="inventrops-bulten.pptx"');
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
  metricType: 'capacity' | 'iops' | 'responsetime'
) {
  // Process 2 devices per slide
  for (let i = 0; i < devices.length; i += 2) {
    const dev1Id = devices[i];
    const dev2Id = devices[i+1];

    const data1 = deviceDataMap[dev1Id];
    const data2 = dev2Id ? deviceDataMap[dev2Id] : null;

    if (!data1 && !data2) continue;

    const slide = pres.addSlide();

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
  metricType: 'capacity' | 'iops' | 'responsetime', 
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

  if (metricType === 'capacity') {
    title = data.name; // User image shows just device name as title
    yAxisFormat = '0"%"';
    yAxisMax = 100;
    
    // Add 3 lines: Used %, Capacity % (100), Critical Capacity % (80)
    const capacityLine = data.labels.map(() => 100);
    const criticalLine = data.labels.map(() => 80);

    chartData = [
      { name: 'Used Capacity (%)', labels: data.labels, values: data.values },
      { name: 'Capacity (%)', labels: data.labels, values: capacityLine },
      { name: 'Critical Capacity (%)', labels: data.labels, values: criticalLine }
    ];
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

  // Draw chart title manually (looks closer to user's screenshots)
  slide.addText(title, {
    x: xPos, y: 0.5, w: 6, h: 0.6, fontSize: 14, align: 'center', color: '333333'
  });

  // Add the chart
  slide.addChart(pres.ChartType.line, chartData, {
    x: xPos, y: 1.2, w: 6, h: 4.5,
    showLegend: true,
    legendPos: 'b',
    lineSmooth: false, // User screenshots show jagged lines
    showValue: false,
    catAxisLabelFontSize: 8,
    valAxisLabelFontSize: 9,
    valAxisMaxVal: yAxisMax,
    valAxisLabelFormatCode: yAxisFormat,
    lineDataSymbol: 'none', // Remove circles to match screenshot
    chartColors: ['5b9bd5', 'ed7d31', 'a5a5a5'] // Blue, Orange, Grey matching screenshot
  });
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
    dataLabelFormatCode: '0"%"', 
    valAxisLabelFormatCode: '0"%"',
    valAxisMaxVal: 100,
    valAxisLabelFontSize: 9,
    catAxisLabelFontSize: 9,
    dataLabelFontSize: 9,
    chartColors: ['5b9bd5'] // Light blue matching screenshot
  });
}
