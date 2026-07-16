const BaseParser=require('../BaseParser');

class NokiaMdaParser extends BaseParser {
  parse(lines) {
    const items=[];
    for(const line of this.clean(lines)) {
      if(/mda summary|slot\s+mda|provisioned\s+equipped|admin(?:istrative)?\s+operational|number\s+type/i.test(line))continue;
      const tokens=line.split(/\s+/);
      let slot,mdaId;
      const combined=tokens[0]?.match(/^(\d+)\/(\d+)$/);
      if(combined){slot=combined[1];mdaId=combined[2];tokens.shift();}
      else if(/^\d+$/.test(tokens[0]||'')&&/^\d+$/.test(tokens[1]||'')){slot=tokens.shift();mdaId=tokens.shift();}
      else continue;
      const stateIndex=tokens.findIndex(token=>/^(?:up|down|in-service|out-of-service|enabled|disabled|unknown|unprovisioned)$/i.test(token));
      if(stateIndex<1||tokens.length<=stateIndex+1)continue;
      const types=tokens.slice(0,stateIndex),adminState=tokens[stateIndex].toLowerCase(),operState=tokens[stateIndex+1].toLowerCase(),comments=tokens.slice(stateIndex+2).join(' ')||null;
      items.push({id:`${slot}/${mdaId}`,slot:Number(slot),mdaId:Number(mdaId),provisionedType:types[0]||null,equippedType:types[1]||null,adminState,operState,comments});
    }
    return this.result({items,columns:['id','slot','mdaId','provisionedType','equippedType','adminState','operState','comments'],summary:{total:items.length,operational:items.filter(item=>item.operState==='up').length,down:items.filter(item=>item.operState==='down').length,disabled:items.filter(item=>item.adminState==='down'||item.adminState==='disabled').length},entityType:'media-dependent-adapter',capabilityKey:'nokia.mdas.list',confidence:items.length?0.97:0});
  }
}

module.exports=NokiaMdaParser;
