#!/usr/bin/env ts-node
/**
 * One-time migration script: Encrypts existing plain-text passwords
 * in IntegrationConfig and LDAPConfig tables.
 *
 * Run ONCE after deploying the encryption feature:
 *   npx ts-node src/scripts/encrypt-existing-secrets.ts
 */
import { prisma } from '../lib/prisma';
import { encrypt, isEncrypted } from '../utils/crypto';

async function main() {
  console.log('[Migration] Starting secret encryption migration...');

  // --- IntegrationConfig passwords ---
  const integrations = await prisma.integrationConfig.findMany();
  let intEncrypted = 0;

  for (const cfg of integrations) {
    const updates: any = {};

    if (cfg.password && !isEncrypted(cfg.password)) {
      updates.password = encrypt(cfg.password);
      intEncrypted++;
    }
    if (cfg.api_key && !isEncrypted(cfg.api_key)) {
      updates.api_key = encrypt(cfg.api_key);
    }

    if (Object.keys(updates).length > 0) {
      await prisma.integrationConfig.update({ where: { id: cfg.id }, data: updates });
    }
  }

  console.log(`[Migration] IntegrationConfig: ${intEncrypted} password(s) encrypted.`);

  // --- LDAPConfig bind_password ---
  const ldapConfigs = await prisma.lDAPConfig.findMany();
  let ldapEncrypted = 0;

  for (const ldap of ldapConfigs) {
    if (ldap.bind_password && !isEncrypted(ldap.bind_password)) {
      await prisma.lDAPConfig.update({
        where: { id: ldap.id },
        data: { bind_password: encrypt(ldap.bind_password) }
      });
      ldapEncrypted++;
    }
  }

  console.log(`[Migration] LDAPConfig: ${ldapEncrypted} password(s) encrypted.`);
  console.log('[Migration] Done. ✓');
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('[Migration] Failed:', err);
  process.exit(1);
});
