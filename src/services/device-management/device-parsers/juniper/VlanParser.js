const BaseParser=require('../BaseParser');

class JuniperVlanParser extends BaseParser {
  parse(lines) {
    const items=[];
    let current=null;
    const finish=()=>{
      if(!current)return;
      current.interfaceCount=current.interfaces.length;
      current.status=current.interfaces.some(item=>item.active)?'active':current.interfaces.length?'configured':'empty';
      current.interfaceNames=current.interfaces.map(item=>item.name).join(', ');
      items.push(current);
      current=null;
    };
    for(const line of this.clean(lines)) {
      if(/routing\s+instance\s+vlan\s+name\s+tag/i.test(line)||/^name\s+tag\s+interfaces/i.test(line))continue;
      const record=line.match(/^(\S+)\s+(\S+)\s+(\d+|none|-)\s*(.*)$/i);
      if(record) {
        finish();
        current={routingInstance:record[1],name:record[2],vlanId:/^\d+$/.test(record[3])?Number(record[3]):null,interfaces:[]};
        this.addInterfaces(current,record[4]);
        continue;
      }
      if(current)this.addInterfaces(current,line);
    }
    finish();
    return this.result({
      items,
      columns:['routingInstance','name','vlanId','interfaceNames','interfaceCount','status'],
      summary:{total:items.length,tagged:items.filter(item=>item.vlanId!==null).length,interfaceMemberships:items.reduce((sum,item)=>sum+item.interfaceCount,0),routingInstances:new Set(items.map(item=>item.routingInstance)).size},
      entityType:'vlan',
      capabilityKey:'juniper.vlans.list',
      confidence:items.length?0.98:0
    });
  }

  addInterfaces(record,text) {
    for(const token of String(text||'').split(/[\s,]+/).filter(Boolean)) {
      if(!/^[a-z][a-z0-9-]*(?:-\d+)?(?:\/\d+)*(?:\.\d+)?\*?$/i.test(token))continue;
      const active=token.endsWith('*'),name=token.replace(/\*$/,'');
      if(!record.interfaces.some(item=>item.name===name))record.interfaces.push({name,active});
    }
  }
}

module.exports=JuniperVlanParser;
