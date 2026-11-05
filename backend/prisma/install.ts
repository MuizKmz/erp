/**
 * Sets up a new client on the database in DATABASE_URL. Run the migrations first.
 *
 *   npx prisma migrate deploy
 *   npm run client:install -- path/to/client.json
 *
 * prisma/client.example.json shows the file. Then start the server with DEV_TENANT_CODE set to the tenant's code and open
 * the printed link once to choose the administrator's password. The link is a secret: do not paste it into tickets or logs.
 */
import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { installClient, type ClientConfig } from './install/install-client';

async function main(): Promise<void> {
  const file = process.argv[2];
  if (!file) throw new Error('Give the client file: npm run client:install -- path/to/client.json');
  const config = JSON.parse(readFileSync(file, 'utf8')) as ClientConfig;

  const prisma = new PrismaClient();
  try {
    const result = await installClient(prisma, config, process.env.APP_URL || 'http://localhost:5173');
    console.log(`\nInstalled ${config.tenant.name} (${config.tenant.code}).`);
    console.log(`Start the server with DEV_TENANT_CODE=${config.tenant.code} and AUTH_MODE=jwt.`);
    console.log(`\n${result.adminCode} chooses a password here, once, before ${result.expiresAt.toISOString()}:\n${result.setPasswordUrl}\n`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
