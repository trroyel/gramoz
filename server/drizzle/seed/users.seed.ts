import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from '../../src/database/schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://platform_user:platform_pass@localhost:5433/platform_db',
});

const db = drizzle(pool, { schema });

async function seed() {
  console.log('🌱 Seeding database...');

  try {
    // Insert sample users
    await db.insert(schema.users).values([
      {
        email: 'admin@gramoz.com',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$KwkIzEJjLsqv2eW6K1sphg$uAmZCxfvI7qxYCTDvai+vOAfRaAsd/C1I+F5tkD49Ns', // password: password123
        fullName: 'Admin User',
        phone: '+8801712345678',
        provider: 'local',
        role: 'super_admin', //admin, support, manager,customer
        isEmailVerified: true,
        isPhoneVerified: true,
        status: 'active',
      },
    ]);

    console.log('✅ Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seed failed:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

seed();
