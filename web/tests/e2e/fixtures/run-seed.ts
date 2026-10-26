import { seedE2EFixtures } from './seed';

async function main() {
  console.log('Seeding E2E fixtures...');
  await seedE2EFixtures();
  console.log('E2E fixtures seeded successfully!');
}

main().catch((err) => {
  console.error('Failed to seed fixtures:', err);
  process.exit(1);
});
