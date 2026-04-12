import ldap from 'ldapjs';
import { prisma } from '../lib/prisma';

export const authenticateLDAP = async (username: string, password: string) => {
  const config = await prisma.lDAPConfig.findFirst({ where: { is_active: true } });
  if (!config) return null;

  const client = ldap.createClient({
    url: config.server_uri,
    tlsOptions: config.ca_certificate ? { ca: [config.ca_certificate] } : { rejectUnauthorized: false }
  });

  return new Promise((resolve, reject) => {
    client.bind(config.bind_dn || '', config.bind_password || '', (err) => {
      if (err) {
        client.destroy();
        return resolve(null);
      }

      const opts: ldap.SearchOptions = {
        filter: `(|(sAMAccountName=${username})(uid=${username}))`,
        scope: 'sub',
        attributes: ['givenName', 'sn', 'mail', 'cn']
      };

      client.search(config.user_search_base, opts, (err, res) => {
        if (err) {
          client.destroy();
          return resolve(null);
        }

        let userEntry: any = null;

        res.on('searchEntry', (entry: any) => {
          userEntry = entry.object;
        });

        res.on('error', (err) => {
          client.destroy();
          resolve(null);
        });

        res.on('end', (result) => {
          if (!userEntry) {
            client.destroy();
            return resolve(null);
          }

          // Verify user password by binding with their DN
          const userClient = ldap.createClient({ url: config.server_uri });
          userClient.bind(userEntry.dn, password, async (err) => {
            userClient.destroy();
            client.destroy();

            if (err) return resolve(null);

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
            } else if (user.email !== email) {
              user = await prisma.user.update({
                where: { id: user.id },
                data: { email, first_name, last_name }
              });
            }

            resolve(user);
          });
        });
      });
    });
  });
};
