const BaseParser=require('../BaseParser');

class NokiaCardParser extends BaseParser {
  parse(lines) {
    const items=[];
    for(const line of this.clean(lines)) {
      if(/card summary|slot\s+provisioned|equipped\s+type|administrative|operational/i.test(line))continue;
      const tokens=line.split(/\s+/),slot=tokens.shift();
      if(!/^(?:\d+|[A-Z])$/i.test(slot||''))continue;
      const stateIndex=tokens.findIndex(token=>/^(?:up|down|in-service|out-of-service|enabled|disabled|unknown)(?:\/(?:active|standby))?$/i.test(token));
      if(stateIndex<1||tokens.length<=stateIndex+1)continue;
      const types=tokens.slice(0,stateIndex),admin=tokens[stateIndex],operRole=tokens[stateIndex+1].split('/'),comments=tokens.slice(stateIndex+2).join(' ')||null;
      items.push({slot,provisionedType:types[0]||null,equippedType:types[1]||null,adminState:admin.toLowerCase(),operState:(operRole[0]||'unknown').toLowerCase(),role:operRole[1]?.toLowerCase()||null,comments});
    }
    return this.result({items,columns:['slot','provisionedType','equippedType','adminState','operState','role','comments'],summary:{total:items.length,operational:items.filter(item=>item.operState==='up').length,failed:items.filter(item=>['down','failed'].includes(item.operState)).length,activeCpm:items.filter(item=>item.role==='active').length,standbyCpm:items.filter(item=>item.role==='standby').length},entityType:'hardware-card',capabilityKey:'nokia.cards.list',confidence:items.length?0.96:0});
  }
}

module.exports=NokiaCardParser;
