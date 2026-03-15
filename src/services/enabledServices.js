// ✅ Import Prisma once at the top of the file
const prisma = require('../../prisma/client.js');

/**
 * Checks if a specific service is active and enabled for an ISP.
 *
 * @param {number} ispId - The ID of the ISP.
 * @param {number} serviceId - The ID of the service to check.
 * @returns {Promise<boolean>} True if the service is enabled, otherwise false.
 */
async function isServiceEnabled(ispId, serviceId) {
  // 1. Basic validation
  if (!ispId || !serviceId) {
    console.error('isServiceEnabled: Missing ispId or serviceId.');
    return false;
  }

  try {
    // 2. Use prisma.count for an efficient existence check
    const count = await prisma.iSPService.count({
      where: {
        ispId: Number(ispId),
        serviceId: Number(serviceId),
        // ❗ Crucially, check that the service is actually turned on
        isActive: true,
        isEnabled: true,
      },
    });

    // 3. If the count is greater than 0, the record exists and is enabled.
    return count > 0;
  } catch (error) {
    console.error('Error checking service enabled status:', error);
    // Return false in case of an error to prevent accidental access
    return false;
  }
}

// Export the function so it can be used in your controllers
const SERVICES = {
  TSHUL: 1,
  RADIUS: 4,
  ESEWA: 2,
  KHALTI: 3,
  NETTV: 5,
  VIANET: 6,
};

module.exports = {
  isServiceEnabled,
  SERVICES,
};
