import { Request, Response } from 'express';
import { prisma } from '../lib/prisma';
import ExcelJS from 'exceljs';

const MONTHS_TR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];

// Header fill styles
const HEADER_GOLD: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC8A200' } };
const HEADER_BLUE: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E78' } };
const HEADER_FONT_WHITE: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FFFFFFFF' }, name: 'Calibri', size: 11 };
const HEADER_FONT_BLACK: Partial<ExcelJS.Font> = { bold: true, color: { argb: 'FF000000' }, name: 'Calibri', size: 11 };
const CENTER: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'center' };
const LEFT: Partial<ExcelJS.Alignment> = { vertical: 'middle', horizontal: 'left' };
const BORDER_THIN: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' }, bottom: { style: 'thin' },
  left: { style: 'thin' }, right: { style: 'thin' }
};

interface MonthlyStorageData {
  capacity_total_gib: number | null;
  capacity_used_gib: number | null;
  capacity_free_gib: number | null;
  capacity_used_percent: number | null;
}

interface MonthlySanData {
  available_ports: number | null;
  free_ports: number | null;
  used_ports: number | null;
}

export const generateKpiExcel = async (req: Request, res: Response) => {
  try {
    // Parse target month/year (default: current month)
    const { targetMonth, targetYear } = req.body || {};
    const now = new Date();
    const tMonth = targetMonth !== undefined ? targetMonth : now.getMonth(); // 0-indexed
    const tYear = targetYear !== undefined ? targetYear : now.getFullYear();

    const monthEnd = new Date(tYear, tMonth + 1, 0, 23, 59, 59);
    const sixMonthsAgo = new Date(tYear, tMonth - 5, 1);

    // 1. Get all Storage and SAN Switch devices
    const devices = await prisma.inventoryItem.findMany({
      where: {
        model: { device_type: { in: ['storage', 'san_switch'] } }
      },
      include: {
        model: { include: { vendor: true } },
        rack: { include: { room: { include: { datacenter: true } } } }
      }
    });

    // Build xormon_id mapping
    const deviceMap: Record<string, { name: string; type: string; serial: string }> = {};
    const serialToXormonMap: Record<string, string> = {};

    devices.forEach((d: any) => {
      const metadata = (d.metadata || {}) as any;
      const xormonId = metadata?.xormon_id || '';
      const vendorName = (d.vendor?.name || d.model?.vendor?.name || '').toLowerCase();
      const modelName = (d.model?.name || '').toLowerCase();
      const hostName = (d.hostname || d.serial_number || '').toLowerCase();
      const isSan = d.model?.device_type === 'san_switch' ||
                    metadata?.available_ports !== undefined || metadata?.total_ports !== undefined || metadata?.free_ports !== undefined || metadata?.used_ports !== undefined ||
                    vendorName.includes('brocade') || (vendorName.includes('cisco') && (modelName.includes('mds') || hostName.includes('mds'))) ||
                    modelName.includes('brocade') || modelName.includes('mds') || (metadata?.hw_type || '').toLowerCase().includes('brcd');
      const deviceType = isSan ? 'san_switch' : (d.model?.device_type || 'storage');
      const displayName = d.hostname || d.serial_number;

      if (xormonId) {
        serialToXormonMap[d.serial_number] = xormonId;
        deviceMap[xormonId] = { name: displayName, type: deviceType, serial: d.serial_number };
      }
      deviceMap[d.serial_number] = { name: displayName, type: deviceType, serial: d.serial_number };
    });

    const idSet = new Set<string>();
    devices.forEach(d => {
      const meta = (d.metadata || {}) as any;
      const xId = String(meta.xormon_id || '').trim();
      const sNum = String(d.serial_number || '').trim();
      const hName = String(d.hostname || '').trim();
      if (xId) { idSet.add(xId); idSet.add(xId.toLowerCase()); idSet.add(xId.toUpperCase()); }
      if (sNum) { idSet.add(sNum); idSet.add(sNum.toLowerCase()); idSet.add(sNum.toUpperCase()); }
      if (hName) { idSet.add(hName); idSet.add(hName.toLowerCase()); idSet.add(hName.toUpperCase()); }
    });
    const allObjectIds = Array.from(idSet);

    // 2. Get snapshot data for the 6-month window ending at target month
    const snapshots = await prisma.forecastMetricSnapshot.findMany({
      where: {
        object_id: { in: allObjectIds },
        metric_name: { in: ['capacity_total', 'capacity_used', 'capacity_used_percent', 'capacity_free', 'available_ports', 'free_ports', 'used_ports', 'total_ports', 'port_utilization_percent'] },
        captured_at: { gte: sixMonthsAgo, lte: monthEnd }
      },
      orderBy: { captured_at: 'asc' }
    });

    // 3. Group snapshots by device -> month -> metric (keep latest value per month)
    const storageMonthlyMap: Record<string, Record<string, MonthlyStorageData>> = {};
    const sanMonthlyMap: Record<string, Record<string, MonthlySanData>> = {};
    const monthsSet = new Set<string>();

    // Force add the target month to ensure it appears in the report even without snapshots
    const targetMonthKey = `${MONTHS_TR[tMonth]} ${tYear}`;
    monthsSet.add(targetMonthKey);

    for (const snap of snapshots) {
      const d = new Date(snap.captured_at);
      const monthKey = `${MONTHS_TR[d.getMonth()]} ${d.getFullYear()}`;
      monthsSet.add(monthKey);

      const objId = (snap.object_id || '').trim().toLowerCase();
      const objType = snap.object_type;
      const val = parseFloat(snap.metric_value as any) || 0;

      if (objType === 'storage') {
        if (!storageMonthlyMap[objId]) storageMonthlyMap[objId] = {};
        if (!storageMonthlyMap[objId][monthKey]) {
          storageMonthlyMap[objId][monthKey] = { capacity_total_gib: null, capacity_used_gib: null, capacity_free_gib: null, capacity_used_percent: null };
        }
        const entry = storageMonthlyMap[objId][monthKey];
        if (snap.metric_name === 'capacity_total') entry.capacity_total_gib = val * 1024; // TB to GiB
        if (snap.metric_name === 'capacity_used') entry.capacity_used_gib = val * 1024;
        if (snap.metric_name === 'capacity_free') entry.capacity_free_gib = val * 1024;
        if (snap.metric_name === 'capacity_used_percent') entry.capacity_used_percent = val;
      } else if (objType === 'san' || objType === 'san_switch' || ['available_ports', 'total_ports', 'free_ports', 'used_ports', 'port_utilization_percent'].includes(snap.metric_name)) {
        if (!sanMonthlyMap[objId]) sanMonthlyMap[objId] = {};
        if (!sanMonthlyMap[objId][monthKey]) {
          sanMonthlyMap[objId][monthKey] = { available_ports: null, free_ports: null, used_ports: null };
        }
        const entry = sanMonthlyMap[objId][monthKey];
        if (snap.metric_name === 'available_ports' || snap.metric_name === 'total_ports') entry.available_ports = val;
        if (snap.metric_name === 'free_ports') entry.free_ports = val;
        if (snap.metric_name === 'used_ports') entry.used_ports = val;
      }
    }

    // Sort months chronologically
    const sortedMonths = Array.from(monthsSet).sort((a, b) => {
      const [mNameA, yA] = a.split(' ');
      const [mNameB, yB] = b.split(' ');
      const dateA = new Date(parseInt(yA), MONTHS_TR.indexOf(mNameA), 1);
      const dateB = new Date(parseInt(yB), MONTHS_TR.indexOf(mNameB), 1);
      return dateA.getTime() - dateB.getTime();
    });

    // Separate devices by type using original list
    const sanDevices = devices.filter((d: any) => {
      const meta = (d.metadata || {}) as any;
      const vendorName = (d.vendor?.name || d.model?.vendor?.name || '').toLowerCase();
      const modelName = (d.model?.name || '').toLowerCase();
      const hostName = (d.hostname || d.serial_number || '').toLowerCase();
      return d.model?.device_type === 'san_switch' || meta.available_ports !== undefined || meta.total_ports !== undefined || meta.free_ports !== undefined || meta.used_ports !== undefined || vendorName.includes('brocade') || (vendorName.includes('cisco') && (modelName.includes('mds') || hostName.includes('mds'))) || modelName.includes('brocade') || modelName.includes('mds') || (meta.hw_type || '').toLowerCase().includes('brcd');
    });
    const storageDevices = devices.filter(d => !sanDevices.some(sd => sd.id === d.id) && (d.model?.device_type === 'storage' || !d.model?.device_type));

    // Calculate derived values for storage
    for (const objId of Object.keys(storageMonthlyMap)) {
      for (const mKey of Object.keys(storageMonthlyMap[objId])) {
        const entry = storageMonthlyMap[objId][mKey];
        // Calculate free if we have total and used
        if (entry.capacity_free_gib === null && entry.capacity_total_gib !== null && entry.capacity_used_gib !== null) {
          entry.capacity_free_gib = entry.capacity_total_gib - entry.capacity_used_gib;
        }
        // Calculate free from percentage if direct value missing
        if (entry.capacity_free_gib === null && entry.capacity_total_gib !== null && entry.capacity_used_percent !== null) {
          entry.capacity_free_gib = entry.capacity_total_gib * (1 - entry.capacity_used_percent / 100);
        }
      }
    }

    // Calculate derived values for SAN
    for (const objId of Object.keys(sanMonthlyMap)) {
      for (const mKey of Object.keys(sanMonthlyMap[objId])) {
        const entry = sanMonthlyMap[objId][mKey];
        if (entry.available_ports !== null && entry.free_ports !== null) {
          entry.used_ports = entry.available_ports - entry.free_ports;
        }
      }
    }

    // Separate device IDs by type
    const storageIds = allObjectIds.filter(id => {
      const dev = deviceMap[id];
      return dev?.type === 'storage';
    });
    const sanIds = allObjectIds.filter(id => {
      const dev = deviceMap[id];
      return dev?.type === 'san_switch';
    });

    // Also include any devices found in snapshot data but not in inventory
    for (const objId of Object.keys(storageMonthlyMap)) {
      if (!storageIds.includes(objId)) {
        storageIds.push(objId);
        if (!deviceMap[objId]) {
          // Try to get the name from snapshot
          const snap = snapshots.find(s => s.object_id === objId);
          deviceMap[objId] = { name: snap?.object_name || objId, type: 'storage', serial: objId };
        }
      }
    }
    for (const objId of Object.keys(sanMonthlyMap)) {
      if (!sanIds.includes(objId)) {
        sanIds.push(objId);
        if (!deviceMap[objId]) {
          const snap = snapshots.find(s => s.object_id === objId);
          deviceMap[objId] = { name: snap?.object_name || objId, type: 'san_switch', serial: objId };
        }
      }
    }

    // 4. Build Excel
    const workbook = new ExcelJS.Workbook();
    const ws = workbook.addWorksheet('KPI Raporu');

    // ============================================================
    // HEADER ROW 1: "KPI" + Month Names (merged across sub-columns)
    // ============================================================
    const row1: any[] = ['KPI'];
    // For storage: each month has 2 sub-columns (Boş Kapasite GiB, Dolu Kapasite %)
    // Middle column: Kapasite (GiB) - total capacity (latest known)
    // For now, build for storage section first

    // Storage sub-columns per month: Boş Kapasite (GiB), Dolu Kapasite (%)
    // We also add a "Kapasite (GiB)" column (total) in the middle between months
    // But looking at reference, it seems total capacity is just another column in the same row
    // Let me build it month by month

    // Column layout for storage:
    // Col A: Device name (KPI header)
    // For each month: 2 columns (Boş Kapasite GiB, Dolu Kapasite %)
    const storageColsPerMonth = 3; // Boş Kapasite (GiB), Dolu Kapasite (%), Kapasite (GiB)
    const sanColsPerMonth = 3; // Boş Port, Dolu Port, Toplam Port

    // --- ROW 1: Top-level headers ---
    const headerRow1 = ws.getRow(1);
    headerRow1.getCell(1).value = 'KPI';
    headerRow1.getCell(1).font = HEADER_FONT_WHITE;
    headerRow1.getCell(1).fill = HEADER_GOLD;
    headerRow1.getCell(1).alignment = CENTER;
    headerRow1.getCell(1).border = BORDER_THIN;

    let col = 2;
    const monthStartCols: number[] = [];
    for (const month of sortedMonths) {
      monthStartCols.push(col);
      headerRow1.getCell(col).value = month;
      headerRow1.getCell(col).font = HEADER_FONT_WHITE;
      headerRow1.getCell(col).fill = HEADER_GOLD;
      headerRow1.getCell(col).alignment = CENTER;
      headerRow1.getCell(col).border = BORDER_THIN;

      // Merge the month header across its sub-columns
      if (storageColsPerMonth > 1) {
        ws.mergeCells(1, col, 1, col + storageColsPerMonth - 1);
      }
      col += storageColsPerMonth;
    }

    // --- ROW 2: Sub-column headers for Storage ---
    const headerRow2 = ws.getRow(2);
    headerRow2.getCell(1).value = 'Disk Ünitesi';
    headerRow2.getCell(1).font = HEADER_FONT_WHITE;
    headerRow2.getCell(1).fill = HEADER_BLUE;
    headerRow2.getCell(1).alignment = LEFT;
    headerRow2.getCell(1).border = BORDER_THIN;

    col = 2;
    for (const _month of sortedMonths) {
      headerRow2.getCell(col).value = 'Boş Kapasite (GiB)';
      headerRow2.getCell(col).font = HEADER_FONT_WHITE;
      headerRow2.getCell(col).fill = HEADER_BLUE;
      headerRow2.getCell(col).alignment = CENTER;
      headerRow2.getCell(col).border = BORDER_THIN;

      headerRow2.getCell(col + 1).value = 'Dolu Kapasite (%)';
      headerRow2.getCell(col + 1).font = HEADER_FONT_WHITE;
      headerRow2.getCell(col + 1).fill = HEADER_BLUE;
      headerRow2.getCell(col + 1).alignment = CENTER;
      headerRow2.getCell(col + 1).border = BORDER_THIN;

      headerRow2.getCell(col + 2).value = 'Kapasite (GiB)';
      headerRow2.getCell(col + 2).font = HEADER_FONT_WHITE;
      headerRow2.getCell(col + 2).fill = HEADER_BLUE;
      headerRow2.getCell(col + 2).alignment = CENTER;
      headerRow2.getCell(col + 2).border = BORDER_THIN;

      col += storageColsPerMonth;
    }

    // Set column widths
    ws.getColumn(1).width = 30;
    for (let i = 2; i <= 1 + sortedMonths.length * storageColsPerMonth; i++) {
      ws.getColumn(i).width = 20;
    }

    // --- STORAGE DATA ROWS ---
    let currentRow = 3;
    for (const objId of storageIds) {
      const dev = deviceMap[objId];
      const row = ws.getRow(currentRow);
      row.getCell(1).value = dev?.name || objId;
      row.getCell(1).alignment = LEFT;
      row.getCell(1).border = BORDER_THIN;

      col = 2;
      for (const month of sortedMonths) {
        const data = storageMonthlyMap[objId]?.[month];
        
        // Boş Kapasite (GiB)
        const freeGib = data?.capacity_free_gib;
        row.getCell(col).value = freeGib !== null && freeGib !== undefined ? parseFloat(freeGib.toFixed(2)) : '-';
        row.getCell(col).alignment = CENTER;
        row.getCell(col).border = BORDER_THIN;
        if (typeof row.getCell(col).value === 'number') {
          row.getCell(col).numFmt = '#,##0.00';
        }

        // Dolu Kapasite (%)
        const usedPct = data?.capacity_used_percent;
        row.getCell(col + 1).value = usedPct !== null && usedPct !== undefined ? parseFloat(usedPct.toFixed(2)) : '-';
        row.getCell(col + 1).alignment = CENTER;
        row.getCell(col + 1).border = BORDER_THIN;
        if (typeof row.getCell(col + 1).value === 'number') {
          row.getCell(col + 1).numFmt = '0.00';
        }

        // Kapasite (GiB) - Toplam
        const totalGib = data?.capacity_total_gib;
        row.getCell(col + 2).value = totalGib !== null && totalGib !== undefined ? parseFloat(totalGib.toFixed(2)) : '-';
        row.getCell(col + 2).alignment = CENTER;
        row.getCell(col + 2).border = BORDER_THIN;
        if (typeof row.getCell(col + 2).value === 'number') {
          row.getCell(col + 2).numFmt = '#,##0.00';
        }

        col += storageColsPerMonth;
      }
      currentRow++;
    }

    // --- SAN SECTION SEPARATOR ---
    currentRow++; // Empty row
    const sanHeaderRow1 = ws.getRow(currentRow);
    sanHeaderRow1.getCell(1).value = 'SAN Switch /Direktör';
    sanHeaderRow1.getCell(1).font = HEADER_FONT_WHITE;
    sanHeaderRow1.getCell(1).fill = HEADER_GOLD;
    sanHeaderRow1.getCell(1).alignment = LEFT;
    sanHeaderRow1.getCell(1).border = BORDER_THIN;

    col = 2;
    for (const month of sortedMonths) {
      sanHeaderRow1.getCell(col).value = month;
      sanHeaderRow1.getCell(col).font = HEADER_FONT_WHITE;
      sanHeaderRow1.getCell(col).fill = HEADER_GOLD;
      sanHeaderRow1.getCell(col).alignment = CENTER;
      sanHeaderRow1.getCell(col).border = BORDER_THIN;

      if (sanColsPerMonth > 1) {
        ws.mergeCells(currentRow, col, currentRow, col + sanColsPerMonth - 1);
      }
      col += sanColsPerMonth;
    }
    currentRow++;

    // SAN sub-headers
    const sanHeaderRow2 = ws.getRow(currentRow);
    sanHeaderRow2.getCell(1).value = 'SAN Switch /Direktör';
    sanHeaderRow2.getCell(1).font = HEADER_FONT_WHITE;
    sanHeaderRow2.getCell(1).fill = HEADER_BLUE;
    sanHeaderRow2.getCell(1).alignment = LEFT;
    sanHeaderRow2.getCell(1).border = BORDER_THIN;

    col = 2;
    for (const _month of sortedMonths) {
      sanHeaderRow2.getCell(col).value = 'Boş Port';
      sanHeaderRow2.getCell(col).font = HEADER_FONT_WHITE;
      sanHeaderRow2.getCell(col).fill = HEADER_BLUE;
      sanHeaderRow2.getCell(col).alignment = CENTER;
      sanHeaderRow2.getCell(col).border = BORDER_THIN;

      sanHeaderRow2.getCell(col + 1).value = 'Dolu Port';
      sanHeaderRow2.getCell(col + 1).font = HEADER_FONT_WHITE;
      sanHeaderRow2.getCell(col + 1).fill = HEADER_BLUE;
      sanHeaderRow2.getCell(col + 1).alignment = CENTER;
      sanHeaderRow2.getCell(col + 1).border = BORDER_THIN;

      sanHeaderRow2.getCell(col + 2).value = 'Toplam Port';
      sanHeaderRow2.getCell(col + 2).font = HEADER_FONT_WHITE;
      sanHeaderRow2.getCell(col + 2).fill = HEADER_BLUE;
      sanHeaderRow2.getCell(col + 2).alignment = CENTER;
      sanHeaderRow2.getCell(col + 2).border = BORDER_THIN;

      col += sanColsPerMonth;
    }
    currentRow++;

    // --- SAN DATA ROWS ---
    for (const objId of sanIds) {
      const dev = deviceMap[objId] || { name: objId, type: 'san_switch', serial: objId };
      const inventoryDevice = devices.find(d => {
        const meta = (d.metadata || {}) as any;
        return (d.serial_number && d.serial_number.toLowerCase() === objId.toLowerCase()) ||
               (d.serial_number && dev.serial && d.serial_number.toLowerCase() === dev.serial.toLowerCase()) ||
               (meta.xormon_id && String(meta.xormon_id).toLowerCase() === objId.toLowerCase()) ||
               (d.hostname && d.hostname.toLowerCase() === objId.toLowerCase()) ||
               (d.hostname && dev.name && d.hostname.toLowerCase() === dev.name.toLowerCase());
      });
      const metadata = (inventoryDevice?.metadata as any) || {};
      const xormonId = (metadata.xormon_id || '').trim().toLowerCase();
      const serial = (inventoryDevice?.serial_number || dev.serial || objId).trim().toLowerCase();
      const hostname = (inventoryDevice?.hostname || dev.name || '').trim().toLowerCase();
      
      const row = ws.getRow(currentRow);
      row.getCell(1).value = inventoryDevice?.hostname || dev.name || objId;
      row.getCell(1).alignment = LEFT;
      row.getCell(1).border = BORDER_THIN;

      col = 2;
      for (const mKey of sortedMonths) {
        // Try to match snapshots using both xormon_id and serial (normalized)
        let data = sanMonthlyMap[xormonId]?.[mKey] || sanMonthlyMap[serial]?.[mKey] || (hostname ? sanMonthlyMap[hostname]?.[mKey] : undefined) || sanMonthlyMap[objId.toLowerCase()]?.[mKey];
        
        // If still no data, try to find in sanMonthlyMap with case-insensitive search
        if (!data) {
          const matchingId = Object.keys(sanMonthlyMap).find(id => id.toLowerCase() === xormonId || id.toLowerCase() === serial || id.toLowerCase() === objId.toLowerCase() || (hostname && id.toLowerCase() === hostname));
          if (matchingId) data = sanMonthlyMap[matchingId][mKey];
        }

        // Fallback to current metadata if snapshot is missing for this month
        let total = data?.available_ports;
        if (total === null || total === undefined || isNaN(total)) {
          const mTotal = parseFloat(String(metadata.available_ports ?? metadata.total_ports ?? metadata.ports_total ?? metadata.ports_count ?? metadata.port_count ?? metadata.max_ports ?? '0'));
          total = !isNaN(mTotal) && mTotal > 0 ? mTotal : null;
        }

        let free = data?.free_ports;
        if (free === null || free === undefined || isNaN(free)) {
          const mFree = parseFloat(String(metadata.free_ports ?? metadata.ports_free ?? metadata.unused_ports ?? '0'));
          free = !isNaN(mFree) && (mFree > 0 || (mFree === 0 && total !== null)) ? mFree : null;
        }

        let used = data?.used_ports;
        if (used === null || used === undefined || isNaN(used)) {
          const mUsed = parseFloat(String(metadata.used_ports ?? metadata.ports_used ?? metadata.active_ports ?? '0'));
          if (!isNaN(mUsed) && mUsed > 0) {
            used = mUsed;
          } else if (total !== null && free !== null) {
            used = total - free;
          } else {
            used = null;
          }
        }
        if ((used === null || used === undefined || isNaN(used)) && total !== null && free !== null) {
          used = total - free;
        }
        if ((free === null || free === undefined || isNaN(free)) && total !== null && used !== null) {
          free = total - used;
        }

        // Boş Port
        row.getCell(col).value = free !== null && free !== undefined && !isNaN(free) && free >= 0 ? free : '-';
        row.getCell(col).alignment = CENTER;
        row.getCell(col).border = BORDER_THIN;

        // Dolu Port
        row.getCell(col + 1).value = used !== null && used !== undefined && !isNaN(used) && used >= 0 ? used : '-';
        row.getCell(col + 1).alignment = CENTER;
        row.getCell(col + 1).border = BORDER_THIN;

        // Toplam Port
        row.getCell(col + 2).value = total !== null && total !== undefined && !isNaN(total) && total >= 0 ? total : '-';
        row.getCell(col + 2).alignment = CENTER;
        row.getCell(col + 2).border = BORDER_THIN;

        col += sanColsPerMonth;
      }
      currentRow++;
    }

    // 5. Persist to MonthlyCapacityKPI for history
    for (const objId of Object.keys(storageMonthlyMap)) {
      for (const mKey of Object.keys(storageMonthlyMap[objId])) {
        const [mName, yStr] = mKey.split(' ');
        const mIdx = MONTHS_TR.indexOf(mName);
        const reportDate = new Date(parseInt(yStr), mIdx, 1);
        const entry = storageMonthlyMap[objId][mKey];

        try {
          await prisma.monthlyCapacityKPI.upsert({
            where: { object_id_report_month: { object_id: objId, report_month: reportDate } },
            update: { capacity_percent: entry.capacity_used_percent || 0, capacity_gib: entry.capacity_total_gib },
            create: {
              object_id: objId,
              object_name: deviceMap[objId]?.name || objId,
              report_month: reportDate,
              capacity_percent: entry.capacity_used_percent || 0,
              capacity_gib: entry.capacity_total_gib
            }
          });
        } catch (dbErr: any) {
          console.warn(`[KPI] DB persist warning: ${dbErr.message}`);
        }
      }
    }

    // 6. Send Excel
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="inventrops-aylik-kpi.xlsx"');
    await workbook.xlsx.write(res);
    res.end();

  } catch (error: any) {
    console.error('[KPI Controller Error]', error);
    res.status(500).json({ error: 'Excel raporu oluşturulurken hata oluştu.', detail: error.message });
  }
};
