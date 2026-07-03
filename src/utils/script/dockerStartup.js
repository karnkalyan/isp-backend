const { execSync } = require('child_process');
const prisma = require('../../../prisma/client.js');

async function main() {
  console.log('[docker-startup] Applying additive Prisma schema changes without accepting data loss.');
  execSync('npx prisma db push', { stdio: 'inherit' });

  const userCount = await prisma.user.count();
  const forceSeed = String(process.env.FORCE_FULL_SEED || '').toLowerCase() === 'true';

  if (forceSeed || userCount === 0) {
    console.log('[docker-startup] Empty database detected; running default full seed.');
    execSync('npm run defaultFullSeed', { stdio: 'inherit' });
  } else {
    console.log(`[docker-startup] Database already has ${userCount} user(s); skipping destructive full seed.`);
  }

  // This seed only upserts catalog definitions. It never deletes ISP service
  // configuration or credentials, so it is safe on every container startup.
  console.log('[docker-startup] Updating service catalog definitions.');
  execSync('npm run servicesSeed', { stdio: 'inherit' });
  execSync('npm run services:update-accounting', { stdio: 'inherit' });
}

main()
  .catch((error) => {
    console.error('[docker-startup] Failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
