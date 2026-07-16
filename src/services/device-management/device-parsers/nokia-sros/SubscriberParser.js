const BaseParser=require('../BaseParser');

class NokiaSubscriberParser extends BaseParser {
  constructor(filter=null){super();this.filter=filter;}

  parse(lines) {
    const items=[];
    let subscriber=null,pendingIp=null,hostNumber=0;
    const addPlaceholder=()=>{if(subscriber&&!subscriber.hasHost)items.push(this.row(subscriber,{ipAddress:null,macAddress:null,sessionType:null,sessionId:null,origin:null,serviceId:null,forwarding:null},++hostNumber));};
    for(const line of this.clean(lines)) {
      if(/^(?:active subscribers|ip address|mac address|session\s+origin|flags:)/i.test(line)||/^number of active subscribers/i.test(line))continue;
      const heading=line.match(/^Subscriber\s+(.+)$/i);
      if(heading){addPlaceholder();const identity=heading[1].trim().match(/^(.*?)\s+\(([^)]+)\)$/);subscriber={subscriberId:(identity?.[1]||heading[1]).trim(),subscriberProfile:identity?.[2]?.trim()||null,sap:null,slaProfile:null,hasHost:false};pendingIp=null;continue;}
      if(!subscriber)continue;
      const sla=line.match(/(?:sap:)?\[?([^\s\]]+)\]?\s+-\s+sla:([^\s]+)/i);if(sla){subscriber.sap=sla[1];subscriber.slaProfile=sla[2];continue;}
      if(/^\(?\d+\)?\s+SLA Profile Instance/i.test(line))continue;
      if(/^(?:\d{1,3}\.){3}\d{1,3}(?:\/\d+)?$/.test(line)||/^[0-9a-f:]+\/\d+$/i.test(line)){pendingIp=line;continue;}
      const host=line.match(/^([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(.+)$/i);if(!host)continue;
      const tokens=host[2].trim().split(/\s+/),forwardToken=tokens.pop(),serviceToken=tokens.pop(),origin=tokens.pop()||null,sessionType=tokens.shift()?.toUpperCase()||null,sessionId=tokens.join(' ')||null,record={ipAddress:pendingIp,macAddress:host[1].toLowerCase(),sessionType,sessionId,origin,serviceId:/^\d+$/.test(serviceToken||'')?Number(serviceToken):serviceToken||null,forwarding:/^Y$/i.test(forwardToken||'')?true:/^N$/i.test(forwardToken||'')?false:null};
      subscriber.hasHost=true;pendingIp=null;if(!this.filter||this.matches(record))items.push(this.row(subscriber,record,++hostNumber));
    }
    addPlaceholder();
    const subscribers=new Set(items.map(item=>item.subscriberId));
    return this.result({items,columns:['subscriberId','subscriberProfile','sap','slaProfile','ipAddress','macAddress','sessionType','sessionId','origin','serviceId','forwarding'],summary:{subscribers:subscribers.size,hosts:items.filter(item=>item.macAddress).length,forwarding:items.filter(item=>item.forwarding===true).length,blocked:items.filter(item=>item.forwarding===false).length},entityType:'active-subscriber',capabilityKey:`nokia.subscribers.${this.filter?.toLowerCase()||'active'}.list`,confidence:items.length?0.97:0});
  }

  row(subscriber,host,index){return{id:`${subscriber.subscriberId}:${host.macAddress||index}`,subscriberId:subscriber.subscriberId,subscriberProfile:subscriber.subscriberProfile,sap:subscriber.sap,slaProfile:subscriber.slaProfile,...host};}
  matches(record){const type=String(record.sessionType||'').toUpperCase();if(this.filter==='PPPOE')return type==='PPP'||type==='PPPOE';if(this.filter==='IPOE')return type==='IPOE'||type==='IP';if(this.filter==='DHCP')return type==='DHCP'||String(record.origin||'').toUpperCase().includes('DHCP');return true;}
}

module.exports=NokiaSubscriberParser;
