import { prisma } from '../lib/prisma';

export const auditLog = async (userId: number | null, action: string, details: string, teamId: number | null = null) => {
  try {
    // In a real system, you might use a dedicated AuditLog table.
    // Since we don't have one in the current schema, we log to stdout for now
    // with a specific format that can be ingested by log collectors.
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      userId,
      teamId,
      action,
      details,
      severity: action.includes('FAILED') ? 'WARN' : 'INFO'
    };
    
    console.log(`[AUDIT] ${JSON.stringify(logEntry)}`);
    
    // Potential: await prisma.auditLog.create({ data: { ... } });
  } catch (err) {
    console.error('Failed to write audit log:', err);
  }
};
