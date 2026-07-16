const BaseDeviceDriver=require('../base/BaseDeviceDriver');
class CiscoIosDriver extends BaseDeviceDriver{
 get detectionCommands(){return['show version','show inventory','show interfaces status'];}
 parseDetection(outputs){const text=outputs.map(item=>item.output).join('\n'),version=text.match(/Cisco IOS(?: XE)? Software[^\n]*Version\s+([^,\s]+)/i)?.[1]||text.match(/Version\s+([^,\s]+)/i)?.[1],model=text.match(/cisco\s+(\S+)\s+\([^)]*\) processor/i)?.[1]||text.match(/PID:\s*([^,\s]+)/i)?.[1],serial=text.match(/Processor board ID\s+(\S+)/i)?.[1]||text.match(/SN:\s*([^,\s]+)/i)?.[1],hostname=text.match(/^([\w.-]+)[>#]\s*$/m)?.[1];return{...super.parseDetection(outputs),vendor:'Cisco',platform:/IOS XE/i.test(text)?'IOS-XE':/NX-OS/i.test(text)?'NX-OS':'IOS',deviceType:this.device.deviceType||'cisco',model:model||null,serialNumber:serial||null,operatingSystem:/NX-OS/i.test(text)?'NX-OS':/IOS XE/i.test(text)?'IOS-XE':'IOS',operatingSystemVersion:version||null,hostname:hostname||null,promptType:/>\s*$/.test(text)?'user':'privileged',privilegeLevel:/#\s*$/.test(text)?'privileged':'user'};}
}
module.exports=CiscoIosDriver;
