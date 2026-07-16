const BaseParser=require('../BaseParser');

class NokiaRouteParser extends BaseParser {
  constructor(staticOnly=false){super();this.staticOnly=staticOnly;}

  parse(lines){
    const items=[];
    let pending=null,router='Base';
    for(const raw of this.clean(lines)){
      const line=raw.trim();
      const routerMatch=line.match(/^Route Table\s*\(Router:\s*([^)]+)\)/i);if(routerMatch){router=routerMatch[1].trim();continue;}
      if(/^(?:Route Table|Dest Prefix|IP Addr\/mask|Next Hop|Flags|No\. of Routes|[nBLS]\s*=)/i.test(line))continue;
      const staticRow=line.match(/^(\S+\/\d+)\s+(\d+)\s+(\d+)\s+(BH|ID|NH)\s+(\S+)\s+(\S+)\s+([YN])$/i);
      if(staticRow){items.push(this.row({destination:staticRow[1],preference:Number(staticRow[2]),metric:Number(staticRow[3]),routeType:staticRow[4].toUpperCase(),protocol:'Static',nextHop:staticRow[5],interface:staticRow[6],active:/^Y$/i.test(staticRow[7]),age:null,router}));continue;}
      const primary=line.match(/^(\S+\/\d+)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\d+)(?:\s+.*)?$/);
      if(primary){pending={destination:primary[1],routeType:primary[2],protocol:primary[3],age:primary[4],preference:Number(primary[5]),router};continue;}
      if(pending){const next=line.match(/^(\S+)(?:\s+\[([^\]]+)\])?\s+(\d+)$/);if(next){items.push(this.row({...pending,nextHop:next[1],interface:next[2]||null,metric:Number(next[3]),active:true}));pending=null;}}
    }
    const filtered=this.staticOnly?items.filter(item=>/^static$/i.test(item.protocol)||['BH','ID','NH'].includes(item.routeType)):items;
    return this.result({items:filtered,columns:['destination','routeType','protocol','nextHop','interface','preference','metric','age','active','router'],summary:{total:filtered.length,active:filtered.filter(item=>item.active).length,static:filtered.filter(item=>/^static$/i.test(item.protocol)).length,local:filtered.filter(item=>/^local$/i.test(item.protocol)).length,bgp:filtered.filter(item=>/^bgp$/i.test(item.protocol)).length},entityType:'route',capabilityKey:`nokia.routing.${this.staticOnly?'static-routes':'route-table'}.list`,confidence:filtered.length?0.95:0});
  }

  row(value){return{id:`${value.router}:${value.destination}:${value.nextHop}`,...value};}
}

module.exports=NokiaRouteParser;
