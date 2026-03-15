const express = require('express');
const { ServiceController } = require('../controllers/services.controller');
const isAuthenticated = require('../middlewares/isAuthenticated');
const checkPermission = require('../middlewares/checkPermission');

module.exports = (prisma) => {
    const router = express.Router();
    const serviceController = new ServiceController(prisma);

    // Apply isAuthenticated middleware
    router.use(isAuthenticated(prisma));

    // ==================== PUBLIC SERVICE CATALOG ====================
    router.get('/catalog', serviceController.getAllServices.bind(serviceController));
    router.get('/catalog/:code', serviceController.getServiceByCode.bind(serviceController));

    // ==================== ISP-SPECIFIC SERVICE MANAGEMENT ====================
    router.get('/isp', checkPermission('services_read'), serviceController.getISPActiveServices.bind(serviceController));
    router.get('/isp/status', checkPermission('services_read'), serviceController.getAllServiceStatuses.bind(serviceController));
    router.get('/isp/status/:serviceCode', checkPermission('services_read'), serviceController.getServiceStatus.bind(serviceController));

    router.post('/isp/configure', checkPermission('services_create'), serviceController.configureServiceForISP.bind(serviceController));
    router.post('/isp/:serviceCode/credentials', checkPermission('services_update'), serviceController.setServiceCredentials.bind(serviceController));
    router.patch('/isp/:serviceCode/activation', checkPermission('services_update'), serviceController.toggleServiceActivation.bind(serviceController));
    router.get('/isp/:serviceCode/test', checkPermission('services_read'), serviceController.testServiceConnection.bind(serviceController));

    // ==================== PROVISIONING & BULK OPERATIONS ====================
    router.post('/provision/default', checkPermission('services_manage'), serviceController.provisionDefaultServices.bind(serviceController));
    router.post('/enable-all', checkPermission('services_manage'), serviceController.enableAllServices.bind(serviceController));
    router.post('/disable-all', checkPermission('services_manage'), serviceController.disableAllServices.bind(serviceController));
    router.post('/test-all', checkPermission('services_test'), serviceController.testAllServices.bind(serviceController));
    router.post('/bulk-operations', checkPermission('services_manage'), serviceController.bulkOperations.bind(serviceController));
    router.get('/analytics', checkPermission('services_read'), serviceController.getServiceAnalytics.bind(serviceController));

    // ==================== SERVICE-SPECIFIC OPERATIONS ====================

    // NetTV Operations
    router.get('/nettv/countries', checkPermission('services_read'), serviceController.countriesProvince.bind(serviceController));
    router.get('/nettv/subscribers', checkPermission('services_read'), serviceController.getNetTVSubscribers.bind(serviceController));
    router.get('/nettv/subscribers/:username', checkPermission('services_read'), serviceController.getNetTVSubscriber.bind(serviceController));
    router.post('/nettv/subscribers', checkPermission('services_create'), serviceController.createNetTVSubscriber.bind(serviceController));

    // Mikrotik Operations
    router.get('/mikrotik/resources', checkPermission('services_read'), serviceController.getMikrotikResources.bind(serviceController));
    router.get('/mikrotik/interfaces', checkPermission('services_read'), serviceController.getMikrotikInterfaces.bind(serviceController));
    router.get('/mikrotik/dhcp-leases', checkPermission('services_read'), serviceController.getMikrotikDHCPLeases.bind(serviceController));

    // Yeastar Operations
    router.get('/yeastar/extensions', checkPermission('services_read'), serviceController.getYeastarExtensions.bind(serviceController));
    router.get('/yeastar/active-calls', checkPermission('services_read'), serviceController.getYeastarActiveCalls.bind(serviceController));
    router.get('/yeastar/system-info', checkPermission('services_read'), serviceController.getYeastarSystemInfo.bind(serviceController));

    // Tshul Operations
    router.get('/tshul/customers', checkPermission('services_read'), serviceController.getTshulCustomers.bind(serviceController));
    router.post('/tshul/customers', checkPermission('services_create'), serviceController.createTshulCustomer.bind(serviceController));
    router.get('/tshul/customers/:refrenceId', checkPermission('services_read'), serviceController.getTshulCustomersbyId.bind(serviceController));

    // Radius Operations
    router.get('/radius/users', checkPermission('services_read'), serviceController.getRadiusUsers.bind(serviceController));
    router.get('/radius/act/:username', checkPermission('services_create'), serviceController.getRadiusAccountbyUser.bind(serviceController));
    router.get('/radius/users/:username', checkPermission('services_read'), serviceController.getRadiusUser.bind(serviceController));
    router.post('/radius/users', checkPermission('services_create'), serviceController.createRadiusUser.bind(serviceController));

    router.delete('/radius/users/:username', checkPermission('services_delete'), serviceController.deleteRadiusUser.bind(serviceController));
    router.get('/radius/stats', checkPermission('services_read'), serviceController.getRadiusStats.bind(serviceController));
    router.post('/radius/test-auth', checkPermission('services_test'), serviceController.testRadiusAuth.bind(serviceController));

    // eSewa Operations
    router.post('/esewa/payment', checkPermission('services_manage'), serviceController.processEsewaPayment.bind(serviceController));
    router.get('/esewa/payment/verify/:transactionId', checkPermission('services_read'), serviceController.verifyEsewaPayment.bind(serviceController));

    // Khalti Operations
    router.post('/khalti/payment', checkPermission('services_manage'), serviceController.processKhaltiPayment.bind(serviceController));
    router.get('/khalti/payment/verify/:token', checkPermission('services_read'), serviceController.verifyKhaltiPayment.bind(serviceController));



    // ==================== GENIEACS OPERATIONS ====================
    router.get('/genieacs/devices/uptime', checkPermission('services_read'), serviceController.refreshUptime.bind(serviceController));
    router.get('/genieacs/devices', checkPermission('services_read'), serviceController.getGenieACSDevices.bind(serviceController));
    router.get('/genieacs/devices/:serialNumber', checkPermission('services_read'), serviceController.getGenieACSDeviceBySerial.bind(serviceController));

    router.get('/genieacs/devices/:serialNumber/deviceinfo', checkPermission('services_read'), serviceController.getGenieACSDeviceInfo.bind(serviceController));

    router.get('/genieacs/devices/:serialNumber/waninfo', checkPermission('services_read'), serviceController.getGenieACSDeviceWanInfo.bind(serviceController));


    router.get('/genieacs/devices/:serialNumber/wlaninfo', checkPermission('services_read'), serviceController.getGenieACSDeviceWlanInfo.bind(serviceController));


    router.get('/genieacs/devices/:serialNumber/connected-devices-info', checkPermission('services_read'), serviceController.getGenieACSDeviceConnectedDevicesInfo.bind(serviceController));



    router.get('/genieacs/devices/:serialNumber/laninfo', checkPermission('services_read'), serviceController.getGenieACSDeviceLANInfo.bind(serviceController));

    router.get('/genieacs/devices/:serialNumber/status', checkPermission('services_read'), serviceController.getGenieACSDeviceStatus.bind(serviceController));
    router.get('/genieacs/devices/:serialNumber/connected-clients', checkPermission('services_read'), serviceController.getGenieACSConnectedClients.bind(serviceController));
    router.get('/genieacs/devices/:serialNumber/tasks', checkPermission('services_read'), serviceController.getGenieACSDeviceTasks.bind(serviceController));


    router.post('/genieacs/devices/:serialNumber/create-wan-connection', checkPermission('services_read'), serviceController.createwanipconnenctiondump.bind(serviceController));


    router.post('/genieacs/devices/:serialNumber/delete-wan-connection', checkPermission('services_delete'), serviceController.deleteWanConnection.bind(serviceController));

    router.post('/genieacs/devices/:serialNumber/ssid-operations', checkPermission('services_manage'), serviceController.enableDisableSSID.bind(serviceController));



    router.post('/genieacs/devices/:serialNumber/refresh', checkPermission('services_manage'), serviceController.refreshGenieACSObject.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/configure-wifi', checkPermission('services_manage'), serviceController.configureGenieACSWiFi.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/enable-acl', checkPermission('services_manage'), serviceController.enableGenieACSACL.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/reboot', checkPermission('services_manage'), serviceController.rebootGenieACSDevice.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/factory-reset', checkPermission('services_manage'), serviceController.factoryResetGenieACSDevice.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/upgrade-firmware', checkPermission('services_manage'), serviceController.triggerGenieACSFirmwareUpgrade.bind(serviceController));
    router.post('/genieacs/devices/:serialNumber/provision', checkPermission('services_manage'), serviceController.provisionGenieACSPPPoEWiFi.bind(serviceController));


    router.post('/genieacs/devices/:serialNumber/update-wifi-all-pwd', checkPermission('services_manage'), serviceController.updateAllSSIDPassword.bind(serviceController));


    router.post('/genieacs/devices/:serialNumber/update-wifi', checkPermission('services_manage'), serviceController.updateSpecificSSID.bind(serviceController));

    // ==================== HEALTH CHECK ====================
    router.get('/health', (req, res) => {
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            version: '1.0.0',
            services: {
                TSHUL: 'Available',
                RADIUS: 'Available',
                NETTV: 'Available',
                YEASTAR: 'Available',
                MIKROTIK: 'Available',
                ESEWA: 'Available',
                KHALTI: 'Available'
            }
        });
    });

    return router;
};