const BaseDeviceDriver=require('../base/BaseDeviceDriver');
class JuniperJunosDriver extends BaseDeviceDriver{
 get detectionCommands(){return['cli -c "show version | no-more"','cli -c "show chassis hardware | no-more"','cli -c "show interfaces terse | no-more"'];}
 parseDetection(outputs){const text=outputs.map(item=>item.output).join('\n');return{...super.parseDetection(outputs),vendor:'Juniper',platform:'Junos',operatingSystem:'Junos',operatingSystemVersion:text.match(/Junos:\s*([^\s]+)/i)?.[1]||text.match(/JUNOS\s+([^\s]+)/i)?.[1]||null,model:text.match(/Model:\s*([^\s]+)/i)?.[1]||null,serialNumber:text.match(/Chassis\s+\S+\s+(\S+)/i)?.[1]||null,promptType:'junos',privilegeLevel:'operational'};}
}
module.exports=JuniperJunosDriver;
