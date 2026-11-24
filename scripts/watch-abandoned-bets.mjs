// Detect abandoned bets: bets that pass the refund deadline without ever being
// settled. In a commit-reveal scheme only the holder of the missing preimage can
// settle, so an expired-unsettled bet is on-chain evidence that someone withheld
// a preimage to avoid the outcome. No verifier can catch this - there is no
// outcome to verify - which is why this observer exists.
//
//   node scripts/watch-abandoned-bets.mjs --contract 0x... [--rpc URL] [--delay 256] [--from 1] [--to N]
const arg = (n, d) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d;
};

const RPC = arg('rpc', 'https://mainnet.base.org');
const CONTRACT = arg('contract');
const DELAY = BigInt(arg('delay', '256'));
const FROM = BigInt(arg('from', '1'));
const TO = arg('to', null) ? BigInt(arg('to')) : null;

if (!CONTRACT || !/^0x[0-9a-fA-F]{40}$/.test(CONTRACT)) {
  console.error('usage: node scripts/watch-abandoned-bets.mjs --contract 0x<addr> [--rpc URL] [--delay 256] [--from 1] [--to N]');
  process.exit(2);
}

const SEL_TOTAL_BETS = '0xbefa1e2f'; // totalBets()
const SEL_BANKROLL = '0x0c657eb0'; // bankroll()
const SEL_GET_BET = '0x061e494f'; // getBet(uint256)

let nextId = 1;
async function rpc(method, params) {
  const r = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(method + ': ' + j.error.message);
  return j.result;
}

const call = (to, data) => rpc('eth_call', [{ to, data }, 'latest']);
const word = (hex, i) => BigInt('0x' + hex.slice(i * 64, (i + 1) * 64));
const addrOf = (hex, i) => '0x' + hex.slice(i * 64 + 24, (i + 1) * 64);

const big = (h) => (h && h !== '0x' ? BigInt(h) : 0n);

const code = await rpc('eth_getCode', [CONTRACT, 'latest']);
if (!code || code === '0x') {
  console.error(`no contract code at ${CONTRACT} (${RPC})`);
  process.exit(2);
}

const head = big(await rpc('eth_blockNumber', []));
const total = TO !== null ? TO : big(await call(CONTRACT, SEL_TOTAL_BETS));
const bankroll = big(await call(CONTRACT, SEL_BANKROLL));

console.log(`contract  ${CONTRACT}`);
console.log(`rpc       ${RPC}`);
console.log(`head      ${head}`);
console.log(`bets      ${total}`);
console.log(`bankroll  ${bankroll} wei`);
console.log('');

// Bet layout: player, wager, target, client_commitment, server_commitment,
//             block_number, settled, outcome, payout
const abandoned = [];
let pending = 0;
let settledCount = 0;
let empty = 0;

for (let id = FROM; id <= total; id++) {
  const data = SEL_GET_BET + id.toString(16).padStart(64, '0');
  let res;
  try {
    res = await call(CONTRACT, data);
  } catch (e) {
    console.error(`bet ${id}: call failed (${e.message})`);
    continue;
  }
  const hex = (res || '').replace(/^0x/, '');
  if (hex.length < 64 * 9) {
    empty++;
    continue;
  }

  const player = addrOf(hex, 0);
  const wager = word(hex, 1);
  const target = Number(word(hex, 2));
  const placedAt = word(hex, 5);
  const settled = word(hex, 6) === 1n;
  const payout = word(hex, 8);

  if (wager === 0n && !settled) {
    empty++;
    continue;
  }
  if (settled) {
    settledCount++;
    continue;
  }

  const age = head - placedAt;
  if (age >= DELAY) {
    abandoned.push({ id, player, wager, target, placedAt, age });
  } else {
    pending++;
  }
}

console.log(`settled          ${settledCount}`);
console.log(`pending (in time)${String(pending).padStart(4)}`);
console.log(`empty slots      ${empty}`);
console.log('');

if (abandoned.length === 0) {
  console.log('No abandoned bets. Every bet either settled or is still inside the refund window.');
  process.exit(0);
}

console.log(`ABANDONED BETS: ${abandoned.length}`);
console.log('A bet past the refund deadline that never settled means a preimage holder');
console.log('withheld it. The withheld side cannot be determined from state alone, but the');
console.log('event is evidence that settlement was declined.');
console.log('');
for (const b of abandoned) {
  console.log(
    `  bet ${b.id}  player ${b.player}  wager ${b.wager} wei  target ${b.target}  ` +
      `placed block ${b.placedAt}  age ${b.age} (deadline ${DELAY})`,
  );
}
process.exit(1);
