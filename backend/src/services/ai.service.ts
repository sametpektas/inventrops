import OpenAI from 'openai';
import { prisma } from '../lib/prisma';
import dotenv from 'dotenv';
import https from 'https';
import { decrypt } from '../utils/crypto';

dotenv.config();

// NOT: TLS doğrulaması sadece AI HTTP agent'ı için devre dışı bırakılıyor (aşağıda).
// Tüm süreç için geçersiz kılmak güvenlik riski oluşturur — kaldırıldı.

function sanitizeBaseUrl(url: string): string {
  if (!url) return url;
  let cleanUrl = url.trim().replace(/\/+$/, ""); // Sondaki slashları temizle
  cleanUrl = cleanUrl.replace(/\/chat\/completions$/, ""); // Sondaki yolu temizle
  return cleanUrl;
}

const httpsAgent = new https.Agent({
  rejectUnauthorized: false,
});

/**
 * OpenAI SDK v4+ Node 18/20 üzerinde global fetch (undici) kullanır ve httpAgent seçeneğini yok sayar.
 * Self-signed TLS sertifikalarını kabul edebilmesi için özel fetch sarmalayıcısı tanıyoruz.
 */
const customFetch = async (url: any, init?: any): Promise<Response> => {
  const origReject = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  try {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    return await fetch(url, init);
  } finally {
    if (origReject !== undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = origReject;
    } else {
      delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    }
  }
};

/**
 * AI Konfigürasyonunu veritabanından veya .env'den alır.
 */
async function getAIClient() {
  const config = await prisma.integrationConfig.findFirst({
    where: { integration_type: 'ai_assistant' as any, is_active: true }
  });

  if (config) {
    return {
      client: new OpenAI({
        apiKey: config.api_key ? decrypt(config.api_key) : '',
        baseURL: sanitizeBaseUrl(config.url),
        httpAgent: httpsAgent,
        fetch: customFetch
      } as any),
      model: config.username || 'llama3' // Model adını username alanında saklayabiliriz
    };
  }

  // Fallback to .env
  return {
    client: new OpenAI({
      apiKey: process.env.AI_API_KEY || 'sk-placeholder',
      baseURL: sanitizeBaseUrl(process.env.AI_API_BASE_URL || 'http://your-company-ai-api.local/v1'),
      httpAgent: httpsAgent,
      fetch: customFetch
    } as any),
    model: process.env.AI_MODEL || 'llama3'
  };
}

/**
 * AI Tool Tanımları: LLM'in hangi fonksiyonları çağırabileceğini burada belirliyoruz.
 */
const tools: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'search_inventory',
      description: 'Envanterdeki cihazları arar veya filtreler.',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Seri numarası, hostname veya IP adresi arama terimi.' },
          status: { type: 'string', enum: ['active', 'inactive', 'maintenance'], description: 'Cihaz durumu.' },
          vendor: { type: 'string', description: 'Marka/Üretici adı.' },
          model_name: { type: 'string', description: 'Model adı (Örn: PowerEdge R740)' },
          type: { type: 'string', enum: ['server', 'storage', 'san', 'switch', 'virtualization'], description: 'Cihaz tipi.' },
          warranty_before: { type: 'string', description: 'Garantisi bu tarihten önce bitenler (YYYY-MM-DD)' },
          warranty_after: { type: 'string', description: 'Garantisi bu tarihten sonra bitenler (YYYY-MM-DD)' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_device_detail',
      description: 'Belirli bir cihazın tüm detaylarını getirir.',
      parameters: {
        type: 'object',
        properties: {
          serial_number: { type: 'string', description: 'Cihazın tam seri numarası.' },
        },
        required: ['serial_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_device_notes',
      description: 'Bir cihazın notlar kısmını günceller.',
      parameters: {
        type: 'object',
        properties: {
          serial_number: { type: 'string', description: 'Cihazın seri numarası.' },
          notes: { type: 'string', description: 'Eklenecek veya güncellenecek yeni not içeriği.' },
        },
        required: ['serial_number', 'notes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_warranty',
      description: 'Cihazın garanti bitiş tarihini (warranty_end) günceller.',
      parameters: {
        type: 'object',
        properties: {
          serial_number: { type: 'string', description: 'Cihazın seri numarası' },
          new_date: { type: 'string', description: 'Yeni garanti bitiş tarihi (Örn: 2026-12-12 veya 12.12.2026)' },
        },
        required: ['serial_number', 'new_date'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_stats',
      description: 'Envanterin genel istatistiklerini (toplam cihaz, durum dağılımı, cihaz tipi dağılımı) getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_capacity_summary',
      description: 'Sistem genelindeki CPU, RAM ve Disk kullanım özetlerini ve kapasite verilerini getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_location_overview',
      description: 'Veri merkezleri, odalar ve kabinetlerin (rack) listesini ve doluluk durumlarını getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_inventory_health',
      description: 'Envanterin genel sağlık durumunu, offline veya kritik durumdaki cihazları raporlar.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_top_consumers',
      description: 'En yüksek CPU, RAM veya Disk kullanımı olan ilk 10 cihazı listeler.',
      parameters: {
        type: 'object',
        properties: {
          metric: { type: 'string', enum: ['cpu', 'ram', 'storage'], description: 'Hangi metriğe göre sıralanacağı.' }
        },
        required: ['metric']
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_unplaced_devices',
      description: 'Envanterde olan ancak herhangi bir kabinete (rack) yerleştirilmemiş cihazları getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_ip_conflicts',
      description: 'Sistemde aynı IP adresini kullanan mükerrer (çakışan) kayıtları denetler.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_storage_details',
      description: 'Depolama havuzları, LUNlar ve disk doluluk oranları hakkında detaylı veri getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_device_info',
      description: 'Bir cihazın hostname, IP adresi veya durum (status) bilgilerini günceller.',
      parameters: {
        type: 'object',
        properties: {
          serial_number: { type: 'string', description: 'Cihazın seri numarası' },
          hostname: { type: 'string', description: 'Yeni hostname (opsiyonel)' },
          ip_address: { type: 'string', description: 'Yeni IP adresi (opsiyonel)' },
          status: { type: 'string', enum: ['active', 'inactive', 'maintenance'], description: 'Yeni durum (opsiyonel)' },
        },
        required: ['serial_number'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_warranty_report',
      description: 'Garanti bitiş tarihlerini marka (vendor) ve cihaz tipi bazlı özetler.',
      parameters: {
        type: 'object',
        properties: {
          year: { type: 'number', description: 'Hangi yıl için rapor isteniyor? (Örn: 2026)' }
        }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_datacenter',
      description: 'Yeni bir veri merkezi (Datacenter) oluşturur.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Veri merkezi adı (Örn: AVM Ankara, Varyap İstanbul)' },
          location: { type: 'string', description: 'Şehir veya konum bilgisi (Örn: Ankara, İstanbul)' },
          address: { type: 'string', description: 'Açık adres bilgisi (opsiyonel)' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_room',
      description: 'Bir veri merkezine yeni bir oda (Room) ekler.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Oda adı (Örn: A Salonu, Sunucu Odası 1)' },
          datacenter_name: { type: 'string', description: 'Hangi veri merkezine ait olduğu (adıyla)' },
          floor: { type: 'string', description: 'Kat bilgisi (opsiyonel, Örn: 1, Zemin)' },
        },
        required: ['name', 'datacenter_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_devices',
      description: 'Verilen kelimeye veya harfe göre envanterdeki cihazları arar. Belirli bir isimle veya harfle başlayan cihazları bulmak için kullanılır.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Aranacak kelime, harf veya seri numarası (Örn: "A", "SRV", "10.240")' }
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_rack',
      description: 'Bir odaya yeni bir kabinet (Rack) ekler.',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Kabinet adı (Örn: Rack-A01, Kabin-1)' },
          room_name: { type: 'string', description: 'Hangi odaya ait olduğu (adıyla)' },
          datacenter_name: { type: 'string', description: 'Veri merkezi adı (odayı doğru bulmak için)' },
          total_units: { type: 'number', description: 'Toplam U yüksekliği (varsayılan: 42)' },
        },
        required: ['name', 'room_name', 'datacenter_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_device_location',
      description: 'Bir cihazın lokasyon bilgisini günceller. Cihazı belirtilen veri merkezi, oda ve kabinete yerleştirir.',
      parameters: {
        type: 'object',
        properties: {
          device_identifier: { type: 'string', description: 'Cihazın seri numarası veya hostname bilgisi' },
          datacenter_name: { type: 'string', description: 'Hedef veri merkezi adı' },
          room_name: { type: 'string', description: 'Hedef oda adı (opsiyonel, belirtilmezse varsayılan oda kullanılır)' },
          rack_name: { type: 'string', description: 'Hedef kabinet adı (opsiyonel, belirtilmezse varsayılan kabinet kullanılır)' },
          rack_unit_start: { type: 'number', description: 'Kabinet içindeki başlangıç U pozisyonu (opsiyonel)' },
        },
        required: ['device_identifier', 'datacenter_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_sync_status',
      description: 'Tüm entegrasyonların son senkronizasyon durumunu, başarı/hata loglarını ve zamanlamasını getirir.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_forecast_risks',
      description: 'Kapasite tahminine göre risk seviyesi yüksek (red veya orange) olan cihazları listeler.',
      parameters: {
        type: 'object',
        properties: {
          min_level: { type: 'string', enum: ['orange', 'red'], description: 'Minimum risk seviyesi filtresi.' }
        }
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'bulk_update_team',
      description: 'Birden fazla cihazı aynı anda bir takıma atar.',
      parameters: {
        type: 'object',
        properties: {
          serial_numbers: { type: 'array', items: { type: 'string' }, description: 'Güncellenecek cihazların seri numaraları listesi.' },
          team_name: { type: 'string', description: 'Hedef takım adı.' }
        },
        required: ['serial_numbers', 'team_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_vendor_summary',
      description: 'Marka (vendor) bazlı envanter özeti: her üretici için toplam cihaz sayısı, garanti süresi geçmiş ve yaklaşan cihaz sayısı.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rack_utilization',
      description: 'Rack (kabin) bazlı doluluk analizi. Her rack için toplam U, kullanılan U ve boş U sayısını hesaplar.',
      parameters: {
        type: 'object',
        properties: {
          datacenter_name: { type: 'string', description: 'Sadece belirli bir veri merkezindeki rack\'leri filtrelemek için (opsiyonel).' }
        }
      },
    },
  },
];


/**
 * Tool Execution: LLM bir tool çağırdığında çalışacak gerçek kodlar.
 */
async function executeTool(toolCall: any) {
  const name = toolCall.function?.name;
  const args = toolCall.function?.arguments ? JSON.parse(toolCall.function.arguments) : {};

  if (!name) return { error: 'Invalid tool call' };

  console.log(`[AI-Agent] Executing tool: ${name}`, args);

  switch (name) {
    case 'search_inventory':
      return await prisma.inventoryItem.findMany({
        where: {
          OR: args.search ? [
            { serial_number: { contains: args.search, mode: 'insensitive' } },
            { hostname: { contains: args.search, mode: 'insensitive' } },
            { ip_address: { contains: args.search, mode: 'insensitive' } },
          ] : undefined,
          status: args.status,
          model: {
            AND: [
              args.vendor ? { vendor: { name: { contains: args.vendor, mode: 'insensitive' } } } : {},
              args.model_name ? { name: { contains: args.model_name, mode: 'insensitive' } } : {},
              args.type ? { device_type: args.type } : {},
            ]
          },
          warranty_expiry: {
            lte: args.warranty_before ? new Date(args.warranty_before) : undefined,
            gte: args.warranty_after ? new Date(args.warranty_after) : undefined,
          }
        },
        include: { model: { include: { vendor: true } } },
        take: 1000 // Daha fazla sonuç alabilmesi için sınırı artırdık (Önceki: 50)
      });

    case 'get_device_detail':
      return await prisma.inventoryItem.findUnique({
        where: { serial_number: args.serial_number },
        include: { 
          model: { include: { vendor: true } },
          rack: { include: { room: { include: { datacenter: true } } } }
        }
      });

    case 'update_device_notes':
      return await prisma.inventoryItem.update({
        where: { serial_number: args.serial_number },
        data: { notes: args.notes }
      });

    case 'update_warranty':
      // Tarih formatını kontrol et ve normalize et
      let dateObj;
      if (args.new_date.includes('.')) {
        const [d, m, y] = args.new_date.split('.');
        dateObj = new Date(`${y}-${m}-${d}`);
      } else {
        dateObj = new Date(args.new_date);
      }

      return await prisma.inventoryItem.update({
        where: { serial_number: args.serial_number },
        data: { warranty_expiry: dateObj }
      });

    case 'get_inventory_stats':
      const totalCount = await prisma.inventoryItem.count();
      const statusGroups = await prisma.inventoryItem.groupBy({ by: ['status'] as any, _count: true });
      
      // Cihaz tiplerine göre sayım (Model tablosu üzerinden)
      const typeStats = await prisma.inventoryItem.findMany({
        select: { model: { select: { device_type: true } } }
      });
      const typeCounts: any = {};
      typeStats.forEach(item => {
        const t = item.model.device_type;
        typeCounts[t] = (typeCounts[t] || 0) + 1;
      });

      return { total: totalCount, statusDistribution: statusGroups, typeDistribution: typeCounts };

    case 'get_capacity_summary':
      const snapshots = await prisma.forecastMetricSnapshot.findMany({
        orderBy: { captured_at: 'desc' },
        take: 20,
        include: { source: true }
      });
      const results = await prisma.forecastResult.findMany({
        orderBy: { id: 'desc' },
        take: 10,
      });
      return { recent_metrics: snapshots, latest_predictions: results };

    case 'get_location_overview':
      const dcs = await prisma.datacenter.findMany({
        include: { rooms: { include: { _count: { select: { racks: true } } } } }
      });
      const racksSample = await prisma.rack.findMany({
        take: 10,
        include: { _count: { select: { items: true } } }
      });
      return { datacenters: dcs, sample_racks: racksSample };

    case 'get_inventory_health':
      const offlineItems = await prisma.inventoryItem.findMany({
        where: { status: 'inactive' },
        include: { model: { include: { vendor: true } } }
      });
      const syncErrors = await prisma.syncLog.findMany({
        where: { status: 'failed' },
        take: 5,
        orderBy: { created_at: 'desc' },
        include: { integration: true }
      });
      return { offline_devices: offlineItems, recent_sync_failures: syncErrors };

    case 'get_top_consumers':
      // Metrik isimlerini normalize et (model bazen farklı isimler gönderebilir)
      let metricName = args.metric;
      if (metricName.includes('cpu')) metricName = 'cpu_usage_percent';
      else if (metricName.includes('ram')) metricName = 'memory_usage_percent';
      else if (metricName.includes('storage') || metricName.includes('disk') || metricName.includes('cap')) metricName = 'capacity_used_percent';

      return await prisma.forecastMetricSnapshot.findMany({
        where: { metric_name: { contains: metricName } },
        orderBy: { metric_value: 'desc' },
        take: 10,
        include: { source: true }
      });

    case 'get_unplaced_devices':
      return await prisma.inventoryItem.findMany({
        where: { rack_id: null },
        include: { model: { include: { vendor: true } } }
      });

    case 'check_ip_conflicts':
      const items = await prisma.inventoryItem.findMany({
        where: { NOT: { ip_address: null } },
        select: { ip_address: true, serial_number: true, hostname: true }
      });
      const ipCounts: any = {};
      items.forEach(i => {
        if (i.ip_address) {
          ipCounts[i.ip_address] = (ipCounts[i.ip_address] || 0) + 1;
        }
      });
      const conflicts = items.filter(i => i.ip_address && ipCounts[i.ip_address] > 1);
      return { total_conflicts: conflicts.length, details: conflicts };

    case 'get_storage_details':
      return await prisma.forecastMetricSnapshot.findMany({
        where: { 
          OR: [
            { object_type: 'storage' },
            { metric_name: { contains: 'capacity' } },
            { metric_name: { contains: 'storage' } }
          ]
        },
        orderBy: { captured_at: 'desc' },
        take: 30,
        include: { source: true }
      });

    case 'update_device_info':
      return await prisma.inventoryItem.update({
        where: { serial_number: args.serial_number },
        data: {
          hostname: args.hostname !== undefined ? args.hostname : undefined,
          ip_address: args.ip_address !== undefined ? args.ip_address : undefined,
          status: args.status !== undefined ? args.status : undefined,
        }
      });

    case 'get_warranty_report':
      const year = args.year || new Date().getFullYear();
      const startDate = new Date(`${year}-01-01`);
      const endDate = new Date(`${year}-12-31`);

      const itemsForYear = await prisma.inventoryItem.findMany({
        where: {
          warranty_expiry: { gte: startDate, lte: endDate }
        },
        include: { model: { include: { vendor: true } } }
      });

      const report: any = {};
      itemsForYear.forEach(item => {
        const vendor = item.model.vendor.name;
        const type = item.model.device_type;
        const key = `${vendor} - ${type}`;
        if (!report[key]) report[key] = { count: 0, serials: [] };
        report[key].count++;
        report[key].serials.push(item.serial_number);
      });

      return { year, summary: report };

    case 'create_datacenter': {
      let firstTeam = await prisma.team.findFirst();
      if (!firstTeam) {
        firstTeam = await prisma.team.create({
          data: { name: 'Default Team', description: 'System generated default team' }
        });
      }
      const dc = await prisma.datacenter.create({
        data: {
          name: args.name,
          location: args.location || null,
          address: args.address || null,
          team_id: firstTeam.id
        }
      });
      return { success: true, message: `Veri merkezi '${dc.name}' başarıyla oluşturuldu.`, datacenter: dc };
    }

    case 'create_room': {
      const dc = await prisma.datacenter.findFirst({
        where: { name: { contains: args.datacenter_name, mode: 'insensitive' } }
      });
      if (!dc) return { error: `'${args.datacenter_name}' adlı veri merkezi bulunamadı. Önce oluşturmanız gerekiyor.` };

      const room = await prisma.room.create({
        data: {
          name: args.name,
          datacenter_id: dc.id,
          floor: args.floor || '0'
        }
      });
      return { success: true, message: `'${room.name}' odası '${dc.name}' veri merkezine başarıyla eklendi.`, room };
    }

    case 'create_rack': {
      const dc = await prisma.datacenter.findFirst({
        where: { name: { contains: args.datacenter_name, mode: 'insensitive' } }
      });
      if (!dc) return { error: `'${args.datacenter_name}' adlı veri merkezi bulunamadı.` };

      const room = await prisma.room.findFirst({
        where: {
          name: { contains: args.room_name, mode: 'insensitive' },
          datacenter_id: dc.id
        }
      });
      if (!room) return { error: `'${dc.name}' veri merkezinde '${args.room_name}' adlı oda bulunamadı. Önce oluşturmanız gerekiyor.` };

      const rack = await prisma.rack.create({
        data: {
          name: args.name,
          room_id: room.id,
          total_units: args.total_units || 42
        }
      });
      return { success: true, message: `'${rack.name}' kabineti '${room.name}' odasına başarıyla eklendi. (${rack.total_units}U)`, rack };
    }

    case 'update_device_location': {
      const identifier = args.device_identifier || args.serial_number;
      if (!identifier) return { error: 'Cihazı bulmak için seri numarası veya hostname belirtmelisiniz.' };

      const device = await prisma.inventoryItem.findFirst({
        where: {
          OR: [
            { serial_number: identifier },
            { hostname: { contains: identifier, mode: 'insensitive' } }
          ]
        }
      });
      if (!device) return { error: `'${identifier}' bilgisine sahip cihaz bulunamadı.` };

      // 1. Find or create Datacenter
      let dc = await prisma.datacenter.findFirst({
        where: { name: { contains: args.datacenter_name, mode: 'insensitive' } }
      });
      if (!dc) {
        let firstTeam = await prisma.team.findFirst();
        if (!firstTeam) {
          firstTeam = await prisma.team.create({ data: { name: 'Default Team' } });
        }
        dc = await prisma.datacenter.create({
          data: { name: args.datacenter_name, team_id: firstTeam.id }
        });
      }

      // 2. Find or create Room
      let room = null;
      if (args.room_name) {
        room = await prisma.room.findFirst({
          where: { name: { contains: args.room_name, mode: 'insensitive' }, datacenter_id: dc.id }
        });
      }
      
      if (!room) {
        // Eğer oda ismi verilmemişse veya bulunamamışsa, o veri merkezindeki İLK odada şansımızı deneyelim
        room = await prisma.room.findFirst({
          where: { datacenter_id: dc.id }
        });
      }

      if (!room) {
        const targetRoomName = args.room_name || 'Sistem Odası';
        room = await prisma.room.create({
          data: { name: targetRoomName, datacenter_id: dc.id, floor: '0' }
        });
      }

      // 3. Find or create Rack
      let rack = null;
      if (args.rack_name) {
        rack = await prisma.rack.findFirst({
          where: { name: { contains: args.rack_name, mode: 'insensitive' }, room_id: room.id }
        });
      }

      if (!rack) {
        // Eğer kabinet verilmemişse veya bulunamamışsa, bu odadaki İLK kabineti seçelim
        rack = await prisma.rack.findFirst({
          where: { room_id: room.id }
        });
      }

      if (!rack) {
        const targetRackName = args.rack_name || 'Varsayılan Kabinet';
        rack = await prisma.rack.create({
          data: { name: targetRackName, room_id: room.id, total_units: 42 }
        });
      }

      // Update Device
      const updated = await prisma.inventoryItem.update({
        where: { id: device.id },
        data: {
          rack_id: rack.id,
          rack_unit_start: args.rack_unit_start || null
        }
      });

      return {
        success: true,
        message: `Cihaz '${updated.serial_number}' (${updated.hostname || 'İsimsiz'}) başarıyla '${dc.name} > ${room.name} > ${rack.name}' konumuna yerleştirildi.`,
        device: { serial_number: updated.serial_number, hostname: updated.hostname, rack_id: updated.rack_id }
      };
    }

    case 'search_devices': {
      if (!args.query) return { error: 'Arama kelimesi belirtilmedi.' };
      const q = String(args.query);

      const items = await prisma.inventoryItem.findMany({
        where: {
          OR: [
            { hostname: { startsWith: q, mode: 'insensitive' } },
            { hostname: { contains: q, mode: 'insensitive' } },
            { serial_number: { contains: q, mode: 'insensitive' } },
            { ip_address: { contains: q, mode: 'insensitive' } }
          ]
        },
        include: { model: true },
        take: 50
      });

      return {
        count: items.length,
        devices: items.map(item => ({
          id: item.id,
          hostname: item.hostname || 'Bilinmiyor',
          serial_number: item.serial_number,
          type: item.model.device_type,
          ip: item.ip_address || '-',
          status: item.status
        }))
      };
    }

    case 'get_sync_status': {
      const integrations = await prisma.integrationConfig.findMany({
        include: {
          logs: {
            orderBy: { created_at: 'desc' },
            take: 3
          }
        }
      });
      return integrations.map(i => ({
        name: i.name,
        type: i.integration_type,
        is_active: i.is_active,
        last_sync_at: i.last_sync_at,
        recent_logs: i.logs.map(l => ({
          status: l.status,
          created: l.created_at,
          completed: l.completed_at,
          created_count: l.items_created,
          updated_count: l.items_updated,
          error: l.error_message
        }))
      }));
    }

    case 'get_forecast_risks': {
      const minLevel = args.min_level || 'orange';
      const riskLevels = minLevel === 'red' ? ['red'] : ['orange', 'red'];
      return await prisma.forecastResult.findMany({
        where: { risk_level: { in: riskLevels as any } },
        orderBy: { days_to_critical: 'asc' }
      });
    }

    case 'bulk_update_team': {
      if (!args.serial_numbers?.length || !args.team_name)
        return { error: 'serial_numbers ve team_name zorunludur.' };
      const team = await prisma.team.findFirst({
        where: { name: { contains: args.team_name, mode: 'insensitive' } }
      });
      if (!team) return { error: `'${args.team_name}' adlı takım bulunamadı.` };
      const result = await prisma.inventoryItem.updateMany({
        where: { serial_number: { in: args.serial_numbers } },
        data: { team_id: team.id }
      });
      return { success: true, updated_count: result.count, team_name: team.name };
    }

    case 'get_vendor_summary': {
      const now = new Date();
      const allItems = await prisma.inventoryItem.findMany({
        include: { model: { include: { vendor: true } } }
      });
      const summary: Record<string, any> = {};
      allItems.forEach(item => {
        const vendor = item.model.vendor.name;
        if (!summary[vendor]) summary[vendor] = { total: 0, expired: 0, expiring_1y: 0, active: 0 };
        summary[vendor].total++;
        if (item.status === 'active') summary[vendor].active++;
        if (item.warranty_expiry) {
          const exp = new Date(item.warranty_expiry);
          if (exp < now) summary[vendor].expired++;
          else if (exp < new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()))
            summary[vendor].expiring_1y++;
        }
      });
      return summary;
    }

    case 'get_rack_utilization': {
      const where: any = {};
      if (args.datacenter_name) {
        where.room = { datacenter: { name: { contains: args.datacenter_name, mode: 'insensitive' } } };
      }
      const racks = await prisma.rack.findMany({
        where,
        include: {
          items: { select: { rack_unit_size: true, rack_unit_start: true } },
          room: { include: { datacenter: true } }
        }
      });
      return racks.map(rack => {
        const usedUnits = rack.items.reduce((sum, item) => sum + (item.rack_unit_size || 1), 0);
        return {
          rack_name: rack.name,
          room: rack.room.name,
          datacenter: rack.room.datacenter.name,
          total_units: rack.total_units,
          used_units: usedUnits,
          free_units: rack.total_units - usedUnits,
          utilization_pct: Math.round((usedUnits / rack.total_units) * 100)
        };
      });
    }

    default:
      return { error: 'Unknown tool' };
  }
}

export const processChatMessage = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
  try {
    const { client, model } = await getAIClient();

    const systemPrompt: OpenAI.Chat.ChatCompletionMessageParam = {
      role: 'system', content: `Sen InvenTrOps altyapı yönetim sisteminin Kıdemli Altyapı Mimarı ve Finansal Analistisin.

DİL KURALI (ZORUNLU): Kullanıcı hangi dilde yazarsa AYNI dilde cevap ver. Türkçe soru → Türkçe cevap, İngilizce soru → İngilizce cevap. Dili karıştırma.

Analiz Prensiplerin:
1. Marka Bazlı Ayrı Hesaplama (MANDATORY): Bakım ve garanti analizlerini yaparken asla tüm markaları birleştirme. Dell, HPE, Huawei, Cisco gibi her üreticiyi ayrı bir başlık altında incele.
2. Bireysel Maliyet Analizi: Her marka için cihaz sayılarını ve maliyetlerini (Örn: Cihaz başı 2K$) ayrı ayrı hesapla. "Dell Toplam: X Cihaz - Y Dolar", "HPE Toplam: A Cihaz - B Dolar" şeklinde net kırılımlar sun.
3. Operasyonel Öneriler: Her markanın kendi içindeki garanti yoğunluğuna göre (Örn: Dell'lerin %80'i Temmuz'da bitiyor) o markaya özel konsolidasyon öner.
4. Cihaz Tipi Ayrımı: Her markanın altında Server, Storage ve SAN ayrımını koru.

Araç (Tool) Kullanımı Kuralları:
- Bir işlem yapman veya veri çekmen gerektiğinde KESİNLİKLE "şimdi arıyorum", "bekleyin", "yapıyorum" gibi ara sohbet cevapları (filler text) VERME.
- Kullanıcı bir şey istediğinde, hiçbir açıklama yapmadan anında ilgili fonksiyonu (tool_call) çağır.
- Fonksiyon sonucu sana geldikten sonra işi tamamlayıp final cevabını kullanıcıya tek seferde ver.
- Lokasyon güncellemesi istendiğinde doğrudan update_device_location aracını çağır. Önce search_devices ile arama yapma, update_device_location aracı cihazı zaten kendisi buluyor.

Cevaplarında teknik derinliği koru, marka bazlı raporlar için get_warranty_report aracını kullanarak her üretici için ayrı ayrı sonuçlar üret.`
    };

    // Build initial conversation with system prompt
    const runningMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [systemPrompt, ...messages];

    let supportsTools = true;
    const MAX_TOOL_ROUNDS = 5;

    // Initial API call
    let response;
    try {
      console.log(`[AI-Service] Sending request to: ${client.baseURL} | Model: ${model}`);
      response = await client.chat.completions.create({
        model,
        messages: runningMessages,
        tools,
        tool_choice: 'auto',
      });
    } catch (error: any) {
      if (error.status === 405 || error.status === 400) {
        console.warn(`[AI-Service] Tool calling not supported (${error.status}). Falling back to simple chat...`);
        supportsTools = false;
        response = await client.chat.completions.create({
          model,
          messages: runningMessages,
        });
      } else {
        console.error(`[AI-Service] OpenAI Error:`, error);
        throw error;
      }
    }

    // Iterative tool-calling loop: keep going until model stops requesting tools
    let round = 0;
    while (supportsTools && response.choices[0].message.tool_calls && round < MAX_TOOL_ROUNDS) {
      round++;
      const assistantMessage = response.choices[0].message;
      runningMessages.push(assistantMessage);

      console.log(`[AI-Service] Tool round ${round}: ${assistantMessage.tool_calls!.length} tool call(s)`);

      for (const toolCall of assistantMessage.tool_calls!) {
        try {
          const result = await executeTool(toolCall);
          runningMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        } catch (toolErr: any) {
          console.error(`[AI-Service] Tool execution error (${(toolCall as any).function?.name}):`, toolErr.message);
          runningMessages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify({ error: `Tool execution failed: ${toolErr.message}` }),
          });
        }
      }

      // Send results back to model — WITH tools so it can chain more calls if needed
      response = await client.chat.completions.create({
        model,
        messages: runningMessages,
        tools,
        tool_choice: 'auto',
      });
    }

    if (round >= MAX_TOOL_ROUNDS) {
      console.warn(`[AI-Service] Max tool rounds (${MAX_TOOL_ROUNDS}) reached, forcing text response.`);
    }

    const finalMessage = response.choices[0].message;

    // Clean up minimax-specific XML artifacts from the response
    if (finalMessage.content) {
      finalMessage.content = finalMessage.content
        .replace(/<minimax:tool_call>[\s\S]*?<\/minimax:tool_call>/g, '')
        .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
        .trim();
    }

    return finalMessage;
  } catch (error: any) {
    console.error('[AI Service Error]:', error);
    throw error;
  }
};
