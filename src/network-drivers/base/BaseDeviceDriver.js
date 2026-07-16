class BaseDeviceDriver {
  constructor(device,connections){this.device=device;this.connections=connections;}
  get detectionCommands(){return[];}
  async run(command){return this.connections.execute(this.device,command);}
  async detect(){const outputs=[];for(const command of this.detectionCommands){const response=await this.run(command);outputs.push({command,output:String(response.result||'').slice(0,100000)});}return this.parseDetection(outputs);}
  parseDetection(outputs){return{vendor:this.device.vendor,platform:this.device.platform||null,deviceType:this.device.deviceType,model:this.device.model||null,serialNumber:this.device.serialNumber||null,operatingSystem:this.device.operatingSystem||null,operatingSystemVersion:this.device.operatingSystemVersion||this.device.firmwareVersion||null,hostname:null,promptType:null,privilegeLevel:null,outputs};}
}
module.exports=BaseDeviceDriver;
