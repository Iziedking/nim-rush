import { BLITZ_LIMIT_SECONDS, BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../../../shared/atlas/blitz/core';
import { blitzCity, nextBlitzCity } from '../../../shared/atlas/blitz/cities';
import type { BlitzChoice, BlitzCityId, BlitzRunState, BlitzTraceFrame } from '../../../shared/atlas/blitz/types';
import type { BlitzTicket } from '../../../shared/atlas/blitz/competition';
import { hashBlitzTrace } from '../../../shared/atlas/blitz/replay';
import { getOrCreateCredential } from '../../net/player-credential';
import { createAtlasApiClient } from '../api';
import { createAtlasWalletAdapter } from '../wallet';
import { createAtlasWalletBindingFlow } from '../wallet-binding';
import { createAtlasAudio } from '../audio/atlas-audio';
import { BlitzRenderer } from '../render/three/blitz-renderer';
import { BlitzInputController } from './blitz-input';
import { BlitzFrameGovernor } from './frame-governor';

const STEP_MS = 1_000 / BLITZ_TICK_RATE;
const BLITZ_SEASON = 'cycle-2';

export class BlitzApp {
  private readonly renderer: BlitzRenderer;
  private readonly input = new BlitzInputController();
  private readonly api = createAtlasApiClient({ baseUrl: import.meta.env.VITE_API_BASE ?? '' });
  private readonly wallet = createAtlasWalletAdapter();
  private readonly walletBinding = createAtlasWalletBindingFlow({ api: this.api, wallet: this.wallet });
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly audio = createAtlasAudio();
  private readonly frameGovernor = new BlitzFrameGovernor(60);
  private state: BlitzRunState | null = null;
  private frames: BlitzTraceFrame[] = [];
  private cityId: BlitzCityId = 'lagos';
  private pendingChoice: BlitzChoice | undefined;
  private frameHandle: number | null = null;
  private previousTimestamp: number | null = null;
  private accumulator = 0;
  private shownRelay = -1;
  private scoreNode: HTMLElement | null = null;
  private timerNode: HTMLElement | null = null;
  private speedNode: HTMLElement | null = null;
  private progressNode: HTMLElement | null = null;
  private boostNode: HTMLElement | null = null;
  private relayHost: HTMLElement | null = null;
  private countdownNode: HTMLElement | null = null;
  private feedbackNode: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private paused = false;
  private rankedTicket: BlitzTicket | null = null;
  private rankedInterrupted = false;

  constructor(private readonly ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new BlitzRenderer(canvas);
  }

  async boot(): Promise<void> {
    try {
      this.ui.className = 'blitz-ui';
      await this.renderer.initialize(this.reducedMotion);
      await this.renderer.loadCity('lagos');
      this.resize();
      this.renderer.renderPreview('lagos');
      this.renderIntro();
      window.addEventListener('pointerdown', () => { this.audio.unlock(); this.audio.playTheme(); }, { once: true });
      window.addEventListener('resize', this.resize);
      document.addEventListener('visibilitychange', this.visibilityChanged);
    } catch (error) {
      console.error('Beacon Blitz failed to start.', error);
      this.renderUnavailable();
    }
  }

  debugSnapshot(): object {
    return {
      screen: this.ui.querySelector('[data-blitz-screen]')?.getAttribute('data-blitz-screen') ?? null,
      paused: this.paused,
      state: this.state ? {
        cityId: this.state.cityId,
        phase: this.state.phase,
        distanceMeters: this.state.distanceMeters,
        laneOffset: this.state.laneOffset,
        speedMps: this.state.speedMps,
        boostEnergy: this.state.boostEnergy,
        boostActive: this.state.boostActive,
        driftActive: this.state.driftActive,
        activeRelay: this.state.activeRelay?.missionIndex ?? null,
      } : null,
      renderer: this.renderer.debugSnapshot(),
    };
  }

  async debugStartCity(cityId: BlitzCityId): Promise<void> {
    if (!import.meta.env.DEV) return;
    await this.startRun(cityId);
  }

  private renderIntro(): void {
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-intro');
    screen.setAttribute('data-blitz-screen', 'intro');
    const brand = node('div', 'blitz-brand', 'NIM ATLAS');
    const edition = node('span', 'blitz-edition', 'BEACON BLITZ');
    const title = node('h1', 'blitz-title', 'LAGOS\nPULSE');
    const line = node('p', 'blitz-tagline', 'Ride the signal. Read the network. Own the line.');
    const city = blitzCity('lagos');
    const stats = node('div', 'blitz-intro-stats');
    stats.append(stat('90 SEC', 'RUN'), stat('3', 'RELAYS'), stat('01 / 03', 'CITY'));
    const start = button('Ride Lagos', 'blitz-start', () => void this.startRun('lagos'));
    const note = node('p', 'blitz-quiet', `${city.callout} Guest play starts instantly.`);
    screen.append(brand, edition, title, line, stats, start, note);
    this.ui.append(screen);
  }

  private async startRun(cityId: BlitzCityId, rankedTicket: BlitzTicket | null = null): Promise<void> {
    this.cityId = cityId;
    this.rankedTicket = rankedTicket;
    this.rankedInterrupted = false;
    const seed = rankedTicket?.seed ?? `${cityId}-${new Date().toISOString().slice(0, 10)}-${Math.floor(Date.now() / 60_000)}`;
    this.state = createBlitzRun({ cityId, seed });
    this.frames = [];
    this.pendingChoice = undefined;
    this.shownRelay = -1;
    this.paused = false;
    this.input.reset();
    await this.renderer.loadCity(cityId);
    this.audio.stopTheme();
    this.audio.playCityAmbience();
    this.renderRun();
    this.previousTimestamp = null;
    this.accumulator = 0;
    this.frameGovernor.reset();
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = requestAnimationFrame(this.frame);
  }

  private renderRun(): void {
    const city = blitzCity(this.cityId);
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-run');
    screen.setAttribute('data-blitz-screen', 'run');
    const top = node('header', 'blitz-hud');
    const cityName = node('div', 'blitz-city-name', city.circuit);
    this.timerNode = node('div', 'blitz-timer', '90.0');
    this.scoreNode = node('div', 'blitz-score', '000000');
    this.pauseButton = button(this.rankedTicket ? 'LIVE' : 'II', 'blitz-pause', this.togglePause);
    this.pauseButton.setAttribute('aria-label', this.rankedTicket ? 'Ranked run cannot be paused' : 'Pause Beacon Blitz');
    top.append(cityName, this.timerNode, this.scoreNode, this.pauseButton);

    const speedBox = node('div', 'blitz-speed-box');
    this.speedNode = node('strong', 'blitz-speed', '000');
    speedBox.append(this.speedNode, node('span', '', 'KM/H'));
    const progress = node('div', 'blitz-progress');
    this.progressNode = node('i', 'blitz-progress-fill');
    progress.append(this.progressNode);
    const boost = node('div', 'blitz-boost-wrap');
    boost.append(node('span', '', 'BOOST'));
    const boostTrack = node('div', 'blitz-boost-meter');
    this.boostNode = node('i', 'blitz-boost-fill');
    boostTrack.append(this.boostNode);
    boost.append(boostTrack);

    this.relayHost = node('section', 'blitz-relay-host');
    this.relayHost.setAttribute('aria-live', 'polite');
    this.feedbackNode = node('div', 'blitz-feedback');
    this.feedbackNode.setAttribute('aria-live', 'polite');
    this.countdownNode = node('div', 'blitz-countdown', '3');

    const controls = node('section', 'blitz-controls');
    const steerZone = node('div', 'blitz-control blitz-steer-zone');
    steerZone.setAttribute('aria-label', 'Drag left or right to steer');
    const steerRail = node('div', 'blitz-steer-rail');
    const thumb = node('i', 'blitz-steer-thumb');
    steerRail.append(thumb);
    steerZone.append(node('span', '', 'STEER'), steerRail);
    const actions = node('div', 'blitz-actions');
    const drift = button('DRIFT', 'blitz-control blitz-drift', () => undefined);
    const boostButton = button('BOOST', 'blitz-control blitz-boost', () => undefined);
    actions.append(drift, boostButton);
    controls.append(steerZone, actions);
    this.input.bindSteering(steerZone, thumb);
    this.input.bindHold(drift, 'drift');
    this.input.bindHold(boostButton, 'boost');

    screen.append(top, speedBox, progress, boost, this.relayHost, this.feedbackNode, this.countdownNode, controls);
    this.ui.append(screen);
  }

  private frame = (timestamp: number): void => {
    this.frameHandle = null;
    const state = this.state;
    if (!state) return;
    const elapsed = this.previousTimestamp === null || this.paused ? 0 : Math.min(250, Math.max(0, timestamp - this.previousTimestamp));
    this.previousTimestamp = timestamp;
    this.accumulator += elapsed;
    let next = state;
    let steps = 0;
    while (this.accumulator >= STEP_MS && steps < 8 && next.phase !== 'finished' && next.phase !== 'timeout') {
      const sampled = this.input.sample();
      const input = { ...sampled, ...(this.pendingChoice ? { relayChoice: this.pendingChoice } : {}) };
      this.pendingChoice = undefined;
      const frame: BlitzTraceFrame = { tick: this.frames.length, input };
      this.frames.push(frame);
      next = stepBlitzRun(next, input);
      this.accumulator -= STEP_MS;
      steps += 1;
    }
    this.state = next;
    if (this.frameGovernor.shouldRender(timestamp)) {
      this.renderer.render(next, this.input.sample().steer);
      this.updateRunHud(next);
    }
    if (next.phase === 'finished' || next.phase === 'timeout') {
      this.renderResult(next);
      return;
    }
    this.frameHandle = requestAnimationFrame(this.frame);
  };

  private updateRunHud(state: BlitzRunState): void {
    const city = blitzCity(state.cityId);
    const remaining = Math.max(0, BLITZ_LIMIT_SECONDS - state.elapsedMs / 1_000);
    if (this.timerNode) this.timerNode.textContent = remaining.toFixed(1);
    if (this.scoreNode) this.scoreNode.textContent = Math.round(state.score).toString().padStart(6, '0');
    if (this.speedNode) this.speedNode.textContent = Math.round(state.speedMps * 3.6).toString().padStart(3, '0');
    if (this.progressNode) this.progressNode.style.width = `${Math.min(100, state.distanceMeters / city.lengthMeters * 100)}%`;
    if (this.boostNode) this.boostNode.style.width = `${state.boostEnergy}%`;
    if (this.countdownNode) {
      this.countdownNode.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdownTicks / BLITZ_TICK_RATE))) : 'GO';
      this.countdownNode.classList.toggle('is-live', state.phase === 'running');
    }
    const relayIndex = state.activeRelay?.missionIndex ?? -1;
    if (relayIndex !== this.shownRelay) {
      this.shownRelay = relayIndex;
      this.renderRelay(state);
    }
  }

  private renderRelay(state: BlitzRunState): void {
    if (!this.relayHost) return;
    this.relayHost.replaceChildren();
    if (!state.activeRelay) return;
    const mission = state.missions[state.activeRelay.missionIndex]!;
    const card = node('div', 'blitz-relay-card');
    card.append(node('span', 'blitz-relay-label', mission.label), node('h2', '', mission.prompt));
    const choices = node('div', 'blitz-relay-choices');
    choices.append(
      button(mission.left, 'blitz-relay-choice', () => this.chooseRelay('left')),
      button(mission.right, 'blitz-relay-choice', () => this.chooseRelay('right')),
    );
    card.append(choices);
    this.relayHost.append(card);
  }

  private chooseRelay(choice: BlitzChoice): void {
    const relay = this.state?.activeRelay;
    const mission = relay === undefined || relay === null ? null : this.state?.missions[relay.missionIndex];
    if (mission && this.feedbackNode) {
      const correct = choice === mission.correctChoice;
      this.feedbackNode.textContent = `${correct ? 'SYNCED +1200' : 'MISSED'} / ${mission.explanation}`;
      this.feedbackNode.className = `blitz-feedback ${correct ? 'is-correct' : 'is-wrong'}`;
      this.audio.playWorldCue(correct ? 'route-evidence' : 'route-refused');
      window.setTimeout(() => {
        if (this.feedbackNode) this.feedbackNode.className = 'blitz-feedback';
      }, 1_900);
    }
    this.pendingChoice = choice;
  }

  private togglePause = (): void => {
    if (this.rankedTicket && !this.rankedInterrupted) {
      if (this.feedbackNode) {
        this.feedbackNode.textContent = 'RANKED RUNS STAY LIVE / KEEP RIDING';
        this.feedbackNode.className = 'blitz-feedback is-wrong';
      }
      this.audio.playWorldCue('route-refused');
      return;
    }
    this.paused = !this.paused;
    this.previousTimestamp = null;
    this.accumulator = 0;
    this.frameGovernor.reset();
    this.input.reset();
    if (this.pauseButton) {
      this.pauseButton.textContent = this.paused ? '▶' : 'II';
      this.pauseButton.setAttribute('aria-label', this.paused ? 'Resume Beacon Blitz' : 'Pause Beacon Blitz');
    }
    if (this.feedbackNode) {
      this.feedbackNode.textContent = this.paused ? 'PAUSED / TAP ▶ TO RIDE' : '';
      this.feedbackNode.className = this.paused ? 'blitz-feedback is-paused' : 'blitz-feedback';
    }
  };

  private renderResult(state: BlitzRunState): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.input.reset();
    this.input.clearBindings();
    this.audio.stopCityAmbience();
    this.audio.playTheme();
    if (state.phase === 'finished') this.audio.playWorldCue('route-complete');
    const city = blitzCity(state.cityId);
    const nextCityId = nextBlitzCity(state.cityId);
    const next = blitzCity(nextCityId);
    const best = this.saveBest(state);
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-result');
    screen.setAttribute('data-blitz-screen', 'result');
    screen.append(node('div', 'blitz-brand', 'NIM ATLAS / BEACON BLITZ'));
    screen.append(node('p', 'blitz-result-kicker', state.phase === 'finished' ? `${city.name.toUpperCase()} CLEARED` : 'SIGNAL LOST'));
    screen.append(node('h1', 'blitz-result-score', state.score.toLocaleString()));
    screen.append(node('p', 'blitz-result-best', best === state.score ? 'NEW PERSONAL BEST' : `PERSONAL BEST ${best.toLocaleString()}`));
    const breakdown = node('div', 'blitz-breakdown');
    breakdown.append(stat(state.distanceScore.toLocaleString(), 'LINE'), stat(state.driftScore.toLocaleString(), 'DRIFT'), stat(state.relayScore.toLocaleString(), 'RELAYS'), stat(`-${state.penaltyScore.toLocaleString()}`, 'PENALTY'));
    screen.append(breakdown);
    const reveal = node('section', 'blitz-next-city');
    reveal.append(node('span', '', 'NEXT CIRCUIT'), node('h2', '', next.circuit), node('p', '', next.callout));
    reveal.append(button(`Ride ${next.name}`, 'blitz-start blitz-next', () => void this.startRun(nextCityId)));
    screen.append(reveal);
    const competition = node('details', 'blitz-competition');
    competition.open = Boolean(this.rankedTicket);
    competition.append(node('summary', 'blitz-competition-summary', this.rankedTicket ? 'RANKED RUN STATUS' : 'RANK THIS CITY / LEADERBOARD'));
    const rankStatus = node('p', 'blitz-rank-status', this.rankedTicket ? 'VERIFYING THIS RANKED RUN...' : 'CONNECT ONCE TO START A VERIFIED RUN. NO PAYMENT.');
    competition.append(rankStatus);
    if (this.rankedTicket) {
      if (this.rankedInterrupted) rankStatus.textContent = 'NOT VERIFIED / THIS RANKED RUN LEFT THE SCREEN.';
      else void this.submitRankedRun(state, rankStatus, competition);
    } else {
      const username = node('input', 'blitz-username');
      username.type = 'text';
      username.inputMode = 'text';
      username.autocomplete = 'username';
      username.maxLength = 18;
      username.placeholder = 'Leaderboard username';
      username.setAttribute('aria-label', 'Leaderboard username');
      try { username.value = localStorage.getItem('nim-atlas:blitz:username') ?? ''; } catch { /* Storage is optional. */ }
      const identity = button('CONNECT WALLET / START RANKED RUN', 'blitz-verify', () => void this.prepareRankedRun(state.cityId, username, identity, rankStatus));
      competition.append(username, identity);
      void this.loadLeaderboard(state.cityId, competition);
    }
    screen.append(competition);
    screen.append(button(`Ride ${city.name} again`, 'blitz-again', () => void this.startRun(state.cityId)));
    this.ui.append(screen);
  }

  private async prepareRankedRun(cityId: BlitzCityId, usernameInput: HTMLInputElement, buttonNode: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const username = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) {
      status.textContent = 'USE 3–18 LETTERS, NUMBERS, OR UNDERSCORES.';
      return;
    }
    buttonNode.disabled = true;
    status.textContent = 'OPENING NIMIQ WALLET FOR AN IDENTITY SIGNATURE. NO PAYMENT.';
    try {
      const initialized = await this.wallet.initialize();
      if (!initialized.ok) throw new Error(initialized.reason === 'timeout' ? 'Nimiq Wallet took too long. Try again.' : 'Nimiq Wallet is unavailable in this browser.');
      const credential = await getOrCreateCredential();
      const binding = await this.walletBinding.bind({ actorId: credential.playerId, seasonId: BLITZ_SEASON, network: 'testalbatross' });
      if (!binding.ok) throw new Error(binding.error);
      const ticket = await this.api.issueBlitzTicket({ actorId: credential.playerId, walletAddress: binding.value.address, username, cityId, seasonId: BLITZ_SEASON });
      if (!ticket.ok) throw new Error(ticket.error);
      try { localStorage.setItem('nim-atlas:blitz:username', username); } catch { /* Storage is optional. */ }
      status.textContent = 'IDENTITY VERIFIED. LOADING THE RANKED SEED...';
      await this.startRun(cityId, ticket.value);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RANKED MODE IS UNAVAILABLE.';
      buttonNode.disabled = false;
    }
  }

  private async submitRankedRun(state: BlitzRunState, status: HTMLElement, host: HTMLElement): Promise<void> {
    const ticket = this.rankedTicket;
    if (!ticket) return;
    try {
      const traceHash = await hashBlitzTrace(this.frames);
      const result = await this.api.submitBlitzRun({
        runId: crypto.randomUUID(), ticketId: ticket.id, actorId: ticket.actorId, walletAddress: ticket.walletAddress,
        username: ticket.username, cityId: ticket.cityId, seasonId: ticket.seasonId, seed: ticket.seed,
        frames: this.frames, traceHash, claimedScore: state.score,
      });
      if (!result.ok) throw new Error(result.error);
      status.textContent = `VERIFIED #${result.value.row.rank} / ${ticket.username} / ${shortWallet(ticket.walletAddress)}`;
    } catch (error) {
      status.textContent = error instanceof Error ? `NOT VERIFIED / ${error.message.toUpperCase()}` : 'THIS RUN COULD NOT BE VERIFIED.';
    }
    await this.loadLeaderboard(state.cityId, host);
  }

  private async loadLeaderboard(cityId: BlitzCityId, host: HTMLElement): Promise<void> {
    const existing = host.querySelector('.blitz-leaderboard');
    existing?.remove();
    const board = node('div', 'blitz-leaderboard');
    try {
      const rows = await this.api.getBlitzLeaderboard(BLITZ_SEASON, cityId);
      board.append(node('h3', '', `${blitzCity(cityId).name.toUpperCase()} VERIFIED RIDERS`));
      if (rows.length === 0) board.append(node('p', '', 'No verified riders yet. The first clean line is yours.'));
      for (const row of rows.slice(0, 5)) {
        const item = node('div', 'blitz-leaderboard-row');
        item.append(node('b', '', `#${row.rank}`), node('span', '', row.username), node('small', '', shortWallet(row.walletAddress)), node('strong', '', row.score.toLocaleString()));
        board.append(item);
      }
    } catch {
      board.append(node('p', '', 'Verified leaderboard is offline. Your local best is safe on this device.'));
    }
    host.append(board);
  }

  private saveBest(state: BlitzRunState): number {
    const key = `nim-atlas:blitz:best:${state.cityId}`;
    let previous = 0;
    try { previous = Number(localStorage.getItem(key) ?? 0); } catch { /* Private storage can be unavailable. */ }
    const best = Math.max(previous, state.score);
    try { localStorage.setItem(key, String(best)); } catch { /* The run remains playable without storage. */ }
    return best;
  }

  private renderUnavailable(): void {
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-unavailable');
    screen.append(node('div', 'blitz-brand', 'NIM ATLAS'), node('h1', '', 'BIKE IS IN THE SHOP'), node('p', '', 'This device could not start the 3D circuit. Reload once, or use a WebGL-capable browser.'));
    screen.append(button('Reload', 'blitz-start', () => location.reload()));
    this.ui.append(screen);
  }

  private visibilityChanged = (): void => {
    if (document.hidden) {
      if (this.rankedTicket) this.rankedInterrupted = true;
      this.paused = true;
      this.previousTimestamp = null;
      this.accumulator = 0;
      this.input.reset();
      if (this.pauseButton) { this.pauseButton.textContent = '▶'; this.pauseButton.setAttribute('aria-label', 'Resume Beacon Blitz'); }
      if (this.feedbackNode) { this.feedbackNode.textContent = 'PAUSED / TAP ▶ TO RIDE'; this.feedbackNode.className = 'blitz-feedback is-paused'; }
    }
  };

  private resize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio, 1.6));
    if (!this.state) this.renderer.renderPreview(this.cityId);
  };
}

function node<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function button(label: string, className: string, action: () => void): HTMLButtonElement {
  const element = node('button', className, label);
  element.type = 'button';
  element.addEventListener('click', action);
  return element;
}

function stat(value: string, label: string): HTMLElement {
  const item = node('div', 'blitz-stat');
  item.append(node('strong', '', value), node('span', '', label));
  return item;
}

function shortWallet(address: string): string {
  const compact = address.replace(/\s/g, '');
  return compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`;
}
