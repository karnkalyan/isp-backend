// drivers/index.js
const HuaweiOLTDriver = require('./huawei/HuaweiOLTDriver');
const CiscoSwitchDriver = require('./cisco/CiscoSwitchDriver');
const BdcomOLTDriver = require('./bdcom/BdcomOLTDriver');

module.exports = function getDriver(device) {
    // console.log("Device info", device);

    switch (device.vendor) {
        case 'Huawei': return new HuaweiOLTDriver(device);
        case 'Cisco': return new CiscoSwitchDriver(device);
        case 'BDCOM': return new BdcomOLTDriver(device);
        default: throw new Error('Unsupported device vendor');
    }
};
