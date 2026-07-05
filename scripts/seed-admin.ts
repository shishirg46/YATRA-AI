import "dotenv/config";
import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../app/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type AdminData = {
  provinces: { name: string; districts: string[] }[];
};

async function main() {
  const admin = JSON.parse(
    readFileSync(join(__dirname, "data/nepal-admin.json"), "utf-8"),
  ) as AdminData;

  let provinceCount = 0;
  let districtCount = 0;

  for (const prov of admin.provinces) {
    const province = await prisma.province.upsert({
      where: { name: prov.name },
      create: { name: prov.name },
      update: {},
    });
    provinceCount++;

    for (const distName of prov.districts) {
      await prisma.district.upsert({
        where: {
          name_provinceId: { name: distName, provinceId: province.id },
        },
        create: { name: distName, provinceId: province.id },
        update: {},
      });
      districtCount++;
    }
  }

  console.log(`Seeded ${provinceCount} provinces and ${districtCount} districts`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
