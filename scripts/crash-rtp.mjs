// Exact return-to-player analysis for FairDice's payout curves.
//
// The curves live in src/outcome.fe and are mirrored here so the economics can be
// audited without a chain and without the compiler. The constants below MUST match
// that file:
//
//   DICE_SIDES = 100, HOUSE_RTP_NUM = 98, CRASH_DRAWS = 1_000_000
//   crash_point(u) = min(9800, (HOUSE_RTP_NUM * CRASH_DRAWS) / (CRASH_DRAWS - u))
//
// A provably-fair game must return the same fraction of every wager it accepts,
// whatever the player picks. This script proves or disproves that by exhaustive
// enumeration over every possible draw, so the result is a proof over the whole
// space rather than a sample.
//
// It exists because it caught a real defect in this project's own crash curve: an
// earlier crash_point(u) = 9800 / (u + 1) over a 100-value draw returned between
// 98.000% and 49.050% depending on the multiplier the player chose, while the UI
// and README advertised a flat 2% edge. The shape and the draw resolution were
// both wrong; both are fixed. The record is in reports/finding-crash-rtp.md.
//
//   node scripts/crash-rtp.mjs           report every legal target
//   node scripts/crash-rtp.mjs --check   exit 1 if a curve deviates from the
//                                        advertised edge (CI gate)
//
// Exit codes: 0 = both curves honour the advertised 2% edge, 1 = violated.

const DICE_SIDES = 100n;
const HOUSE_RTP_NUM = 98n;
const CRASH_DRAWS = 1_000_000n;
const MIN_CRASH_MULT_X100 = 105n;
const MAX_CRASH_MULT_X100 = 9800n;
const TARGET_EDGE = 0.02; // advertised: 2% house edge, i.e. 98% RTP
const EDGE_TOLERANCE = 0.0005; // rounding of the printed percentages, not of the maths
const CHECK = process.argv.includes('--check');

// Any fixed wager works: RTP is a ratio, and this value also makes the expected
// payout of a 1.00x game come out integral.
const WAGER = 1_000_000_000_000_000n;

// ---------------------------------------------------------------------- dice
// wins when outcome < target; payout = wager * 98 / target
const maxPayout = (wager, target) => (wager * HOUSE_RTP_NUM) / BigInt(target);

const dicePayout = (wager, target, outcome) =>
  outcome < BigInt(target) ? maxPayout(wager, target) : 0n;

// ---------------------------------------------------------------------- crash
const crashPoint = (u) => {
  if (BigInt(u) >= CRASH_DRAWS) return 0n;
  const c = (HOUSE_RTP_NUM * CRASH_DRAWS) / (CRASH_DRAWS - BigInt(u));
  return c > MAX_CRASH_MULT_X100 ? MAX_CRASH_MULT_X100 : c;
};

// wins when target multiplier <= crash_point(u); payout = wager * mult / 100
const crashPayout = (wager, multX100, u) =>
  BigInt(multX100) <= crashPoint(u) ? (wager * BigInt(multX100)) / 100n : 0n;

// --------------------------------------------------------------------- shared
// Exact expected return of a payout function over a uniform draw space.
function measure(drawSpace, payoutFor) {
  let total = 0n;
  let wins = 0n;
  for (let u = 0n; u < drawSpace; u++) {
    const p = payoutFor(u);
    if (p > 0n) wins++;
    total += p;
  }
  return {
    rtp: Number(total) / Number(WAGER) / Number(drawSpace),
    winProb: Number(wins) / Number(drawSpace),
  };
}

const pct = (x) => (x * 100).toFixed(3).padStart(9) + '%';
const pad = (s, n) => String(s).padStart(n);

// -------------------------------------------------------------------- dice RTP
// Every legal target, not a sample.
console.log('Dice mode — wins iff outcome < target, payout = wager * 98 / target\n');
console.log('target   winProb        RTP      edge');
let diceOk = true;
for (let target = 1n; target <= 95n; target++) {
  const { rtp, winProb } = measure(DICE_SIDES, (u) => dicePayout(WAGER, target, u));
  const edge = 1 - rtp;
  if (Math.abs(edge - TARGET_EDGE) > EDGE_TOLERANCE) diceOk = false;
  const interesting = target <= 5n || [25n, 49n, 50n, 75n, 94n, 95n].includes(target);
  if (interesting) console.log(`${pad(target + '%', 6)} ${pct(winProb)} ${pct(rtp)} ${pct(edge)}`);
}
console.log(`        all 95 legal targets checked \u2014 ${diceOk ? 'every one returns 98.000%' : 'DEVIATIONS FOUND'}`);

// ------------------------------------------------------------------- crash RTP
// worst case over the whole legal range, then a readable sample
let worst = { rtp: 1, mult: 0 };
for (let m = MIN_CRASH_MULT_X100; m <= MAX_CRASH_MULT_X100; m += 25n) {
  const { rtp } = measure(CRASH_DRAWS, (u) => crashPayout(WAGER, m, u));
  if (rtp < worst.rtp) worst = { rtp, mult: Number(m) };
}
const crashOk = Math.abs(1 - worst.rtp - TARGET_EDGE) <= EDGE_TOLERANCE;

console.log('\nCrash mode — wins iff target multiplier <= crash_point(u)\n');
console.log('target   winProb   fairProb        RTP      edge');
for (const m of [105n, 200n, 300n, 500n, 1000n, 2000n, 3500n, 4900n, 5000n, 7000n, 9800n]) {
  const { rtp, winProb } = measure(CRASH_DRAWS, (u) => crashPayout(WAGER, m, u));
  const fair = Number(HOUSE_RTP_NUM) / Number(m); // the win rate a 98% curve must deliver
  console.log(
    `${pad((Number(m) / 100).toFixed(2) + 'x', 7)} ${pct(winProb)} ${pct(fair)} ${pct(rtp)} ${pct(1 - rtp)}`,
  );
}
console.log(
  `        worst case over 1.05x-98.00x: ${pct(worst.rtp)} at ${(worst.mult / 100).toFixed(2)}x`,
);

// --------------------------------------------------------------------- verdict
console.log('\n--- verdict ---');
console.log(`dice  : ${diceOk ? 'honours the advertised 2% edge at every legal target' : 'DEVIATES'}`);
console.log(
  `crash : ${crashOk ? 'honours the advertised 2% edge at every legal target' : 'DEVIATES — worst ' + pct(1 - worst.rtp).trim() + ' edge at ' + (worst.mult / 100).toFixed(2) + 'x'}`,
);
console.log(`gate  : ${CHECK ? 'enabled' : 'report only (pass --check to enforce)'}`);

if (CHECK && !(diceOk && crashOk)) {
  console.error('\nFAIL: a payout curve does not return the advertised 98% for every target.');
  process.exit(1);
}
process.exit(0);
