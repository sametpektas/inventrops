import OpenAI from 'openai';
import { prisma } from '../lib/prisma';
import dotenv from 'dotenv';
import https from 'https';
import { decrypt } from '../utils/crypto';

dotenv.config();

// SSL Sertifika doğrulamasını tamamen devre dışı bırak (Şirket içi self-signed sertifikalar için)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

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
        httpAgent: httpsAgent
      } as any),
      model: config.username || 'llama3' // Model adını username alanında saklayabiliriz
    };
  }

  // Fallback to .env
  return {
    client: new OpenAI({
      apiKey: process.env.AI_API_KEY || 'sk-placeholder',
      baseURL: sanitizeBaseUrl(process.env.AI_API_BASE_URL || 'http://your-company-ai-api.local/v1'),
      httpAgent: httpsAgent
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
      name: 'move_device',
      description: 'Bir cihazı farklı bir kabinete (rack) veya pozisyona taşır.',
      parameters: {
        type: 'object',
        properties: {
          serial_number: { type: 'string', description: 'Cihazın seri numarası' },
          rack_id: { type: 'number', description: 'Yeni kabinet (rack) ID numarası' },
          position: { type: 'number', description: 'Kabinet içindeki başlangıç U pozisyonu' },
        },
        required: ['serial_number', 'rack_id', 'position'],
      },
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
            ]
          },
          warranty_expiry: {
            lte: args.warranty_before ? new Date(args.warranty_before) : undefined,
            gte: args.warranty_after ? new Date(args.warranty_after) : undefined,
          }
        },
        include: { model: { include: { vendor: true } } },
        take: 50 // Daha fazla sonuç alabilmesi için sınırı artırdık
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
      const typeGroups = await prisma.inventoryItem.groupBy({ by: ['status'] as any, _count: true }); // device_type check
      return { total: totalCount, statusDistribution: statusGroups, typeDistribution: typeGroups };

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

    case 'move_device':
      return await prisma.inventoryItem.update({
        where: { serial_number: args.serial_number },
        data: { rack_id: args.rack_id, rack_position: args.position }
      });

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
      return await prisma.forecastMetricSnapshot.findMany({
        where: { metric_name: args.metric },
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

    default:
      return { error: 'Unknown tool' };
  }
}

export const processChatMessage = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
  try {
    const { client, model } = await getAIClient();

    let response;
    const conversation: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: `Sen InvenTrOps altyapı yönetim sisteminin uzman asistanısın. 
Aşağıdaki genişletilmiş yeteneklere sahipsin:
1. Envanter Yönetimi: Cihaz arama, detaylı raporlama, Hostname/IP adresi güncelleme, not/garanti güncelleme ve cihaz taşıma.
2. Denetim (Audit): IP çakışmaları, kabinete yerleştirilmemiş cihazlar ve çevrimdışı sistemlerin tespiti.
3. Kapasite & Storage Analizi: CPU, RAM ve Storage havuzlarını analiz etme, doluluk oranlarını raporlama.
4. Lokasyon Raporlama: Veri merkezi ve kabinet doluluklarını analiz etme.
Kullanıcının "Şu cihazın IP'sini X.X.X.X olarak değiştir" veya "Hostname bilgisini Y yap" gibi taleplerini update_device_info aracını kullanarak gerçekleştir. Teknik, güvenilir ve proaktif ol.` },
      ...messages
    ];

    try {
      console.log(`[AI-Service] Sending request to: ${client.baseURL} | Model: ${model}`);
      response = await client.chat.completions.create({
        model,
        messages: conversation,
        tools,
        tool_choice: 'auto',
      });
    } catch (error: any) {
      // Eğer model tools (fonksiyon çağırma) desteklemiyorsa (405 veya 400), normal chat olarak dene
      if (error.status === 405 || error.status === 400) {
        console.warn(`[AI-Service] Tool calling not supported (${error.status}). Falling back to simple chat...`);
        response = await client.chat.completions.create({
          model,
          messages: conversation,
        });
      } else {
        console.error(`[AI-Service] OpenAI Error:`, error);
        throw error;
      }
    }

    const responseMessage = response.choices[0].message;

    // Eğer model bir fonksiyon çağırmak istiyorsa
    if (responseMessage.tool_calls) {
      const toolCalls = responseMessage.tool_calls;
      const availableMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [...messages, responseMessage];

      for (const toolCall of toolCalls) {
        const result = await executeTool(toolCall);
        availableMessages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Sonucu modele geri gönderip final cevabı alıyoruz
      const finalResponse = await client.chat.completions.create({
        model,
        messages: availableMessages,
      });

      return finalResponse.choices[0].message;
    }

    return responseMessage;
  } catch (error: any) {
    console.error('[AI Service Error]:', error);
    throw error;
  }
};
