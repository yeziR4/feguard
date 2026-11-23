// Deployment-role resolution: turns one address into proxy / plain, initialized / not,
// and value-bearing / not, using only public reads corroborated across two providers.
// The classification itself is Fe (src/cohort.fe::role -> fg_role); this module only
// collects evidence and packs it into bits.
import { Rpc } from './inspection-lib.mjs';
import { pin } from './cohort-lib.mjs';
import { resolveRole } from '../inspection/cohort-policy.mjs';

const SLOT_IMPL = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc';
const SLOT_IMPL_LEGACY = '0x7050c9e0f4ca769c69bd3a8ef740bc37934f8e2c036e5a723fd8ee048ed3f8c3';
const MINIMAL_PROXY = '363d3d373d3d3d363d73';
const SEL_BALANCE_OF = '0x70a08231';
const ZERO = '0x0000000000000000000000000000000000000000';

export const word = (n) => '0x' + BigInt(n).toString(16).padStart(64, '0');
export const addressArg = (a) => '0x000000000000000000000000' + a.toLowerCase().replace(/^0x/, '');

export const isZeroWord = (w) => typeof w === 'string' && /^0x0{64}$/i.test(w);
export const wordToAddress = (w) => (isZeroWord(w) ? ZERO : '0x' + String(w).slice(-40).toLowerCase());

// Evidence bits consumed by src/cohort.fe::role().
export function roleBits({ runtimeCorroborated, isProxy, initialized, nativeValue, tokenValue }) {
  return (
    (runtimeCorroborated ? 1 : 0) |
    (isProxy ? 2 : 0) |
    (initialized ? 4 : 0) |
    (nativeValue ? 8 : 0) |
    (tokenValue ? 16 : 0)
  );
}

export function classify(engine, evidence) {
  return resolveRole(engine, roleBits(evidence));
}

// Read one address through two providers and return { evidence, verdict, detail }.
export async function probeRole(address, rpcs, block, engine, { token } = {}) {
  const read = (r, method, params) => r.read(method, params);
  const both = (method, params) => Promise.all(rpcs.map((r) => read(r, method, params)));

  const [codes, impls, legacy, natives, slots] = await Promise.all([
    both('eth_getCode', [address, block.tag]),
    both('eth_getStorageAt', [address, SLOT_IMPL, block.tag]),
    read(rpcs[0], 'eth_getStorageAt', [address, SLOT_IMPL_LEGACY, block.tag]),
    both('eth_getBalance', [address, block.tag]),
    both('eth_getStorageAt', [address, '0x0', block.tag]),
  ]);

  const code = codes.map((c) => (typeof c.result === 'string' ? c.result : ''));
  const runtimeCorroborated =
    code.length >= 2 && code[0].length > 2 && code.every((c) => c.toLowerCase() === code[0].toLowerCase());

  const implWords = impls.map((r) => r.result || '');
  const isMinimal = code[0].replace(/^0x/, '').startsWith(MINIMAL_PROXY);
  const isProxy = isMinimal || implWords.some((w) => !isZeroWord(w)) || !isZeroWord(legacy.result || '');

  // OZ v4 Initializable packs _initialized into the low byte of slot 0. v5 (ERC-7201)
  // is not covered here and would report initialized=false; callers get that limitation.
  const slotWords = slots.map((r) => r.result || '');
  const slotAgree = slotWords.length >= 2 && slotWords[0].toLowerCase() === slotWords[1].toLowerCase();
  const initialized = slotAgree && !isZeroWord(slotWords[0]) && (BigInt(slotWords[0]) & 0xffn) !== 0n;

  const nativeValue = natives.some((r) => r.result && BigInt(r.result) > 0n);

  let tokenValue = false;
  let tokenBalance = null;
  if (token) {
    const calls = await both('eth_call', [{ to: token, data: SEL_BALANCE_OF + addressArg(address).slice(2) }, block.tag]);
    if (calls.every((r) => typeof r.result === 'string' && r.result !== '0x')) {
      tokenBalance = BigInt(calls[0].result).toString();
      tokenValue = BigInt(calls[0].result) > 0n;
    }
  }

  const evidence = { runtimeCorroborated, isProxy, initialized, nativeValue, tokenValue };
  return {
    address,
    block,
    impl: isMinimal ? wordToAddress(code[0].slice(10, 50)) : wordToAddress(implWords.find((w) => !isZeroWord(w)) || ZERO),
    legacyImpl: wordToAddress(legacy.result || ZERO),
    token: token || null,
    tokenBalance,
    evidence,
    bits: roleBits(evidence),
    verdict: classify(engine, evidence),
  };
}

export async function resolveRoles(chainId, addresses, { engine, rpcUrls, token, transports } = {}) {
  if (!engine) throw new Error('resolveRoles requires an engine.');
  const rpcs = rpcUrls.map((url, i) => new Rpc(url, transports?.[i]));
  const block = await pin(rpcs, chainId);
  const rows = [];
  for (const address of addresses) rows.push(await probeRole(address, rpcs, block, engine, { token }));
  const after = await Promise.all(rpcs.map((r) => r.read('eth_getBlockByNumber', [block.tag, false])));
  if (after.some((r) => r.result?.hash?.toLowerCase() !== block.hash.toLowerCase())) throw new Error('Block changed; discard role resolution.');
  return { chainId, block, rows };
}
