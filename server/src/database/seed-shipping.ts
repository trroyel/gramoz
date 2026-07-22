import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import * as path from 'path';
import fetch from 'node-fetch';
import * as schema from './schema';
import { eq, and } from 'drizzle-orm';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const db = drizzle(pool, { schema });

const CITY_CORPORATIONS = [
  'Dhaka North',
  'Dhaka South',
  'Chattogram',
  'Rajshahi',
  'Khulna',
  'Barishal',
  'Sylhet',
  'Rangpur',
  'Mymensingh',
  'Cumilla',
  'Narayanganj',
  'Gazipur',
];

async function seed() {
  console.log('Seeding shipping zones...');

  try {
    // 1. Fetch Divisions
    const divRes = await fetch('https://bdapis.com/api/v1.2/divisions');
    const divData: any = await divRes.json();
    
    for (const d of divData.data) {
      const divName = d.division;
      
      // Upsert division
      let [division] = await db
        .select()
        .from(schema.divisions)
        .where(eq(schema.divisions.name, divName));
        
      if (!division) {
        [division] = await db.insert(schema.divisions).values({ name: divName }).returning();
      }

      // Fetch Districts for this division
      const distRes = await fetch(`https://bdapis.com/api/v1.2/division/${divName.toLowerCase()}`);
      const distData: any = await distRes.json();

      for (const dist of distData.data) {
        const distName = dist.district;
        
        let [district] = await db
          .select()
          .from(schema.districts)
          .where(and(eq(schema.districts.name, distName), eq(schema.districts.divisionId, division.id)));
          
        if (!district) {
          [district] = await db.insert(schema.districts).values({
            name: distName,
            divisionId: division.id,
          }).returning();
        }

        const upazilas: string[] = dist.upazilla || [];
        
        // Add City Corporation if it exists in our list for this district
        const ccName = CITY_CORPORATIONS.find(c => distName.includes(c) || c.includes(distName));
        if (ccName && !upazilas.includes(`${ccName} City Corporation`)) {
          upazilas.unshift(`${ccName} City Corporation`);
        } else if (distName === 'Dhaka') {
          if (!upazilas.includes('Dhaka North City Corporation')) upazilas.unshift('Dhaka North City Corporation');
          if (!upazilas.includes('Dhaka South City Corporation')) upazilas.unshift('Dhaka South City Corporation');
        }

        // Default Pricing Logic
        const isRajshahi = distName === 'Rajshahi';
        const defaultHomeDelivery = isRajshahi ? '60.00' : '120.00';
        const defaultBranchPickup = isRajshahi ? '40.00' : '100.00';
        
        for (const upz of upazilas) {
          // Check if City Corporation
          const isCC = upz.includes('City Corporation') || upz.includes('Sadar');
          
          // Make city corp slightly cheaper than remote upazilas
          const upzHomeDelivery = isCC ? defaultHomeDelivery : (parseFloat(defaultHomeDelivery) + 20).toFixed(2);
          const upzBranchPickup = isCC ? defaultBranchPickup : (parseFloat(defaultBranchPickup) + 20).toFixed(2);

          const existingZone = await db
            .select()
            .from(schema.zones)
            .where(and(eq(schema.zones.name, upz), eq(schema.zones.districtId, district.id)));

          if (existingZone.length === 0) {
            await db.insert(schema.zones).values({
              name: upz,
              districtId: district.id,
              homeDeliveryCharge: upzHomeDelivery,
              branchPickupCharge: upzBranchPickup,
              estimatedDays: isRajshahi ? '1-2 days' : '3-5 days'
            });
          }
        }
      }
      
      console.log(`Seeded division: ${divName} with its districts and zones.`);
    }

    console.log('Seeding completed successfully!');
  } catch (err) {
    console.error('Error seeding shipping zones:', err);
  } finally {
    await pool.end();
  }
}

seed();
