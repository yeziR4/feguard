import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {sha256} from './inspection-lib.mjs';
const report=JSON.parse(await readFile(new URL('../reports/quickminey-proxy-context.json',import.meta.url),'utf8'));
const plan=JSON.parse(await readFile(new URL('../policies/initialization-review.json',import.meta.url),'utf8'));
const disposition=JSON.parse(await readFile(new URL('../reports/case-dispositions.json',import.meta.url),'utf8'));
const evidenceBytes=await readFile(new URL('../reports/quickminey-proxy-context.json',import.meta.url));
const address = value => '0x'+BigInt(value).toString(16).padStart(40,'0');
function errorString(error){
  const data=error?.data;
  if(error?.code!==3||!/^0x08c379a0[\da-f]+$/i.test(data||''))return null;
  const body=data.slice(10);
  if(body.length<128||BigInt('0x'+body.slice(0,64))!==32n)return null;
  const length=Number(BigInt('0x'+body.slice(64,128)));
  if(length>1000||body.length<128+length*2)return null;
  return Buffer.from(body.slice(128,128+length*2),'hex').toString('utf8');
}
test('captured proxy context closes the tested initializer path, while implementation A stays initializable',()=>{
  const proxy=report.rows.find(r=>r.name==='proxy');
  const impl=report.rows.find(r=>r.name==='implementationA');
  const target=plan.targets.find(t=>t.address.toLowerCase()===impl.address.toLowerCase());
  assert.equal(impl.runtimeSha256,target.runtimeSha256);
  assert.equal(address(proxy.storage.implementation.observation.value),impl.address.toLowerCase());
  for(const field of Object.values(proxy.storage))assert.equal(field.observation.state,0);
  assert.equal(BigInt(proxy.storage.initialized.observation.value)&255n,1n);
  assert.notEqual(BigInt(proxy.storage.orcale.observation.value),0n);
  for(const raw of proxy.initializer)assert.equal(errorString(raw.error),'Initializable: contract is already initialized');
  assert.equal(BigInt(impl.storage.initialized.observation.value)&255n,0n);
  assert.ok(impl.initializer.every(r=>r.result==='0x'));
  assert.equal(disposition.cases[0].evidenceFile,'quickminey-proxy-context.json');
  assert.equal(disposition.cases[0].evidenceSha256,sha256(evidenceBytes));
});
test('asset and admin statements are scoped to measured code/native/USDT evidence',()=>{
  assert.equal(report.token.decimals.observation.state,0);
  assert.equal(report.token.decimals.observation.value,'18');
  const proxy=report.rows.find(r=>r.name==='proxy');
  assert.equal(proxy.nativeBalanceWei,'0');
  assert.equal(proxy.usdtBalance.observation.value,'2654140000000000000000');
  assert.ok(report.admin.code.every(r=>r.result==='0x'));
  assert.equal(address(proxy.storage.admin.observation.value),report.admin.address);
  assert.equal(proxy.storage.admin.observation.value,proxy.storage.orcale.observation.value);
  assert.equal(errorString({code:-32000,message:'missing trie node'}),null);
});
