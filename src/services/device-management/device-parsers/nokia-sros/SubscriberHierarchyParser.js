const BaseParser=require('../BaseParser');

class NokiaSubscriberHierarchyParser extends BaseParser {
  parse(lines){
    const items=[];
    let subscriber=null,profile=null,sap=null,slaProfile=null,session=null;
    for(const raw of this.clean(lines)){
      const line=raw.trim().replace(/^[|+\-\s]+/,'').trim();
      if(!line||/^(?:Active Subscribers Hierarchy|Number of active subscribers|Flags:)/i.test(line))continue;
      if(/^\([^)]+\)$/.test(line)){profile=line.slice(1,-1);continue;}
      const sapRow=line.match(/^sap:(\S+)\s+-\s+sla:(\S+)(?:\s+PPP session:(\S+))?/i);if(sapRow){sap=sapRow[1];slaProfile=sapRow[2];session=sapRow[3]?{sessionType:'PPP',sessionId:sapRow[3]}:null;continue;}
      const sessionRow=line.match(/^(PPPOE|PPP|IPOE)-session\s+-\s+mac:([0-9a-f:.-]+)(?:\s+-\s+sid:(\S+))?(?:\s+-\s+svc:(\d+))?/i);if(sessionRow){session={sessionType:sessionRow[1].toUpperCase(),macAddress:sessionRow[2].toLowerCase(),sessionId:sessionRow[3]||session?.sessionId||null,serviceId:sessionRow[4]?Number(sessionRow[4]):null};continue;}
      const host=line.match(/^((?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?|[0-9a-f:]+\/\d+)\s+-\s+(DHCP6?|IPCP|SLAAC)(?:\s+\(N\))?/i);if(host&&subscriber){items.push({id:`${subscriber}:${host[1]}`,subscriberId:subscriber,subscriberProfile:profile,sap,slaProfile,ipAddress:host[1],origin:host[2].toUpperCase(),sessionType:session?.sessionType||(/DHCP/i.test(host[2])?'IPOE':null),sessionId:session?.sessionId||null,macAddress:session?.macAddress||null,serviceId:session?.serviceId||null,forwarding:!/^.*\(N\)/.test(line)});continue;}
      if(!/^(?:sap:|PPPOE|PPP|IPOE)/i.test(line)){subscriber=line;profile=null;sap=null;slaProfile=null;session=null;}
    }
    return this.result({items,columns:['subscriberId','subscriberProfile','sap','slaProfile','ipAddress','macAddress','sessionType','sessionId','origin','serviceId','forwarding'],summary:{subscribers:new Set(items.map(item=>item.subscriberId)).size,sessions:new Set(items.map(item=>`${item.subscriberId}:${item.sessionType}:${item.sessionId}`).filter(value=>!value.endsWith(':null:null'))).size,hosts:items.length,forwarding:items.filter(item=>item.forwarding).length},entityType:'subscriber-session-detail',capabilityKey:'nokia.subscribers.hierarchy.list',confidence:items.length?0.93:0});
  }
}

module.exports=NokiaSubscriberHierarchyParser;
