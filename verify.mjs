#!/usr/bin/env node
// FairDice independent off-chain verifier.
//
// Loads the WASM module compiled from the EXACT SAME `src/outcome.fe` source
// as the on-chain EVM `FairDice` contract (`fe build . --backend wasm --emit wasm`),
// reads a bet's seeds + outcome + payout from an EVM JSON-RPC node (or CLI /
// built-in vector), recomputes the roll and payout in WASM, and prints MATCH
// or MISMATCH.
//
// Usage:
//   node verify.mjs                          # verify built-in EVM-matched bet vector
//   node verify.mjs --tamper                 # corrupt serverSeed to prove cheat detection
//   node verify.mjs --rpc https://... --contract 0x... --bet-id 1 [--from-block 0] [--tamper]

import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Verified Solidity ABI selectors / topics for `FairDice` (from `out/FairDice.abi.json`)
const SELECTOR_GET_BET = '0x061e494f'; // getBet(uint256)
const TOPIC_BET_REVEALED =
  '0xb23d00b847ca5b09b5092b3610ad3525d33e24cfcf3558d093ab4b264a690084'; // BetRevealed(uint256,uint256,uint256,uint256,uint256)

// Built-in bet vector matching `contract_place_and_reveal_matches_shared_roll` in `src/dice_tests.fe`:
//   server_seed = 0x1111222233334444
//   client_seed = 0x5555666677778888
//   bet_id      = 1
//   target      = 26  (roll under 26; outcome = 25 -> win)
//   wager       = 1000 wei
//   payout      = floor(1000 * 98 / 26) = 3769 wei
const DEFAULT_BET = {
  betId: 1n,
  serverSeed: 0x1111222233334444n,
  clientSeed: 0x5555666677778888n,
  target: 26n,
  wager: 1000n,
  claimedOutcome: 25n,
  claimedPayout: 3769n,
};

function parseArgs(argv) {
  const opts = { tamper: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--tamper') opts.tamper = true;
    else if (k === '--help' || k === '-h') opts.help = true;
    else if (
      [
        '--wasm',
        '--abi',
        '--rpc',
        '--contract',
        '--bet-id',
        '--from-block',
        '--server-seed',
        '--client-seed',
        '--target',
        '--wager',
        '--claimed-outcome',
        '--claimed-payout',
      ].includes(k)
    ) {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${k}`);
      opts[k.slice(2)] = argv[++i];
    } else {
      throw new Error(`Unknown option: ${k}`);
    }
  }
  return opts;
}

const MASK64 = 0xffffffffffffffffn;
function splitU256(x) {
  const v = BigInt.asUintN(256, x);
  return [(v >> 192n) & MASK64, (v >> 128n) & MASK64, (v >> 64n) & MASK64, v & MASK64];
}
function splitU128(x) {
  const v = BigInt.asUintN(128, x);
  return [(v >> 64n) & MASK64, v & MASK64];
}
function padHex32(x) {
  return BigInt(x).toString(16).padStart(64, '0');
}
function hexWord(hex, wordIndex) {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const slice = clean.slice(wordIndex * 64, (wordIndex + 1) * 64);
  if (slice.length < 64) throw new Error(`ABI word ${wordIndex} truncated`);
  return BigInt('0x' + slice);
}

async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${json.error.message ?? JSON.stringify(json.error)}`);
  return json.result;
}

async function fetchBetFromChain(rpcUrl, contract, betId, fromBlock = null) {
  const callData = SELECTOR_GET_BET + padHex32(betId);
  const rawBet = await rpcCall(rpcUrl, 'eth_call', [{ to: contract, data: callData }, 'latest']);
  if (!rawBet || rawBet === '0x') throw new Error('getBet returned empty data');

  const clean = rawBet.startsWith('0x') ? rawBet.slice(2) : rawBet;
  const wordCount = Math.floor(clean.length / 64);

  // Common Bet prefix (words 0..8):
  // 0: player, 1: wager, 2: target, 3: client_commitment, 4: server_commitment|sequence_number,
  // 5: block_number, 6: settled, 7: outcome, 8: payout, [9: entropy_value (Pyth Entropy V2)]
  const wager = hexWord(rawBet, 1);
  const target = hexWord(rawBet, 2);
  const clientCommitment = hexWord(rawBet, 3);
  const word4 = hexWord(rawBet, 4);
  const placedBlock = hexWord(rawBet, 5);
  const settled = hexWord(rawBet, 6) !== 0n;
  const claimedOutcome = hexWord(rawBet, 7);
  const claimedPayout = hexWord(rawBet, 8);

  if (!settled) {
    throw new Error(`Bet #${betId} is not settled yet on-chain.`);
  }

  // Task B / Crash (Pyth Entropy V2) stores `entropy_value` in word 9, and
  // optionally `mode` (0=Dice, 1=Crash) in word 10 and `crash_target` (x100) in word 11.
  if (wordCount >= 10) {
    const entropyValue = hexWord(rawBet, 9);
    if (entropyValue === 0n) {
      throw new Error(`Bet #${betId} has zero entropy_value (likely refunded via refundExpired).`);
    }
    const modeNum = wordCount >= 12 ? hexWord(rawBet, 10) : 0n;
    const crashTarget = wordCount >= 12 ? hexWord(rawBet, 11) : 0n;
    return {
      mode: modeNum === 1n ? 'crash' : 'entropy',
      betId: BigInt(betId),
      sequenceNumber: word4,
      serverSeed: entropyValue,
      clientSeed: clientCommitment,
      target: modeNum === 1n ? crashTarget : target,
      wager,
      claimedOutcome,
      claimedPayout,
    };
  }

  // Legacy Task A (commit-reveal) mode: 9 words, seeds emitted in BetRevealed log.
  const head = BigInt(await rpcCall(rpcUrl, 'eth_blockNumber', []));
  const startBlock = fromBlock !== null ? BigInt(fromBlock) : placedBlock;
  const CHUNK = 199n; // Base Sepolia public RPC limits eth_getLogs to a 200-block window
  let logs = [];

  for (let cursor = startBlock; cursor <= head; cursor += CHUNK + 1n) {
    const end = cursor + CHUNK > head ? head : cursor + CHUNK;
    const chunkLogs = await rpcCall(rpcUrl, 'eth_getLogs', [
      {
        address: contract,
        fromBlock: '0x' + cursor.toString(16),
        toBlock: '0x' + end.toString(16),
        topics: [TOPIC_BET_REVEALED, '0x' + padHex32(betId)],
      },
    ]);
    if (Array.isArray(chunkLogs) && chunkLogs.length > 0) {
      logs = chunkLogs;
      break;
    }
  }

  if (logs.length === 0) {
    throw new Error(`No BetRevealed log found for bet #${betId} (bet may have been refunded).`);
  }

  // BetRevealed non-indexed data: [server_seed, client_seed, outcome, payout]
  const logData = logs[0].data;
  const serverSeed = hexWord(logData, 0);
  const clientSeed = hexWord(logData, 1);

  return {
    mode: 'commit-reveal',
    betId: BigInt(betId),
    serverSeed,
    clientSeed,
    clientCommitment,
    serverCommitment: word4,
    target,
    wager,
    claimedOutcome,
    claimedPayout,
  };
}

async function loadVerifier(wasmPath) {
  const bytes = await readFile(wasmPath);
  const { instance } = await WebAssembly.instantiate(bytes, {
    env: {
      __fe_revert: () => {
        throw new Error('Fe WASM verifier reverted.');
      },
    },
  });
  return instance.exports;
}

async function main() {
  const opts = parseArgs(process.argv);
  if (opts.help) {
    console.log(
      'Usage: node verify.mjs [--rpc URL --contract 0x... --bet-id N] [--tamper] [--wasm out/feguard.wasm]'
    );
    return;
  }

  const wasmPath = resolve(__dirname, opts.wasm ?? 'out/feguard.wasm');
  const abiPath = resolve(__dirname, opts.abi ?? 'out/FairDice.abi.json');

  // Sanity-check ABI presence
  const abi = JSON.parse(await readFile(abiPath, 'utf8'));
  const hasGetBet = abi.some((e) => e.type === 'function' && e.name === 'getBet');
  const hasEvent = abi.some(
    (e) => e.type === 'event' && (e.name === 'BetRevealed' || e.name === 'BetSettled')
  );
  if (!hasGetBet || !hasEvent) {
    throw new Error(`ABI at ${abiPath} does not match FairDice.`);
  }

  let bet;
  if (opts.rpc) {
    if (!opts.contract || !opts['bet-id']) {
      throw new Error('--rpc requires --contract and --bet-id');
    }
    bet = await fetchBetFromChain(opts.rpc, opts.contract, BigInt(opts['bet-id']), opts['from-block'] ?? null);
  } else {
    bet = {
      betId: opts['bet-id'] ? BigInt(opts['bet-id']) : DEFAULT_BET.betId,
      serverSeed: opts['server-seed'] ? BigInt(opts['server-seed']) : DEFAULT_BET.serverSeed,
      clientSeed: opts['client-seed'] ? BigInt(opts['client-seed']) : DEFAULT_BET.clientSeed,
      target: opts.target ? BigInt(opts.target) : DEFAULT_BET.target,
      wager: opts.wager ? BigInt(opts.wager) : DEFAULT_BET.wager,
      claimedOutcome: opts['claimed-outcome'] ? BigInt(opts['claimed-outcome']) : DEFAULT_BET.claimedOutcome,
      claimedPayout: opts['claimed-payout'] ? BigInt(opts['claimed-payout']) : DEFAULT_BET.claimedPayout,
    };
  }

  const serverSeedToCheck = opts.tamper ? bet.serverSeed ^ 1n : bet.serverSeed;
  const wasm = await loadVerifier(wasmPath);

  const sLimbs = splitU256(serverSeedToCheck);
  const cLimbs = splitU256(bet.clientSeed);
  const wLimbs = splitU128(bet.wager);
  const pLimbs = splitU128(bet.claimedPayout);

  const isCrash = bet.mode === 'crash';
  const packed = BigInt.asUintN(
    64,
    isCrash
      ? wasm.fg_verify_crash_bet(
          ...sLimbs,
          ...cLimbs,
          bet.betId,
          bet.target,
          ...wLimbs,
          bet.claimedOutcome,
          ...pLimbs
        )
      : wasm.fg_verify_bet(
          ...sLimbs,
          ...cLimbs,
          bet.betId,
          bet.target,
          ...wLimbs,
          bet.claimedOutcome,
          ...pLimbs
        )
  );

  const outcomeMatches = (packed & 1n) === 1n;
  const payoutMatches = (packed & 2n) === 2n;
  const recomputedOutcome = isCrash ? (packed >> 8n) & 0xffffn : (packed >> 8n) & 0xffn;

  let commitOk = true;
  if (bet.serverCommitment !== undefined) {
    const scOk = wasm.fg_verify_commit(...sLimbs, ...splitU256(bet.serverCommitment)) === 1n;
    const ccOk = wasm.fg_verify_commit(...cLimbs, ...splitU256(bet.clientCommitment)) === 1n;
    commitOk = scOk && ccOk;
  }

  const allMatch = outcomeMatches && payoutMatches && commitOk;
  const verdict = allMatch ? 'MATCH' : 'MISMATCH';

  console.log(`Verdict:             ${verdict}${opts.tamper ? ' (TAMPER MODE: serverSeed ^= 1)' : ''}`);
  console.log(`Game mode:           ${isCrash ? 'CRASH' : 'DICE'}`);
  console.log(`WASM verifier:       ${wasmPath}`);
  console.log(`Bet ID:              ${bet.betId}`);
  console.log(`Server seed (used):  0x${serverSeedToCheck.toString(16)}`);
  console.log(`Client seed:         0x${bet.clientSeed.toString(16)}`);
  console.log(
    isCrash
      ? `Target multiplier:   ${(Number(bet.target) / 100).toFixed(2)}x (${bet.target})`
      : `Target:              < ${bet.target}`
  );
  console.log(`Wager (wei):         ${bet.wager}`);
  console.log(
    isCrash
      ? `Claimed crash point: ${(Number(bet.claimedOutcome) / 100).toFixed(2)}x (${bet.claimedOutcome})`
      : `Claimed outcome:     ${bet.claimedOutcome}`
  );
  console.log(
    isCrash
      ? `Recomputed crash:    ${(Number(recomputedOutcome) / 100).toFixed(2)}x (${recomputedOutcome}) (${outcomeMatches ? 'OK' : 'DIFFERS'})`
      : `Recomputed outcome:  ${recomputedOutcome} (${outcomeMatches ? 'OK' : 'DIFFERS'})`
  );
  console.log(`Claimed payout:      ${bet.claimedPayout} wei (${payoutMatches ? 'OK' : 'DIFFERS'})`);
  if (bet.serverCommitment !== undefined) {
    console.log(`Commitments valid:   ${commitOk ? 'YES' : 'NO'}`);
  }

  if (!allMatch) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`Verifier error: ${err.message}`);
  process.exitCode = 2;
});
