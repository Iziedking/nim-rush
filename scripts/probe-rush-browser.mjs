import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import WebSocket from 'ws';

// Runs the actual development build. Supply --cdp=http://127.0.0.1:9222
// after adb forwarding to exercise the same flow on an attached Android.
const value = (name, fallback) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const origin = value('origin', 'http://127.0.0.1:4174');
const device = process.argv.some(a => a.startsWith('--cdp='));
const contactOnly = process.argv.includes('--contact-only');
const captureEnabled = !process.argv.includes('--no-screenshots');
const publicScreenshots = process.argv.includes('--public-screenshots');
const bridge = value('cdp', 'http://127.0.0.1:9338');
const output = process.argv.includes('--public-screenshots')
  ? join(process.cwd(), 'public/nim-rush/screenshots')
  : join(process.cwd(), 'docs/superpowers/rush-review');
await mkdir(output, { recursive: true });
let chrome;
let socket;
let request = 0;
const pending = new Map();
const faults = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++request;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 15_000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params }));
  });
}

async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, timeout: 10_000 });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function screenshot(name) {
  if (!captureEnabled) return;
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(join(output, `${name}.png`), Buffer.from(result.data, 'base64'));
}

async function key(code, down) {
  await send('Input.dispatchKeyEvent', { type: down ? 'keyDown' : 'keyUp', key: code, code,
    windowsVirtualKeyCode: { ArrowLeft: 37, ArrowRight: 39, ArrowDown: 40 }[code] });
}

async function checkShoulders() {
  const evidence = [];
  for (const sign of [-1, 1]) {
    const out = sign < 0 ? 'ArrowLeft' : 'ArrowRight', back = sign < 0 ? 'ArrowRight' : 'ArrowLeft';
    await key(out, true);
    let state;
    for (let n=0;n<100;n++) {
      state=await evaluate('window.blitzDebug.debugSnapshot()');
      if (Math.abs(state.state.laneOffset)>4.7 && state.state.speedMps<16 && state.state.speedMps>3) break;
      await delay(100);
    }
    await key(out, false);
    if (state.state.surface!=='grass' || state.state.speedMps>16 || state.state.speedMps<3) throw new Error(`Grass failed to roll slowly: ${JSON.stringify(state.state)}`);
    await screenshot(`grass-${sign<0?'uphill':'downhill'}`);
    const rolling=state.state.distanceMeters;
    await delay(300);
    const after=await evaluate('window.blitzDebug.debugSnapshot()');
    if (after.state.distanceMeters-rolling<.5) throw new Error('Grass acted like an invisible barrier.');
    await key(back, true);
    for (let n=0;n<100;n++) {
      state=await evaluate('window.blitzDebug.debugSnapshot()');
      if (Math.abs(state.state.laneOffset)<1.7) break;
      await delay(70);
    }
    await key(back, false);
    await delay(1500);
    const recovered=await evaluate('window.blitzDebug.debugSnapshot()');
    if (recovered.state.surface==='grass' || recovered.state.speedMps<4) throw new Error('Grass recovery failed.');
    evidence.push({ side: sign < 0 ? 'uphill' : 'downhill', grassSpeedKmh: after.state.speedMps * 3.6, forwardMetres: after.state.distanceMeters - rolling, recoveredSpeedKmh: recovered.state.speedMps * 3.6 });
  }
  return evidence;
}

async function inspectRider() {
  // Inspection uses the real live rig and its update method. No score or
  // gameplay state is changed; only this isolated test browser's camera.
  await evaluate(`(() => { const app=window.blitzDebug; cancelAnimationFrame(app.frameHandle); app.frameHandle=null;app.ui.style.visibility='hidden'; })()`);
  for (let i=0;i<4;i++) {
    await evaluate(`(() => { const app=window.blitzDebug,r=app.renderer,b=r.bike; for(let n=0;n<12;n++)b.update(app.state,0,1/60); const p=b.root.position; r.camera.position.set(p.x+3.5,p.y+1.2,p.z-1.2); r.camera.lookAt(p.x,p.y+1,p.z);r.camera.fov=42;r.camera.updateProjectionMatrix();r.renderer.render(r.scene,r.camera); })()`);
    await screenshot(`pedal-phase-${i}`);
  }
  await evaluate(`(() => { const app=window.blitzDebug;app.ui.style.visibility=''; app.previousTimestamp=null;app.frameHandle=requestAnimationFrame(app.frame); })()`);
}

try {
  if (!device) {
    const executable = [process.env.CHROME_BIN, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && existsSync(p));
    if (!executable) throw new Error('Set CHROME_BIN to an installed Chromium browser.');
    chrome = spawn(executable, ['--headless=new', '--remote-debugging-port=9338', '--no-first-run', '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', `--user-data-dir=${join(process.cwd(), `.atlas-shoot-profile-rush-${process.pid}`)}`, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  }
  let targets;
  for (let retry = 0; retry < 30; retry++) {
    try { targets = await fetch(`${bridge}/json`, { signal: AbortSignal.timeout(1000) }).then(r => r.json()); break; } catch { await delay(200); }
  }
  const target = targets?.find(t => t.type === 'page' && (!device || t.url.startsWith(origin)));
  if (!target) throw new Error('Open the local game on the attached browser first.');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timeout);
      if (message.error) p.reject(new Error(message.error.message)); else p.resolve(message.result);
    } else if (message.method === 'Runtime.exceptionThrown') faults.push(message.params.exceptionDetails.text);
  });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  await send('Page.enable'); await send('Runtime.enable');
  if (!device && !publicScreenshots) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await send('Page.navigate', { url: origin });
  /*
   * A returning rider, not a bypass. The app reads this key to decide whether
   * a wallet has been connected on this device, so seeding it puts the probe
   * in the same state as somebody who connected yesterday. The address is a
   * real Nimiq-shaped one so nothing downstream has to special-case it.
   */
  await evaluate(`(() => { try { localStorage.setItem('nim-atlas:blitz:wallet', 'NQ07 0000 0000 0000 0000 0000 0000 0000 0000'); localStorage.setItem('nim-atlas:blitz:username', 'Probe'); } catch {} })()`);
  await send('Page.navigate', { url: origin });
  let ready = false;
  for (let retry = 0; retry < 50; retry++) {
    ready = await evaluate('Boolean(window.blitzDebug && document.querySelector(".blitz-free-run"))');
    if (ready) break;
    await delay(200);
  }
  if (!ready) throw new Error('The course did not load within ten seconds.');
  if (!device) {
    await send('Emulation.setDeviceMetricsOverride', { width: publicScreenshots ? 1440 : 844, height: publicScreenshots ? 900 : 390, deviceScaleFactor: 1, mobile: !publicScreenshots });
    await delay(400);
    await screenshot('intro-landscape');
    const visible = await evaluate(`(() => { const r=document.querySelector('.blitz-free-run').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight&&r.right<=innerWidth; })()`);
    if (!visible) throw new Error('The ride action is clipped in landscape.');
    if (!publicScreenshots) await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    await delay(400);
  }
  await screenshot('intro');
  // A real gesture must resume a context suspended by fresh-profile autoplay.
  await key('ShiftLeft', true); await key('ShiftLeft', false);
  let menuAudio;
  for (let n=0;n<50;n++) {
    menuAudio=await evaluate('window.blitzDebug.debugSnapshot().audio');
    if (menuAudio.context==='running' && menuAudio.samples.includes('atlas-theme')) break;
    await delay(100);
  }
  if (menuAudio.context!=='running' || !menuAudio.samples.includes('atlas-theme')) throw new Error(`Menu audio did not start: ${JSON.stringify(menuAudio)}`);
  await evaluate(`document.querySelector('.blitz-sound').click()`);
  const muted = await evaluate('window.blitzDebug.debugSnapshot().audio');
  if (muted.samples.length || muted.bike || muted.scene!=='silent') throw new Error('Mute left an audio source playing.');
  await evaluate(`document.querySelector('.blitz-sound').click()`);
  await evaluate(`(() => { window.rushProbe = {frames: [], last: 0}; const frame=t=>{const p=window.rushProbe;if(p.last&&document.visibilityState==='visible')p.frames.push(t-p.last);p.last=t;if(p.frames.length>7200)p.frames.shift();requestAnimationFrame(frame)};requestAnimationFrame(frame);document.querySelector('.blitz-free-run').click(); })()`);
  await delay(4200);
  await evaluate(`document.querySelector('.blitz-pause').click()`);
  const paused = await evaluate('window.blitzDebug.debugSnapshot()');
  await delay(450);
  const pausedAgain = await evaluate('window.blitzDebug.debugSnapshot()');
  if (pausedAgain.audio.samples.length || pausedAgain.audio.bike) throw new Error('Pause left an audio loop playing.');
  if (!paused.paused || paused.state.distanceMeters !== pausedAgain.state.distanceMeters) throw new Error('Practice pause did not freeze the run.');
  await evaluate(`document.querySelector('.blitz-pause').click()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await delay(260);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  const steering = await evaluate('window.blitzDebug.debugSnapshot()');
  if (steering.audio.samples.length || !steering.audio.bike || steering.audio.context!=='running') throw new Error('Riding mix includes music or has no movement source.');
  if (steering.state.laneOffset <= 0) throw new Error('Steering did not move the bicycle right.');
  let snapshots = [], sawAirborne = false, sawImpact = false, finished = false, previousDistance = 0;
  const checkpoints = [125, 355, 700, 1180];
  const started = Date.now();
  let correcting = null;
  while (!contactOnly && Date.now() - started < 100_000) {
    const snapshot = await evaluate('window.blitzDebug.debugSnapshot()');
    snapshots.push(snapshot);
    sawAirborne ||= snapshot.state?.airborne === true;
    sawImpact ||= snapshot.state?.collisions > 0;
    for (const d of checkpoints) if (previousDistance < d && snapshot.state?.distanceMeters >= d) await screenshot(`course-${d}`);
    previousDistance = snapshot.state?.distanceMeters ?? previousDistance;
    if (snapshot.screen === 'result') {
      if (!snapshot.audio.samples.includes('atlas-theme') || snapshot.audio.bike) throw new Error('Results did not restore menu music.');
      finished = snapshot.state.phase==='finished'; break;
    }
    if (snapshot.audio.samples.length) throw new Error('Music leaked into the running course.');
    const desired = snapshot.state.laneOffset>2.5 ? 'ArrowLeft' : snapshot.state.laneOffset< -2.5 ? 'ArrowRight' : null;
    if (correcting && Math.abs(snapshot.state.laneOffset)<1.8) { await key(correcting,false); correcting=null; }
    if (!correcting && desired) { correcting=desired;await key(correcting,true); }
    await delay(150);
  }
  if (correcting) await key(correcting,false);
  let shoulderEvidence = null;
  if (contactOnly) {
    shoulderEvidence = await checkShoulders();
    await inspectRider();
  } else await screenshot('result');
  const metrics = await evaluate(`(() => { const f=window.rushProbe.frames.filter(x=>x>0).sort((a,b)=>a-b);return {samples:f.length,p50:f[Math.floor(f.length*.5)],p95:f[Math.floor(f.length*.95)],maxFrameMs:f.at(-1),framesOver50ms:f.filter(x=>x>50).length,framesOver250ms:f.filter(x=>x>250).length,heapBytes:performance.memory?.usedJSHeapSize,visibility:document.visibilityState,renderer:window.blitzDebug.debugSnapshot().renderer}; })()`);
  let idleFrameControl=null;
  if (!contactOnly) {
    const frameIndex=await evaluate('window.rushProbe.frames.length');
    await delay(1800);
    idleFrameControl=await evaluate(`(() => { const f=window.rushProbe.frames.slice(${frameIndex}+1).sort((a,b)=>a-b);return {samples:f.length,p50:f[Math.floor(f.length*.5)],p95:f[Math.floor(f.length*.95)]}; })()`);
  }
  const rematchStarted = Date.now();
  if (!contactOnly) await evaluate(`document.querySelector('.blitz-rematch').click()`);
  let rematch;
  for (let retry=0;retry<20;retry++) {
    rematch=await evaluate('window.blitzDebug.debugSnapshot()');
    if (rematch.screen==='run') break;
    await delay(50);
  }
  const rematchMs=Date.now()-rematchStarted;
  if (rematch?.screen!=='run' || !contactOnly && (rematch.state.distanceMeters>10 || rematch.state.collisions!==0)) throw new Error('Rematch did not reset the course.');
  let moving;
  const motionDeadline=Date.now()+10_000;
  do {
    moving=await evaluate('window.blitzDebug.debugSnapshot()');
    if (moving.state.phase==='running' && moving.state.speedMps>8) break;
    await delay(100);
  } while (Date.now()<motionDeadline);
  if (!(moving?.state.speedMps>8)) throw new Error('Rematch did not begin moving within ten seconds.');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  await delay(2200);
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowDown', code: 'ArrowDown', windowsVirtualKeyCode: 40 });
  const braking=await evaluate('window.blitzDebug.debugSnapshot()');
  if (!(braking.state.speedMps < moving.state.speedMps)) {
    await writeFile(join(output, 'brake-failure.json'), JSON.stringify({ moving, braking, metrics, rematchMs }, null, 2));
    throw new Error(`Brake did not reduce speed: ${JSON.stringify({ moving: moving.state, braking: braking.state, paused: braking.paused })}`);
  }
  if (braking.audio.samples.length || !braking.audio.bike) throw new Error('Rematch restarted menu music.');
  const result = { device, contactOnly, captureEnabled, grassRollingAndRecovery: contactOnly, shoulderEvidence, menuAudio, ridingAudio: steering.audio, pauseAudio: pausedAgain.audio, mute: true, finished, sawAirborne, sawImpact, pause: true, steering: true, rematchMs: contactOnly ? null : rematchMs, brake: true, metrics, idleFrameControl, faults,
    maxCalls: snapshots.length ? Math.max(...snapshots.map(s => s.renderer.render.calls)) : null, maxTriangles: snapshots.length ? Math.max(...snapshots.map(s => s.renderer.render.triangles)) : null,
    limitations: ['Desktop rendering is not a physical phone benchmark.', 'No wallet signing or reward transfer is exercised.'] };
  if (!publicScreenshots) await writeFile(join(output, contactOnly ? 'contact-report.json' : 'report.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (!contactOnly && (!finished || !sawAirborne) || faults.length) process.exitCode = 1;
} finally {
  socket?.close();
  if (chrome) chrome.kill();
}
