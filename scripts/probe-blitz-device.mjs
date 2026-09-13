import WebSocket from 'ws';

const mode = process.argv[2] ?? 'snapshot';
const seconds = Number(process.argv[3] ?? 8);
const targets = await fetch('http://127.0.0.1:9222/json').then((response) => response.json());
const matchingTargets = targets.filter((candidate) => candidate.type === 'page' && candidate.url === 'http://127.0.0.1:5174/');
const target = matchingTargets[0];
if (!target) throw new Error('Beacon Blitz is not open through the Android Chrome debugging bridge.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
let requestId = 0;
const pending = new Map();
const faults = [];

socket.on('message', (bytes) => {
  const message = JSON.parse(bytes.toString());
  if (message.id) {
    const callback = pending.get(message.id);
    if (callback) {
      pending.delete(message.id);
      callback(message);
    }
    return;
  }
  if (message.method === 'Runtime.exceptionThrown') faults.push(message.params.exceptionDetails.text);
  if (message.method === 'Log.entryAdded' && ['error', 'warning'].includes(message.params.entry.level)) {
    const entry = message.params.entry;
    faults.push(`${entry.level}: ${entry.text}${entry.url ? ` / ${entry.url}` : ''}`);
  }
});

await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

function send(method, params = {}) {
  requestId += 1;
  return new Promise((resolve) => {
    pending.set(requestId, resolve);
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}

async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true });
  if (response.error) throw new Error(response.error.message);
  if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text);
  return response.result.result.value;
}

if (mode === 'watch') {
  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: true });
  await new Promise((resolve) => setTimeout(resolve, seconds * 1_000));
  console.log(JSON.stringify({ seconds, faults }, null, 2));
} else if (mode === 'pixels') {
  const pixels = await evaluate(`(() => {
    const canvas = document.querySelector('canvas');
    const gl = canvas?.getContext('webgl2') ?? canvas?.getContext('webgl');
    if (!canvas || !gl) return JSON.stringify({ canvas: false });
    const points = [[.5,.5],[.25,.25],[.75,.25],[.25,.75],[.75,.75],[.5,.2],[.5,.8]];
    const samples = points.map(([x,y]) => {
      const rgba = new Uint8Array(4);
      gl.readPixels(Math.floor(canvas.width*x), Math.floor(canvas.height*y), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, rgba);
      return [...rgba];
    });
    return JSON.stringify({ contextLost: gl.isContextLost(), error: gl.getError(), samples });
  })()`);
  console.log(pixels);
} else {
  const snapshot = await evaluate(`JSON.stringify({
    url: location.href,
    screen: document.querySelector('[data-blitz-screen]')?.getAttribute('data-blitz-screen'),
    timer: document.querySelector('.blitz-timer')?.textContent ?? null,
    viewport: [innerWidth, innerHeight],
    display: [screen.width, screen.height],
    dpr: devicePixelRatio,
    canvas: [document.querySelector('canvas')?.width, document.querySelector('canvas')?.height],
    visibility: document.visibilityState,
    heapBytes: performance.memory?.usedJSHeapSize ?? null,
    matchingTargets: ${matchingTargets.length},
    debug: window.blitzDebug?.debugSnapshot?.() ?? null
  })`);
  console.log(snapshot);
}

socket.close();
