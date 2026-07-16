const test=require('node:test');
const assert=require('node:assert/strict');
const {SnmpTransport,OIDS,counter64}=require('../../src/services/device-management/snmp-transport');
const {DeviceConnectionService}=require('../../src/services/device-management/device-connection.service');

const vb=(oid,value,type=2)=>({oid,value,type});

test('SNMP IF-MIB and IF-X-MIB counters normalize into live interface rates',async()=>{
  const transport=new SnmpTransport({host:'127.0.0.1'},{});
  let sample=0;
  transport.safeWalk=async oid=>{
    if(oid===OIDS.interfaces){sample++;return[
      vb(`${oid}.1.7`,7),vb(`${oid}.2.7`,'ether1'),vb(`${oid}.7.7`,1),vb(`${oid}.8.7`,1),
      vb(`${oid}.10.7`,sample===1?1000:2000),vb(`${oid}.16.7`,sample===1?3000:5000)
    ];}
    if(oid===OIDS.interfaceNames)return[vb(`${oid}.1.7`,'wan1'),vb(`${oid}.6.7`,sample===1?1000:2000),vb(`${oid}.10.7`,sample===1?3000:5000)];
    return[];
  };
  const first=await transport.interfaces();
  transport.previousCounters.get('7').at-=1000;
  const second=await transport.interfaces();
  assert.equal(first[0].name,'wan1');
  assert.equal(first[0].operState,'up');
  assert.ok(second[0].rxBitsPerSecond>=7900&&second[0].rxBitsPerSecond<=8000);
  assert.ok(second[0].txBitsPerSecond>=15900&&second[0].txBitsPerSecond<=16000);
});

test('SNMP Counter64 values are decoded without integer truncation',()=>{
  assert.equal(counter64(Buffer.from([0,0,0,0,0,0,4,0])),1024);
  assert.equal(counter64(Buffer.from([0xff,0xff,0xff,0xff,0xff,0xff,0xff,0xff])),'18446744073709551615');
});

test('SNMP ENTITY-MIB maps physical modules to board records',async()=>{
  const transport=new SnmpTransport({host:'127.0.0.1'},{});
  transport.safeWalk=async oid=>oid===OIDS.entities?[
    vb(`${oid}.1.101`,101),
    vb(`${oid}.2.101`,'Huawei GPON service board'),
    vb(`${oid}.5.101`,9),
    vb(`${oid}.7.101`,'H805GPFD'),
    vb(`${oid}.11.101`,'BOARD-SERIAL-1'),
    vb(`${oid}.12.101`,'Huawei'),
    vb(`${oid}.13.101`,'H805GPFD'),
  ]:[];
  const boards=await transport.getModule('boards');
  assert.equal(boards.length,1);
  assert.equal(boards[0].entityClass,'module');
  assert.equal(boards[0].name,'H805GPFD');
  assert.equal(boards[0].serialNumber,'BOARD-SERIAL-1');
});

test('connection service selects the injected SNMP transport and passes module context',async()=>{
  const calls=[];
  class FakeSnmp{constructor(device,credentials){calls.push({device,credentials});}async connect(){}async getModule(module){calls.push(module);return[{name:'eth0'}];}close(){}}
  const service=new DeviceConnectionService({managedDeviceCredential:{findUnique:async()=>null}}, {SnmpTransport:FakeSnmp});
  const result=await service.execute({id:91,ispId:19,deviceType:'cisco',vendor:'Cisco',host:'127.0.0.1',preferredProtocol:'SNMP',snmpVersion:'v2c',snmpPort:161},'ignored',{module:'interfaces',requestedProtocol:'SNMP',ispId:19});
  assert.equal(result.protocol,'SNMP');
  assert.deepEqual(result.result,[{name:'eth0'}]);
  assert.equal(calls[1],'interfaces');
  service.closeAll();
});
