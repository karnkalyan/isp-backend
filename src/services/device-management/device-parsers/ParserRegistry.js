const JuniperVlanParser=require('./juniper/VlanParser');
const NokiaCardParser=require('./nokia-sros/CardParser');
const NokiaMdaParser=require('./nokia-sros/MdaParser');
const NokiaServiceParser=require('./nokia-sros/ServiceParser');
const NokiaSubscriberParser=require('./nokia-sros/SubscriberParser');
const NokiaSubscriberHierarchyParser=require('./nokia-sros/SubscriberHierarchyParser');
const NokiaRouteParser=require('./nokia-sros/RouteParser');
const NokiaLogParser=require('./nokia-sros/LogParser');

class DeviceParserRegistry {
  constructor(){this.parsers=new Map();this.register('juniper-switch','vlans',()=>new JuniperVlanParser());this.register('nokia-bng','cards',()=>new NokiaCardParser());this.register('nokia-bng','mdas',()=>new NokiaMdaParser());this.register('nokia-bng','subscribers',()=>new NokiaSubscriberParser());this.register('nokia-bng','subscribers-active-subscribers',()=>new NokiaSubscriberParser());this.register('nokia-bng','subscribers-pppoe-sessions',()=>new NokiaSubscriberParser('PPPOE'));this.register('nokia-bng','subscribers-ipoe-sessions',()=>new NokiaSubscriberParser('IPOE'));this.register('nokia-bng','subscribers-dhcp-sessions',()=>new NokiaSubscriberParser('DHCP'));this.register('nokia-bng','subscribers-session-details',()=>new NokiaSubscriberHierarchyParser());this.register('nokia-bng','routing-routes',()=>new NokiaRouteParser());this.register('nokia-bng','routing-routing-table',()=>new NokiaRouteParser());this.register('nokia-bng','routing-static-routes',()=>new NokiaRouteParser(true));this.register('nokia-bng','routes',()=>new NokiaRouteParser());this.register('nokia-bng','logs',()=>new NokiaLogParser());for(const type of ['vpls','vprn','ies','epipe'])this.register('nokia-bng',`services-${type}`,()=>new NokiaServiceParser(type));}
  canonical(value){return String(value||'').trim().toLowerCase().replace(/_/g,'-').replace(/\s+/g,'-');}
  key(deviceType,module){return`${this.canonical(deviceType)}:${this.canonical(module)}`;}
  register(deviceType,module,factory){this.parsers.set(this.key(deviceType,module),factory);return this;}
  resolve(deviceType,module){return this.parsers.get(this.key(deviceType,module))?.()||null;}
  parse({device,module,lines}){const parser=this.resolve(device.deviceType,module);if(!parser)return null;const result=parser.parse(lines);return result.items.length?result:{...result,warnings:[...result.warnings,`No structured ${result.entityType} records matched the sanitized device output.`]};}
}

module.exports=new DeviceParserRegistry();
module.exports.DeviceParserRegistry=DeviceParserRegistry;
