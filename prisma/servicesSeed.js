// prisma/seed.js
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Starting database seed...");

  //===================================================================
  // 1. Core ISP & Admin User Creation
  //===================================================================
  console.log("\n--- Section 1: Creating Core ISP and Admin ---");

  const hashedPassword = await bcrypt.hash("kalyan_vickey", 10);

  const isp = await prisma.iSP.upsert({
    where: { masterEmail: "karnkalyan@gmail.com" },
    update: {},
    create: {
      companyName: "Simulcast Technologies Pvt. Ltd.",
      businessType: "IT & ISP",
      website: "https://simulcast.com",
      contactPerson: "Kalyan Kumar Karn",
      phoneNumber: "+9779814823222",
      masterEmail: "karnkalyan@gmail.com",
      passwordHash: hashedPassword,
      description: "ISP & IT Solutions provider in Kathmandu",
      address: "Pepsi Cola",
      city: "Kathmandu",
      state: "Bagmati",
      zipCode: "44600",
      country: "Nepal",
      asnNumber: "AS64512",
      ipv4Blocks: "103.x.x.x/29",
      upstreamProviders: "NDS, Techminds",
      logoUrl: "https://example.com/logo.png",
    },
  });
  console.log("✅ ISP ready:", isp.companyName);

  const adminRole = await prisma.role.upsert({
    where: { name: "Administrator" },
    update: {},
    create: { name: "Administrator" },
  });
  console.log("✅ Role ready:", adminRole.name);

  const adminUser = await prisma.user.upsert({
    where: { email: "karnkalyan@gmail.com" },
    update: {},
    create: {
      email: "karnkalyan@gmail.com",
      passwordHash: hashedPassword,
      name: "System Administrator",
      status: "active",
      ispId: isp.id,
      roleId: adminRole.id,
    },
  });
  console.log("✅ Administrator ready:", adminUser.email);


  console.log("\n🌱 Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });