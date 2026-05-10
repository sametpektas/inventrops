import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import ExcelJS from 'exceljs';

export const generateKpiExcel = async (req: Request, res: Response) => {
  try {
    // 1. Get Devices (All Storage and SAN Switches)
    const devices = await prisma.inventoryItem.findMany({
      where: { 
        model: {
          device_type: { in: ['storage', 'san_switch'] }
        }
      },
      include: {
        model: true,
        rack: { include: { room: { include: { datacenter: true } } } }
      }
    });

    const serialToXormonMap: Record<string, string> = {};
    devices.forEach((d: any) => {
      const metadata = d.metadata as any;
      const xormonId = metadata?.xormon_id || '';
      if (xormonId) serialToXormonMap[d.serial_number] = xormonId;
    });

    const selectedObjectIds = devices.map(d => serialToXormonMap[d.serial_number] || d.serial_number);

    // 2. We need to query capacity over the last N months.
    // For this, we check the ForecastMetricSnapshot for the selected devices.
    // We group by month (e.g., "2026-01", "2026-02").
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const snapshots = await prisma.forecastMetricSnapshot.findMany({
      where: {
        object_id: { in: selectedObjectIds },
        metric_name: 'capacity_used_percent',
        captured_at: { gte: sixMonthsAgo }
      },
      orderBy: { captured_at: 'asc' }
    });

    // Generate Month keys: e.g. "Ocak", "Şubat", etc.
    const monthsTr = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
    
    // Group snapshots by Device and Month
    const monthlyData: Record<string, Record<string, number>> = {};
    const monthsEncountered = new Set<string>();

    snapshots.forEach(s => {
      const d = new Date(s.captured_at);
      const monthKey = `${monthsTr[d.getMonth()]} ${d.getFullYear()}`;
      monthsEncountered.add(monthKey);
      
      const val = parseFloat(s.metric_value as any) || 0;

      if (!monthlyData[s.object_id]) {
        monthlyData[s.object_id] = {};
      }
      
      // Keep the latest value for the month (overwrite as we iterate asc)
      monthlyData[s.object_id][monthKey] = val;
    });

    const monthColumns = Array.from(monthsEncountered);

    // If we want to persist them in MonthlyCapacityKPI for history
    // (This is a simplified approach: we snapshot whatever we found to the new table)
    // In a real scheduled job, this would run on the 1st of every month.
    for (const objId of Object.keys(monthlyData)) {
      for (const mKey of monthColumns) {
        // Parse monthKey to a date representing the 1st of that month
        const [mName, yStr] = mKey.split(' ');
        const mIdx = monthsTr.indexOf(mName);
        const reportDate = new Date(parseInt(yStr), mIdx, 1);

        const val = monthlyData[objId][mKey];

        // Upsert the KPI record to ensure persistence
        try {
          await prisma.monthlyCapacityKPI.upsert({
            where: {
              object_id_report_month: {
                object_id: objId,
                report_month: reportDate
              }
            },
            update: { capacity_percent: val },
            create: {
              object_id: objId,
              object_name: objId,
              report_month: reportDate,
              capacity_percent: val
            }
          });
        } catch (dbErr: any) {
          console.warn(`[KPI Controller] Prisma DB hatası (Şema güncellenmemiş olabilir): ${dbErr.message}`);
          // Hata olsa da Excel oluşturmaya devam et (Geçici)
        }
      }
    }

    // 3. Create Excel
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Kapasite KPI Raporu');

    // Define Columns
    const columns = [
      { header: 'Cihaz Adı', key: 'name', width: 25 },
      { header: 'Seri Numarası', key: 'serial', width: 25 },
      { header: 'Lokasyon', key: 'location', width: 25 },
    ];

    // Add dynamic month columns
    monthColumns.forEach(m => {
      columns.push({ header: `${m} Kullanım (%)`, key: m, width: 20 });
    });

    worksheet.columns = columns;

    // Add Data
    devices.forEach(d => {
      const xormonId = serialToXormonMap[d.serial_number] || d.serial_number;
      const dcName = d.rack?.room?.datacenter?.name || 'Bilinmiyor';
      
      const rowData: any = {
        name: d.hostname || d.serial_number,
        serial: d.serial_number,
        location: dcName,
      };

      monthColumns.forEach(m => {
        const val = monthlyData[xormonId]?.[m];
        rowData[m] = val !== undefined ? `${val.toFixed(2)}%` : '-';
      });

      worksheet.addRow(rowData);
    });

    // Formatting Header
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF1F4E78' } // Dark blue
    };
    worksheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };

    // Send File
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventrops-aylik-kpi.xlsx"');

    await workbook.xlsx.write(res);
    res.end();

  } catch (error) {
    console.error('[KPI Controller Error]', error);
    res.status(500).json({ error: 'Excel raporu oluşturulurken hata oluştu.' });
  }
};
