import ldap from 'ldapjs';
import { prisma } from '../lib/prisma';
import { decrypt } from '../utils/crypto';

/**
 * Async wrapper for LDAP bind operation
 */
const bindAsync = (client: ldap.Client, dn: string, password: string): Promise<void> => {
  return new Promise((resolve, reject) => {
    client.bind(dn, password, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
};

/**
 * Async wrapper for LDAP search operation
 */
const searchAsync = (client: ldap.Client, base: string, options: ldap.SearchOptions): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    client.search(base, options, (err, res) => {
      if (err) return reject(err);

      const entries: any[] = [];
      res.on('searchEntry', (entry: any) => {
        entries.push(entry.object);
      });
      res.on('error', (error) => {
        reject(error);
      });
      res.on('end', () => {
        resolve(entries);
      });
    });
  });
};

export const authenticateLDAP = async (username: string, password: string) => {
  const config = await prisma.lDAPConfig.findFirst({ where: { is_active: true } });
  if (!config) return null;

  const client = ldap.createClient({
    url: config.server_uri,
    tlsOptions: config.ca_certificate ? { ca: [config.ca_certificate] } : { rejectUnauthorized: false }
  });

  try {
    const bindDn = config.bind_dn || '';
    const bindPass = config.bind_password ? decrypt(config.bind_password) : '';
    await bindAsync(client, bindDn, bindPass);

    const entries = await searchAsync(client, config.user_search_base, {
      filter: `(|(sAMAccountName=${username})(uid=${username}))`,
      scope: 'sub',
      attributes: ['givenName', 'sn', 'mail', 'cn']
    });

    if (!entries || entries.length === 0) {
      client.destroy();
      return null;
    }

    const userEntry = entries[0];

    // Verify user password by binding with their DN
    const userClient = ldap.createClient({ url: config.server_uri });
    try {
      await bindAsync(userClient, userEntry.dn, password);
    } catch (authError) {
      userClient.destroy();
      client.destroy();
      return null;
    }
    userClient.destroy();
    client.destroy();

    // LDAP valid, sync user to DB
    const email = userEntry.mail || `${username}@domain.local`;
    const first_name = userEntry.givenName || '';
    const last_name = userEntry.sn || userEntry.cn || '';

    let user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          username,
          password: 'ldap-auth-no-local-password',
          email,
          first_name,
          last_name,
          role: 'viewer'
        }
      });
    } else if (user.email !== email || user.first_name !== first_name || user.last_name !== last_name) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { email, first_name, last_name }
      });
    }

    return user;
  } catch (error) {
    client.destroy();
    return null;
  }
};
