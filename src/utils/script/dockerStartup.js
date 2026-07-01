const { execSync } = require('child_process');
const prisma = require('../../../prisma/client.js');

async function main() {
  execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });

  const userCount = await prisma.user.count();
  const forceSeed = String(process.env.FORCE_FULL_SEED || '').toLowerCase() === 'true';

  if (forceSeed || userCount === 0) {
    console.log('[docker-startup] Empty database detected; running default full seed and services seed.');
    execSync('npm run defaultFullSeed', { stdio: 'inherit' });
    execSync('npm run servicesSeed', { stdio: 'inherit' });
  } else {
    console.log(`[docker-startup] Database already has ${userCount} user(s); skipping destructive full seed.`);
  }
}

main()
  .catch((error) => {
    console.error('[docker-startup] Failed:', error.message);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
