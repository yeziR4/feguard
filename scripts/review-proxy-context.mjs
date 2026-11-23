import {readFile,writeFile} from 'node:fs/promises';
import {Rpc,sha256,decode,reconcile} from './inspection-lib.mjs';
import {pin} from './cohort-lib.mjs';
const plan=JSON.parse(await readFile(new URL('../policies/initialization-review.json',import.meta.url),'utf8'));
const a=plan.targets.find(t=>t.address.toLowerCase()==='0x3c9acb71c8da760742d8fd9cbc945918a1aac79f');
const b=plan.targets.find(t=>t.address.toLowerCase()==='0x1369622bae6eaa5690aeb2fd5d5057ad0e0e570a');
const proxy='0x1fBD228d55d91e2A4CC1DdfEADF493d8646b8d72';
const usdt='0x55d398326f99059ff775485246999027b3197955';
const rpcs=['https://bsc-dataseed.bnbchain.org','https://bsc-dataseed.defibit.io'].map(x=>new Rpc(x));
const block=await pin(rpcs,56);const rows=[];
async function read(method,params,type='uint'){
 const raw=await Promise.all(rpcs.map(r=>r.read(method,params)));
 const normalized=raw.map(r=>{try{return r.error?{state:1,value:'0'}:{state:0,value:decode(r.result,type)};}catch{return{state:3,value:'0'};}});
 return{observation:reconcile(normalized),raw};
}
const tokenDecimals=await read('eth_call',[{to:usdt,data:'0x313ce567'},block.tag]);
for(const [name,address,target]of[['proxy',proxy,null],['implementationA',a.address,a],['implementationB',b.address,b]]){
 const code=await Promise.all(rpcs.map(r=>r.read('eth_getCode',[address,block.tag])));
 const codeMatches=code.every(r=>/^0x(?:[\da-f]{2})+$/i.test(r.result||'')&&r.result===code[0].result);
 if(!codeMatches||(target&&code.some(r=>sha256(Buffer.from(r.result.slice(2),'hex'))!==target.runtimeSha256)))throw new Error('Runtime evidence differs.');
 const storage={};for(const [label,slot]of[['initialized','0x0'],['owner','0x4d'],['orcale','0x4f'],['manager','0x50'],['implementation','0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc'],['admin','0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103']])storage[label]=await read('eth_getStorageAt',[address,slot,block.tag],label==='initialized'?'uint':'address');
 const balanceRaw=await Promise.all(rpcs.map(r=>r.read('eth_getBalance',[address,block.tag])));
 const nativeBalanceWei=balanceRaw.every(r=>/^0x[\da-f]+$/i.test(r.result||'')&&BigInt(r.result)===BigInt(balanceRaw[0].result))?String(BigInt(balanceRaw[0].result)):null;
 const token=await read('eth_call',[{to:usdt,data:'0x70a08231'+address.slice(2).toLowerCase().padStart(64,'0')},block.tag]);
 const owner=await read('eth_call',[{to:address,data:'0x8da5cb5b'},block.tag],'address');
 const initializer=await Promise.all(rpcs.map(r=>r.read('eth_call',[{from:a.simulation.caller,to:address,data:(target||a).simulation.data,gas:a.simulation.gas},block.tag])));
 rows.push({name,address,codeSizeBytes:(code[0].result.length-2)/2,runtimeSha256:sha256(Buffer.from(code[0].result.slice(2),'hex')),storage,nativeBalanceWei,usdtBalance:token,ownerGetter:owner,initializer});
}
const admin=rows[0].storage.admin.observation;
const adminAddress=admin.state===0?'0x'+BigInt(admin.value).toString(16).padStart(40,'0'):null;
const adminCode=adminAddress?await Promise.all(rpcs.map(r=>r.read('eth_getCode',[adminAddress,block.tag]))):[];
const after=await Promise.all(rpcs.map(r=>r.read('eth_getBlockByNumber',[block.tag,false])));
if(after.some(r=>r.result?.hash!==block.hash))throw new Error('Pinned block changed.');
const result={schemaVersion:1,chainId:56,block,token:{address:usdt,decimals:tokenDecimals},rows,admin:{address:adminAddress,code:adminCode},evidence:rpcs.map(r=>({provider:r.url,reads:r.evidence})),scope:'Read-only checks of the named proxy and implementations; native and one named ERC-20 only, not an exhaustive asset/proxy inventory.'};
await writeFile(new URL('../reports/quickminey-proxy-context.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({block,rows:rows.map(r=>({name:r.name,address:r.address,codeSize:r.codeSizeBytes,initialized:r.storage.initialized.observation.state===0?String(BigInt(r.storage.initialized.observation.value)&255n):null,implementation:r.storage.implementation.observation,orcale:r.storage.orcale.observation,nativeBalanceWei:r.nativeBalanceWei,usdtBalance:r.usdtBalance.observation,initializer:r.initializer.map(x=>({result:x.result,error:x.error}))})),admin:result.admin},null,2));
