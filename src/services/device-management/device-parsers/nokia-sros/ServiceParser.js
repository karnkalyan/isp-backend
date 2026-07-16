const BaseParser=require('../BaseParser');

class NokiaServiceParser extends BaseParser {
  constructor(type){super();this.type=String(type||'service').toUpperCase();}

  parse(lines) {
    const items=[];
    for(const line of this.clean(lines)) {
      if(/service\s+(?:id|type|summary)|svc\s+id|customer\s+id|admin(?:istrative)?\s+state|oper(?:ational)?\s+state/i.test(line))continue;
      const row=line.match(/^\s*(\d+)\s+(VPLS|VPRN|IES|EPIPE|EVPN)\s+(up|down)\s+(up|down)\s+(\d+|-)(?:\s+(.+?))?\s*$/i);
      if(!row||row[2].toUpperCase()!==this.type)continue;
      items.push({serviceId:Number(row[1]),type:row[2].toUpperCase(),adminState:row[3].toLowerCase(),operState:row[4].toLowerCase(),customerId:row[5]==='-'?null:Number(row[5]),serviceName:row[6]?.trim()||String(row[1]),sapCount:null,sdpCount:null});
    }
    return this.result({items,columns:['serviceId','type','adminState','operState','customerId','serviceName','sapCount','sdpCount'],summary:{total:items.length,operational:items.filter(item=>item.operState==='up').length,down:items.filter(item=>item.operState==='down').length,customers:new Set(items.map(item=>item.customerId).filter(value=>value!==null)).size},entityType:`${this.type.toLowerCase()}-service`,capabilityKey:`nokia.services.${this.type.toLowerCase()}.list`,confidence:items.length?0.97:0});
  }
}

module.exports=NokiaServiceParser;
