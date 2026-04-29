import OpenAI from 'openai';
import { prisma } from '../lib/prisma';
import dotenv from 'dotenv';
import https from 'https';

dotenv.config();

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
        apiKey: config.api_key || '',
        baseURL: config.url,
        httpAgent: httpsAgent
      } as any),
      model: config.username || 'llama3' // Model adını username alanında saklayabiliriz
    };
  }

  // Fallback to .env
  return {
    client: new OpenAI({
      apiKey: process.env.AI_API_KEY || 'sk-placeholder',
      baseURL: process.env.AI_API_BASE_URL || 'http://your-company-ai-api.local/v1',
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
  }
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
          model: args.vendor ? { vendor: { name: { contains: args.vendor, mode: 'insensitive' } } } : undefined,
        },
        include: { model: { include: { vendor: true } } },
        take: 5
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

    default:
      return { error: 'Unknown tool' };
  }
}

export const processChatMessage = async (messages: OpenAI.Chat.ChatCompletionMessageParam[]) => {
  try {
    const { client, model } = await getAIClient();

    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: 'Sen InvenTrOps altyapı yönetim sisteminin akıllı asistanısın. Envanter verilerine erişebilir ve güncelleyebilirsin. Kısa ve net cevaplar ver.' },
        ...messages
      ],
      tools,
      tool_choice: 'auto',
    });

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
