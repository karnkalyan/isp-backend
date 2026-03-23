const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_SERVICES = [
    {
        name: "TShul Billing",
        code: "TSHUL",
        description: "Billing and invoicing system",
        category: "BILLING",
        iconUrl: "/icons/tshul.svg"
    },
    {
        name: "FreeRadius",
        code: "RADIUS",
        description: "AAA authentication server",
        category: "AUTHENTICATION",
        iconUrl: "/icons/radius.svg"
    },
    // {
    //     name: "eSewa",
    //     code: "ESEWA",
    //     description: "Digital payment gateway",
    //     category: "PAYMENT",
    //     iconUrl: "/icons/esewa.svg"
    // },
    // {
    //     name: "Khalti",
    //     code: "KHALTI",
    //     description: "Digital payment gateway",
    //     category: "PAYMENT",
    //     iconUrl: "/icons/khalti.svg"
    // },
    {
        name: "NetTV",
        code: "NETTV",
        description: "IPTV streaming service",
        category: "STREAMING",
        iconUrl: "/icons/nettv.svg"
    },
    // {
    //     name: "Vianet",
    //     code: "VIANET",
    //     description: "Network management",
    //     category: "NETWORK",
    //     iconUrl: "/icons/vianet.svg"
    // },
    // {
    //     name: "Yeastar VoIP",
    //     code: "YEASTAR",
    //     description: "VoIP PBX system for telephony services",
    //     category: "VOIP",
    //     iconUrl: "/icons/yeastar.svg"
    // },
    // {
    //     name: "MikroTik",
    //     code: "MIKROTIK",
    //     description: "Router management API",
    //     category: "NETWORK",
    //     iconUrl: "/icons/mikrotik.svg"
    // },
    // {
    //     name: "Huawei OLT",
    //     code: "HUAWEI_OLT",
    //     description: "Huawei OLT management",
    //     category: "NETWORK",
    //     iconUrl: "/icons/huawei.svg"
    // },
    // {
    //     name: "ZTE OLT",
    //     code: "ZTE_OLT",
    //     description: "ZTE OLT management",
    //     category: "NETWORK",
    //     iconUrl: "/icons/zte.svg"
    // },
    // {
    //     name: "FortiGate",
    //     code: "FORTIGATE",
    //     description: "Fortinet firewall management",
    //     category: "SECURITY",
    //     iconUrl: "/icons/fortigate.svg"
    // },
    // {
    //     name: "CRM",
    //     code: "CRM",
    //     description: "Customer Relationship Management",
    //     category: "OTHER",
    //     iconUrl: "/icons/crm.svg"
    // },
    // {
    //     name: "Ticketing System",
    //     code: "TICKETING",
    //     description: "Customer support ticketing system",
    //     category: "OTHER",
    //     iconUrl: "/icons/ticketing.svg"
    // },
    // {
    //     name: "SMS Gateway",
    //     code: "SMS_GATEWAY",
    //     description: "Bulk SMS sending service",
    //     category: "COMMUNICATION",
    //     iconUrl: "/icons/sms.svg"
    // },
    // {
    //     name: "Email Service",
    //     code: "EMAIL_SERVICE",
    //     description: "Bulk email sending service",
    //     category: "COMMUNICATION",
    //     iconUrl: "/icons/email.svg"
    // },
    {
        name: "GenieACS",
        code: "GENIEACS",
        description: "Auto Configuration Server for TR-069 devices",
        category: "ACS",
        iconUrl: "/icons/genieacs.svg"
    }
];

async function setupDefaultServices() {
    try {
        console.log('🔧 Setting up default services...');

        let createdCount = 0;
        let updatedCount = 0;

        for (const service of DEFAULT_SERVICES) {
            try {
                const existing = await prisma.service.findUnique({
                    where: { code: service.code }
                });

                if (!existing) {
                    await prisma.service.create({
                        data: service
                    });
                    console.log(`✅ Created service: ${service.name} (${service.code})`);
                    createdCount++;
                } else {
                    await prisma.service.update({
                        where: { id: existing.id },
                        data: {
                            name: service.name,
                            description: service.description,
                            category: service.category,
                            iconUrl: service.iconUrl,
                            isActive: true
                        }
                    });
                    console.log(`↻ Updated service: ${service.name} (${service.code})`);
                    updatedCount++;
                }
            } catch (serviceError) {
                console.error(`❌ Error processing service ${service.code}:`, serviceError.message);
            }
        }

        console.log('\n📊 Setup Summary:');
        console.log(`   Total services: ${DEFAULT_SERVICES.length}`);
        console.log(`   Created: ${createdCount}`);
        console.log(`   Updated: ${updatedCount}`);
        console.log(`   Failed: ${DEFAULT_SERVICES.length - (createdCount + updatedCount)}`);

        console.log('\n🎉 Default services setup completed!');

    } catch (error) {
        console.error('❌ Error setting up default services:', error);
        console.error('Stack trace:', error.stack);
    } finally {
        await prisma.$disconnect();
    }
}

// Run if called directly
if (require.main === module) {
    setupDefaultServices();
}

module.exports = {
    setupDefaultServices,
    DEFAULT_SERVICES
};