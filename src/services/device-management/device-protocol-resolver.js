const PROTOCOLS=Object.freeze({AUTO:'AUTO',ROUTEROS_API:'ROUTEROS_API',ROUTEROS_API_TLS:'ROUTEROS_API_TLS',ROUTEROS_REST:'ROUTEROS_REST',SSH:'SSH',NETCONF:'NETCONF',RESTCONF:'RESTCONF',GNMI:'GNMI',SNMP:'SNMP',VENDOR_API:'VENDOR_API',TELNET:'TELNET',DISABLED:'DISABLED'});
const LEGACY_METHOD={web_api:PROTOCOLS.VENDOR_API,ssh:PROTOCOLS.SSH,telnet:PROTOCOLS.TELNET};
const normalize=value=>String(value||'').trim().toUpperCase().replace(/[ -]+/g,'_');
const majorVersion=device=>Number.parseInt(String(device.operatingSystemVersion||device.firmwareVersion||'').match(/\d+/)?.[0]||'0',10);
const truthy=(availability,key)=>availability?.[key]===true;

function candidatesFor(device){
  const vendor=String(device.vendor||'').toLowerCase(),type=String(device.deviceType||'').toLowerCase(),platform=String(device.platform||device.operatingSystem||'').toLowerCase();
  if(type==='mikrotik'||vendor.includes('mikrotik'))return majorVersion(device)>=7?[PROTOCOLS.ROUTEROS_REST,PROTOCOLS.ROUTEROS_API_TLS,PROTOCOLS.ROUTEROS_API,PROTOCOLS.SSH,PROTOCOLS.SNMP]:[PROTOCOLS.ROUTEROS_API_TLS,PROTOCOLS.ROUTEROS_API,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  if(vendor.includes('cisco')||type==='cisco'){
    if(platform.includes('meraki'))return[PROTOCOLS.VENDOR_API];
    if(platform.includes('nx-os')||platform.includes('nxos'))return[PROTOCOLS.VENDOR_API,PROTOCOLS.RESTCONF,PROTOCOLS.NETCONF,PROTOCOLS.GNMI,PROTOCOLS.SSH,PROTOCOLS.SNMP];
    return[PROTOCOLS.RESTCONF,PROTOCOLS.NETCONF,PROTOCOLS.GNMI,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  }
  if(type==='nokia-bng')return[PROTOCOLS.GNMI,PROTOCOLS.NETCONF,PROTOCOLS.VENDOR_API,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  if(type==='nokia-olt')return[PROTOCOLS.VENDOR_API,PROTOCOLS.NETCONF,PROTOCOLS.SNMP,PROTOCOLS.SSH];
  if(type==='huawei-olt'||vendor.includes('huawei'))return[PROTOCOLS.NETCONF,PROTOCOLS.RESTCONF,PROTOCOLS.GNMI,PROTOCOLS.VENDOR_API,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  if(['vsol','cdata','bdcom'].includes(type))return[PROTOCOLS.VENDOR_API,PROTOCOLS.SNMP,PROTOCOLS.SSH,PROTOCOLS.TELNET];
  if(['fortiget-firewall','alto-palo','sophos'].includes(type))return[PROTOCOLS.VENDOR_API,PROTOCOLS.RESTCONF,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  if(type==='linux-server')return[PROTOCOLS.SSH,PROTOCOLS.SNMP];
  if(['juniper-switch','juniper-bras'].includes(type)||vendor.includes('juniper'))return[PROTOCOLS.NETCONF,PROTOCOLS.GNMI,PROTOCOLS.SSH,PROTOCOLS.SNMP];
  return[LEGACY_METHOD[device.communicationMethod],PROTOCOLS.SSH,PROTOCOLS.SNMP].filter(Boolean);
}

function resolveDeviceProtocol(input={}){
  const device=input.device||input,request=normalize(input.userSelection||input.requestedProtocol||'AUTO'),configured=request!=='AUTO'?request:normalize(device.preferredProtocol||device.protocolMode||'AUTO'),ordered=[...new Set([device.lastSuccessfulProtocol&&normalize(device.lastSuccessfulProtocol),...(Array.isArray(device.fallbackProtocols)?device.fallbackProtocols.map(normalize):[]),...candidatesFor(device)].filter(Boolean))],availability=input.protocolAvailability||device.protocolAvailability||{};
  let selected=configured!=='AUTO'?configured:null,autoSelected=!selected;
  if(!selected){const detected=ordered.find(protocol=>truthy(availability,protocol)),last=device.lastSuccessfulProtocol&&normalize(device.lastSuccessfulProtocol),legacy=LEGACY_METHOD[device.communicationMethod||device.defaultCommunicationMethod],mikrotik=String(device.deviceType||'').toLowerCase()==='mikrotik';selected=detected||(last&&ordered.includes(last)?last:mikrotik?(majorVersion(device)>=7&&device.apiBaseUrl?PROTOCOLS.ROUTEROS_REST:(device.tlsEnabled?PROTOCOLS.ROUTEROS_API_TLS:PROTOCOLS.ROUTEROS_API)):ordered.includes(legacy)?legacy:ordered[0])||PROTOCOLS.DISABLED;}
  const configuredReachable=Object.prototype.hasOwnProperty.call(availability,selected)?truthy(availability,selected):null;
  if(configuredReachable===false&&configured==='AUTO')selected=ordered.find(protocol=>truthy(availability,protocol))||selected;
  return{selectedProtocol:selected,fallbackProtocols:ordered.filter(protocol=>protocol!==selected),reason:configured==='AUTO'?`AUTO selected ${selected} from vendor, device type, platform, OS version, and detected availability.`:`${selected} was explicitly configured.`,connectionProfile:{host:device.host,port:portFor(device,selected),tlsEnabled:[PROTOCOLS.ROUTEROS_API_TLS,PROTOCOLS.ROUTEROS_REST].includes(selected)||Boolean(device.tlsEnabled),verifyTls:device.verifyTls!==false},autoSelected,capabilityProbeRequired:!Object.keys(availability).length};
}
function portFor(device,protocol){const ports={ROUTEROS_API:device.apiPort||8728,ROUTEROS_API_TLS:device.apiTlsPort||8729,ROUTEROS_REST:device.restPort||device.apiPort||443,SSH:device.sshPort||device.managementPort||22,NETCONF:device.netconfPort||830,SNMP:device.snmpPort||161,TELNET:device.managementPort||23};return ports[protocol]||device.apiPort||device.managementPort;}
module.exports={PROTOCOLS,LEGACY_METHOD,candidatesFor,resolveDeviceProtocol,portFor,majorVersion};
