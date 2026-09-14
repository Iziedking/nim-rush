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
import { BLITZ_ONBOARDING_BEATS, blitzOnboardingSeen, markBlitzOnboardingSeen } from './blitz-onboarding';

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
      if (blitzOnboardingSeen(safeLocalStorage())) this.renderIntro();
      else this.renderOnboarding(0);
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

  /**
   * The opening: three beats, one sentence and one picture each.
   *
   * Shown once per device, skippable from every beat, and it never blocks
   * play - the last beat starts the ride rather than returning to a menu the
   * player has already decided to leave.
   */
  private renderOnboarding(index: number): void {
    const beat = BLITZ_ONBOARDING_BEATS[index];
    if (!beat) {
      this.finishOnboarding();
      return;
    }
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-onboarding');
    screen.setAttribute('data-blitz-screen', 'onboarding');
    screen.append(node('div', 'blitz-brand', 'NIM ATLAS / BEACON BLITZ'));

    const art = node('div', 'blitz-onboarding-art');
    // Authored SVG from blitz-onboarding.ts, not player input.
    art.innerHTML = beat.art;
    screen.append(art);

    const copy = node('section', 'blitz-onboarding-copy');
    copy.append(node('span', 'blitz-onboarding-kicker', beat.kicker));
    copy.append(node('h1', 'blitz-onboarding-title', beat.title));
    copy.append(node('p', 'blitz-onboarding-body', beat.body));
    screen.append(copy);

    const dots = node('div', 'blitz-onboarding-dots');
    dots.setAttribute('aria-hidden', 'true');
    for (const [position] of BLITZ_ONBOARDING_BEATS.entries()) {
      const dot = node('span', 'blitz-onboarding-dot');
      if (position === index) dot.classList.add('is-current');
      dots.append(dot);
    }
    screen.append(dots);

    const last = index === BLITZ_ONBOARDING_BEATS.length - 1;
    const next = button(last ? 'Ride Lagos' : 'Next', 'blitz-start', () => {
      this.audio.unlock();
      if (last) this.finishOnboarding(true);
      else this.renderOnboarding(index + 1);
    });
    screen.append(next);
    screen.append(button('Skip', 'blitz-onboarding-skip', () => this.finishOnboarding()));
    screen.setAttribute('aria-live', 'polite');
    this.ui.append(screen);
  }

  private finishOnboarding(ride = false): void {
    markBlitzOnboardingSeen(safeLocalStorage());
    if (ride) void this.startRun('lagos');
    else this.renderIntro();
  }

  private renderIntro(): void {
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-intro');
    screen.setAttribute('data-blitz-screen', 'intro');
    const brand = node('div', 'blitz-brand', 'NIM ATLAS');
    const edition = node('span', 'blitz-edition', 'BEACON BLITZ');
    const title = node('h1', 'blitz-title', 'LAGOS\nPULSE');
    const line = node('p', 'blitz-tagline', 'A payment is stuck. Ride it through Lagos. Bring it to finality.');
    /*
     * The three-verb brief that used to sit here is gone. It taught check,
     * approve and confirm on the screen a player is trying to leave, next to a
     * title, a tagline, a stat strip, a leaderboard and a note - and the
     * opening now teaches the same thing properly, one idea at a time. A
     * landing page's job is to be understood in a glance and then get out of
     * the way.
     */
    const stats = node('div', 'blitz-intro-stats');
    stats.append(stat('90 SEC', 'LIMIT'), stat('3', 'CHECKS'), stat('01 / 03', 'CITY'));
    const start = button('Ride Lagos', 'blitz-start', () => void this.startRun('lagos'));
    const ranked = node('details', 'blitz-ranked-launch');
    ranked.append(node('summary', 'blitz-ranked-label', 'WALLET VERIFIED / LEADERBOARD'));
    const username = node('input', 'blitz-username');
    username.type = 'text';
    username.inputMode = 'text';
    username.autocomplete = 'username';
    username.maxLength = 18;
    username.placeholder = 'Rider name';
    username.setAttribute('aria-label', 'Ranked rider name');
    try { username.value = localStorage.getItem('nim-atlas:blitz:username') ?? ''; } catch { /* Storage is optional. */ }
    const rankedStatus = node('p', 'blitz-rank-status', 'Connect once. Your wallet signs identity, not a payment.');
    const rankedButton = button('Connect wallet / rank Lagos', 'blitz-ranked-button', () => void this.prepareRankedStart('lagos', username, rankedButton, rankedStatus));
    ranked.append(username, rankedButton, rankedStatus);
    /*
     * Discovery first, stated plainly. A player should know before they tap
     * that nothing is being asked of them - the wallet belongs to the ranked
     * path and nowhere else.
     */
    const note = node('p', 'blitz-quiet', 'No wallet needed to play. Ranked runs are replay-verified.');
    screen.append(brand, edition, title, line, stats, start, note, ranked);
    this.ui.append(screen);
  }

  private async startRun(cityId: BlitzCityId, rankedTicket: BlitzTicket | null = null): Promise<void> {
    this.audio.unlock();
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
    this.audio.playBikeEngine(0);
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
      const wasBoostActive = next.boostActive;
      next = stepBlitzRun(next, input);
      if (!wasBoostActive && next.boostActive) this.audio.playWorldCue('bike-boost');
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
    this.audio.setBikeSpeed(state.speedMps);
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
    if (this.paused) this.audio.stopBikeEngine();
    else this.audio.playBikeEngine(this.state?.speedMps ?? 0);
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
    this.audio.stopBikeEngine();
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
    /*
     * The day's pool, on the screen where a player has just earned a place in
     * it. Appended empty and filled when the standing arrives, because the
     * result screen must never wait on the network to paint.
     */
    const pool = node('section', 'blitz-pool');
    pool.hidden = true;
    screen.append(pool);
    void this.presentDayPool(pool);
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

  private async prepareRankedStart(cityId: BlitzCityId, usernameInput: HTMLInputElement, buttonNode: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const username = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) {
      status.textContent = 'USE 3–18 LETTERS, NUMBERS, OR UNDERSCORES.';
      return;
    }
    buttonNode.disabled = true;
    status.textContent = 'OPENING NIMIQ WALLET / IDENTITY ONLY.';
    try {
      const ticket = await this.issueRankedTicket(cityId, username);
      try { localStorage.setItem('nim-atlas:blitz:username', username); } catch { /* Storage is optional. */ }
      status.textContent = 'IDENTITY VERIFIED. LOADING THE RANKED SEED...';
      await this.startRun(cityId, ticket.value);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RANKED MODE IS UNAVAILABLE.';
      buttonNode.disabled = false;
    }
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
      const ticket = await this.issueRankedTicket(cityId, username);
      try { localStorage.setItem('nim-atlas:blitz:username', username); } catch { /* Storage is optional. */ }
      status.textContent = 'IDENTITY VERIFIED. LOADING THE RANKED SEED...';
      await this.startRun(cityId, ticket.value);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RANKED MODE IS UNAVAILABLE.';
      buttonNode.disabled = false;
    }
  }

  private async issueRankedTicket(cityId: BlitzCityId, username: string): Promise<{ value: BlitzTicket }> {
    const initialized = await this.wallet.initialize();
    if (!initialized.ok) throw new Error(initialized.reason === 'timeout' ? 'Nimiq Wallet took too long. Try again.' : 'Nimiq Wallet is unavailable in this browser.');
    const credential = await getOrCreateCredential();
    const binding = await this.walletBinding.bind({ actorId: credential.playerId, seasonId: BLITZ_SEASON, network: 'testalbatross' });
    if (!binding.ok) throw new Error(binding.error);
    const ticket = await this.api.issueBlitzTicket({ actorId: credential.playerId, walletAddress: binding.value.address, username, cityId, seasonId: BLITZ_SEASON });
    if (!ticket.ok) throw new Error(ticket.error);
    return ticket;
  }

  /**
   * What a verified run is worth today, in real NIM.
   *
   * Silent on failure: a pool that cannot be read is not worth a broken result
   * screen, and the score and the board are true regardless of it.
   */
  private async presentDayPool(host: HTMLElement): Promise<void> {
    try {
      const standing = await this.api.getDailyStanding();
      if (!standing.rewardsEnabled || standing.poolLuna === null) return;
      host.replaceChildren();
      host.append(node('span', 'blitz-pool-label', "TODAY'S POOL / NIMIQ MAINNET"));
      host.append(node('strong', 'blitz-pool-value', formatNim(standing.poolLuna)));
      host.append(node('p', 'blitz-pool-note', standing.eligibleCount === 0
        ? 'No rider has qualified yet today. Post a verified run and the pool is yours to share.'
        : standing.shareLuna === null
          ? `${standing.eligibleCount} riders qualified today.`
          : `Split between ${standing.eligibleCount} qualified ${standing.eligibleCount === 1 ? 'rider' : 'riders'} — ${formatNim(standing.shareLuna)} each at the close of the day.`));
      host.append(node('p', 'blitz-pool-note blitz-quiet', 'A share is paid to a wallet, so a ranked run is the only run that can earn one.'));
      host.hidden = false;
    } catch {
      // Leave it hidden. The run still counted.
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
      this.audio.stopBikeEngine();
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

/**
 * localStorage, or null where it is unavailable.
 *
 * A private window or blocked site data makes the accessor itself throw, so
 * even reaching for it has to be guarded. The game is fully playable without
 * it; only the "seen the opening" flag is lost.
 */
function safeLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

/**
 * Luna is an integer unit; 1 NIM is 100,000 Luna.
 *
 * Both are shown because the pool is small in NIM terms and a bare Luna figure
 * reads as larger than it is, while a bare NIM figure rounds the real amount
 * away. Neither alone is honest.
 */
function formatNim(luna: number): string {
  return `${luna.toLocaleString('en-US')} Luna (${(luna / 100_000).toLocaleString('en-US', { maximumFractionDigits: 5 })} NIM)`;
}

function shortWallet(address: string): string {
  const compact = address.replace(/\s/g, '');
  return compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`;
}
