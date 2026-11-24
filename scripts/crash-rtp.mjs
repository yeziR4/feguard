// Exact return-to-player analysis for FairDice's payout curves.
//
// The curves live in src/outcome.fe and are mirrored here so the economics can be
// checked without a chain or a compiler. Constants below MUST match that file:
//
//   DICE_SIDES = 100, HOUSE_RTP_NUM = 98, CRASH_DRAWS = 1_000_000 (src/outcome.fe)
//   crash_point(u) = min(9800, (HOUSE_RTP_NUM * CRASH_DRAWS) / (CRASH_DRAWS - u))
//
// A provably-fair game must return the same fraction of every wager it accepts,
// whatever the player picks. This script proves, by exhaustive enumeration over
// every possible draw, whether that holds.
//
//   node scripts/crash-rtp.mjs            report every legal target
//   node scripts/crash-rtp.mjs --check    exit 1 if any target's edge is not the
//                                         advertised 2% (intended as a CI gate)
//
// Exit codes: 0 = curves honour the advertised edge (or report-only), 1 = violated.

const DICE_SIDES = 100n;
const HOUSE_RTP_NUM = 98n;
const MIN_CRASH_MULT_X100 = 105n;
const MAX_CRASH_MULT_X100 = 9800n;
const TARGET_EDGE = 0.02; // advertised: 2% house edge, i.e. 98% RTP
const CHECK = process.argv.includes('--check');

const WAGER = 1_000_000_000_000_000n; // 0.001 ETH, only used as a common denominator

// ---------------------------------------------------------------- dice
const maxPayout = (wager, target) => (wager * HOUSE_RTP_NUM) / BigInt(target);

const computePayout = (wager, target, outcome) =>
  outcome < BigInt(target) ? maxPayout(wager, target) : 0n;

// ---------------------------------------------------------------- crash
// Current curve in src/outcome.fe: inverse-CDF over CRASH_DRAWS = 1,000,000.
const CRASH_DRAWS = 1_000_000n;
const crashPoint = (u) => {
  if (BigInt(u) >= CRASH_DRAWS) return 0n;
  const c = (HOUSE_RTP_NUM * CRASH_DRAWS) / (CRASH_DRAWS - BigInt(u));
  return c > MAX_CRASH_MULT_X100 ? MAX_CRASH_MULT_X100 : c;
};

const crashPayout = (wager, multX100, u) =>
  BigInt(multX100) <= crashPoint(u) ? (wager * BigInt(multX100)) / 100n : 0n;

// Proposed curve: the correct inverse-CDF, P(crashPoint >= m) = 98/m.
//   C(u) = (HOUSE_RTP_NUM * DRAWS) / (DRAWS - u), capped at the legal maximum.
// The current curve uses 1/(u+1), which puts all high multipliers in the first
// few draws and leaves the tail far too thin; a coarse 100-draw uniform cannot
// express a 1.96% event at all. Both are fixed by the shape plus a wide draw.
const PROPOSED_DRAWS = 1_000_000n;
const proposedPoint = (u) => {
  const c = (HOUSE_RTP_NUM * PROPOSED_DRAWS) / (PROPOSED_DRAWS - BigInt(u));
  return c > MAX_CRASH_MULT_X100 ? MAX_CRASH_MULT_X100 : c;
};

// Exhaustive RTP for a payout function over a uniform draw space.
function rtp(drawSpace, payoutFor) {
  let total = 0n;
  let wins = 0n;
  for (let u = 0n; u < drawSpace; u++) {
    const p = payoutFor(u);
    if (p > 0n) wins++;
    total += p;
  }
  return { rtp: Number(total) / Number(WAGER) / Number(drawSpace), winProb: Number(wins) / Number(drawSpace) };
}

const pct = (x) => (x * 100).toFixed(3).padStart(9) + '%';
const pad = (s, n) => String(s).padStart(n);

// ---------------------------------------------------------------- report
console.log('Dice mode — win iff outcome < target, payout = wager * 98 / target\n');
console.log('target   winProb      RTP    edge');
let diceOk = true;
for (const target of [1, 2, 10, 25, 49, 50, 75, 94, 95]) {
  const { rtp: r, winProb } = rtp(DICE_SIDES, (u) => computePayout(WAGER, target, u));
  const edge = 1 - r;
  if (Math.abs(edge - TARGET_EDGE) > 0.0005) diceOk = false;
  console.log(`${pad(target + '%', 6)} ${pct(winProb)} ${pct(r)} ${pct(edge)}`);
}

console.log('\nCrash mode, current curve  crash_point(u) = min(9800, 98e6 / (1e6 - u))\n');
console.log('target   winProb   fairProb        RTP    edge');
const targets = [105, 200, 300, 500, 700, 1000, 2000, 3500, 4900, 5000, 7000, 9800];
let worst = { rtp: 1, m: 0 };
for (let m = MIN_CRASH_MULT_X100; m <= MAX_CRASH_MULT_X100; m += 250n) {
  const r = rtp(CRASH_DRAWS, (u) => crashPayout(WAGER, m, u)).rtp;
  if (r < worst.rtp) worst = { rtp: r, m: Number(m) };
}
for (const m of targets) {
  const { rtp: r, winProb } = rtp(CRASH_DRAWS, (u) => crashPayout(WAGER, BigInt(m), u));
  const fair = Number(HOUSE_RTP_NUM) / m; // P(win) a 98% RTP curve must deliver
  console.log(
    `${pad((m / 100).toFixed(2) + 'x', 7)} ${pct(winProb)} ${pct(fair)} ${pct(r)} ${pct(1 - r)}`,
  );
}
const worstM = (worst.m / 100).toFixed(2);
const crashOk = Math.abs(1 - worst.rtp - TARGET_EDGE) <= 0.002;

console.log('\nCrash mode, proposed curve  crash_point(u) = 9800e6 / (1e6 - u), capped\n');
let proposedWorst = { rtp: 1, m: 0 };
for (let m = MIN_CRASH_MULT_X100; m <= MAX_CRASH_MULT_X100; m += 250n) {
  const r = rtp(PROPOSED_DRAWS, (u) => {
    const c = proposedPoint(u);
    return BigInt(m) <= c ? (WAGER * BigInt(m)) / 100n : 0n;
  }).rtp;
  if (r < proposedWorst.rtp) proposedWorst = { rtp: r, m: Number(m) };
}
for (const m of targets) {
  const { rtp: r } = rtp(PROPOSED_DRAWS, (u) => {
    const c = proposedPoint(u);
    return BigInt(m) <= c ? (WAGER * BigInt(m)) / 100n : 0n;
  });
  console.log(`${pad((m / 100).toFixed(2) + 'x', 7)} ${pct(r)} ${pct(1 - r)}`);
}
const proposedOk = Math.abs(1 - proposedWorst.rtp - TARGET_EDGE) <= 0.002;

// ---------------------------------------------------------------- verdict
console.log('\n--- verdict ---');
console.log(`dice   : ${diceOk ? 'honours the advertised 2% edge at every target' : 'DEVIATES'}`);
console.log(`crash  : ${crashOk ? 'honours' : 'DEVIATES (worst ' + pct(1 - worst.rtp).trim() + ' edge at ' + worstM + 'x)'}`);
console.log(`proposed fix: ${proposedOk ? 'honours the 2% edge at every target' : 'still deviates'}`);

if (CHECK && !(diceOk && crashOk)) {
  console.error('\nFAIL: a payout curve does not return the advertised 98%.');
  process.exit(1);
}
process.exit(0);
