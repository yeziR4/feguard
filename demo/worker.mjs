import { loadEngine, campaign } from './client.mjs';
let engine;
try {
  const response = await fetch('./engine/feguard.wasm');
  if (!response.ok) throw new Error(`Engine download failed (${response.status}).`);
  engine = await loadEngine(await response.arrayBuffer());
  postMessage({ type: 'ready' });
} catch (error) { postMessage({ type: 'error', error: error.message }); }
self.onmessage = ({ data }) => {
  try { postMessage({ type: 'result', report: campaign(engine, data) }); }
  catch (error) { postMessage({ type: 'error', error: error.message }); }
};
