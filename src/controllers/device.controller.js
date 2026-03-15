// controllers/device.controller.js
const getDriver = require('../drivers');

const executeDeviceAction = async (req, res) => {
    let driver;
    try {
        const deviceId = parseInt(req.params.id);
        const { action, params = {} } = req.body;

        // Fetch device from DB
        const device = await req.prisma.oLT.findUnique({
            where: { id: deviceId }
        });

        if (!device) {
            return res.status(404).json({
                success: false,
                message: 'Device not found'
            });
        }

        // Load proper driver
        driver = getDriver(device);

        // Connect to device
        await driver.connect();

        // Execute action dynamically
        if (typeof driver[action] !== 'function') {
            driver.ssh.close();
            return res.status(400).json({
                success: false,
                message: 'Unsupported action'
            });
        }

        // Execute based on parameter type
        let result;
        if (typeof params === 'object' && !Array.isArray(params) && params !== null) {
            // Object parameter (most methods)
            result = await driver[action](params);
        } else if (Array.isArray(params)) {
            // Array of parameters
            result = await driver[action](...params);
        } else if (action === 'executeCommand' && typeof params === 'string') {
            // For executeCommand with string parameter
            result = await driver.executeCommand(params);
        } else {
            // Single parameter or no parameter
            result = await driver[action](params);
        }

        // Close connection
        driver.ssh.close();

        res.json({
            success: true,
            data: result
        });

    } catch (err) {
        console.error('Device action error:', err);
        if (driver && driver.ssh) {
            driver.ssh.close();
        }
        res.status(500).json({
            success: false,
            error: err.message
        });
    }
};

module.exports = {
    executeDeviceAction
};