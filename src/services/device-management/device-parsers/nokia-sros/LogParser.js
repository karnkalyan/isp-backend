const BaseParser=require('../BaseParser');

class NokiaLogParser extends BaseParser {
  parse(lines){
    const items=[];
    let current=null;
    const finish=()=>{if(current){items.push(current);current=null;}};
    for(const raw of this.clean(lines)){
      const line=raw.trim();
      if(/^(?:Log Id|Log Contents|Memory Log|Source|Admin State|Oper State|Logged|Dropped|Dest\.|Time format|Alarms\s*\[)/i.test(line))continue;
      const event=line.match(/^(\d+)\s+(\d{4}\/\d{2}\/\d{2})\s+(\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(CLEARED|INDETERMINATE|CRITICAL|MAJOR|MINOR|WARNING|INFO|NOTICE)\s+(\S+)\s+(\S+)(?:\s+(.*))?$/i);
      if(event){finish();current={id:Number(event[1]),sequence:Number(event[1]),date:event[2],time:event[3],severity:event[4].toUpperCase(),eventCode:event[5],application:event[6],message:event[7]?.trim()||''};continue;}
      if(current&&!/^(?:Number of|Flags:|Events|Application)/i.test(line))current.message=`${current.message} ${line}`.trim();
    }
    finish();
    return this.result({items,columns:['sequence','date','time','severity','application','eventCode','message'],summary:{total:items.length,critical:items.filter(item=>item.severity==='CRITICAL').length,major:items.filter(item=>item.severity==='MAJOR').length,minor:items.filter(item=>item.severity==='MINOR').length,warning:items.filter(item=>item.severity==='WARNING').length},entityType:'event-log',capabilityKey:'nokia.logs.events.list',confidence:items.length?0.94:0});
  }
}

module.exports=NokiaLogParser;
