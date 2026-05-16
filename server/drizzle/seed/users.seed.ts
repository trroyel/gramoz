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
        passwordHash: '$2b$10$rZ5qH8qH8qH8qH8qH8qH8uO', // password: admin123 (hash this properly in production)
        fullName: 'Admin User',
        phone: '+8801712345678',
        isEmailVerified: true,
        isPhoneVerified: true,
        status: 'active',
      },
      {
        email: 'seller@gramoz.com',
        passwordHash: '$2b$10$rZ5qH8qH8qH8qH8qH8qH8uO', // password: seller123
        fullName: 'Rural Seller',
        phone: '+8801812345678',
        isEmailVerified: true,
        isPhoneVerified: false,
        status: 'active',
      },
      {
        email: 'customer@gramoz.com',
        passwordHash: '$2b$10$rZ5qH8qH8qH8qH8qH8qH8uO', // password: customer123
        fullName: 'Customer User',
        phone: '+8801912345678',
        isEmailVerified: false,
        isPhoneVerified: false,
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
