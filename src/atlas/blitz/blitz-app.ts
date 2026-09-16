import { BLITZ_LIMIT_SECONDS, BLITZ_TICK_RATE, createBlitzRun, stepBlitzRun } from '../../../shared/atlas/blitz/core';
import { BLITZ_CITIES, blitzCity, nextBlitzCity } from '../../../shared/atlas/blitz/cities';
import { blitzLoadoutFor, blitzNextRiderLevel, blitzRiderLevel } from '../../../shared/atlas/blitz/rider';
import { blitzRules } from '../../../shared/atlas/blitz/rules';
import type { BlitzCityId, BlitzDifficulty, BlitzRunState, BlitzTraceFrame } from '../../../shared/atlas/blitz/types';
import type { BlitzTicket } from '../../../shared/atlas/blitz/competition';
import { BLITZ_SEASON_ID, getBlitzDailyChallenge } from '../../../shared/atlas/blitz/daily';
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
import { createBlitzPendingRunStore, type BlitzPendingRunStore, type BlitzPendingSubmission } from './pending-run';

const STEP_MS = 1_000 / BLITZ_TICK_RATE;
/* Shared with the server's maintenance worker; see shared/atlas/blitz/daily.ts. */
const BLITZ_SEASON = BLITZ_SEASON_ID;

export class BlitzApp {
  private readonly renderer: BlitzRenderer;
  private readonly input = new BlitzInputController();
  private readonly api = createAtlasApiClient({ baseUrl: import.meta.env.VITE_API_BASE ?? '' });
  private readonly wallet = createAtlasWalletAdapter();
  private readonly walletBinding = createAtlasWalletBindingFlow({ api: this.api, wallet: this.wallet });
  private readonly reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private readonly audio = createAtlasAudio();
  private audioScene: 'menu' | 'riding' | 'paused' = 'menu';
  private audioMuted = false;
  private readonly frameGovernor = new BlitzFrameGovernor(60);
  private readonly pendingRunStore: BlitzPendingRunStore;
  private state: BlitzRunState | null = null;
  private previousRenderState: BlitzRunState | null = null;
  private frames: BlitzTraceFrame[] = [];
  private cityId: BlitzCityId = 'lagos';
  private difficulty: BlitzDifficulty = 'rookie';
  private frameHandle: number | null = null;
  private previousTimestamp: number | null = null;
  private accumulator = 0;
  private lastPhysicsAudioTick = -1;
  private scoreNode: HTMLElement | null = null;
  private timerNode: HTMLElement | null = null;
  private speedNode: HTMLElement | null = null;
  private progressNode: HTMLElement | null = null;
  private boostNode: HTMLElement | null = null;
  private gearHost: HTMLElement | null = null;
  private driftWindowNode: HTMLElement | null = null;
  private missionHost: HTMLElement | null = null;
  private countdownNode: HTMLElement | null = null;
  private feedbackNode: HTMLElement | null = null;
  private pauseOverlay: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private paused = false;
  private rankedTicket: BlitzTicket | null = null;
  private rankedInterrupted = false;

  constructor(private readonly ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new BlitzRenderer(canvas);
    this.pendingRunStore = createBlitzPendingRunStore(safeLocalStorage());
    try { this.audioMuted = safeLocalStorage()?.getItem('nim-rush:muted') === 'true'; } catch { /* Sound remains optional. */ }
  }

  async boot(): Promise<void> {
    try {
      this.ui.className = 'blitz-ui';
      await this.renderer.initialize(this.reducedMotion);
      await this.renderer.loadCity('lagos');
      this.resize();
      this.renderer.renderPreview('lagos');
      this.renderIntro();
      // Launch can play on hosts that permit it. Suspended contexts retry on
      // gestures, but the current scene alone decides which loops may play.
      this.audioGesture();
      window.addEventListener('pointerdown', this.audioGesture);
      window.addEventListener('keydown', this.audioGesture);
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
        lateralVelocityMps: this.state.lateralVelocityMps,
        heightMeters: this.state.heightMeters,
        airborne: this.state.airborne,
        collisions: this.state.collisions,
        surface: this.state.surface,
        lastEvent: this.state.lastEvent?.type ?? null,
        speedMps: this.state.speedMps,
        boostEnergy: this.state.boostEnergy,
        boostActive: this.state.boostActive,
        driftActive: this.state.driftActive,
        difficulty: this.state.difficulty,
        activeMission: this.state.activeMission?.missionIndex ?? null,
        missionStatuses: this.state.missions.map((mission) => mission.status),
      } : null,
      renderer: this.renderer.debugSnapshot(),
      audio: this.audio.debugSnapshot(),
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
    this.setAudioScene('menu');
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-intro');
    screen.setAttribute('data-blitz-screen', 'intro');
    const brand = node('div', 'blitz-brand', 'NIM RUSH');
    const edition = node('span', 'blitz-edition', 'DAILY DESCENT');
    const title = node('h1', 'blitz-title', 'RIDGE\nRUN');
    const line = node('p', 'blitz-tagline', 'Find your line. Ride the ridge. Prove your run.');
    const daily = getBlitzDailyChallenge({ now: Date.now(), cityId: 'lagos', seasonId: BLITZ_SEASON });
    const dailyMeta = node('p', 'blitz-daily-meta', `TODAY'S VERIFIED RUN / ${daily.date} / RESET ${formatUtcTime(daily.expiresAt)}`);
    /*
     * The three-verb brief that used to sit here is gone. It taught check,
     * approve and confirm on the screen a player is trying to leave, next to a
     * title, a tagline, a stat strip, a leaderboard and a note - and the
     * opening now teaches the same thing properly, one idea at a time. A
     * landing page's job is to be understood in a glance and then get out of
     * the way.
     */
    const stats = node('div', 'blitz-intro-stats');
    stats.append(stat('1.9 KM', 'TRAIL'), stat('90 SEC', 'LIMIT'), stat('110 M', 'DESCENT'));
    const difficultyChooser = node('fieldset', 'blitz-difficulty');
    difficultyChooser.append(node('legend', '', 'RIDE RULES'));
    const rookie = button('Rookie / learn the line', `blitz-difficulty-option${this.difficulty === 'rookie' ? ' is-selected' : ''}`, () => { this.difficulty = 'rookie'; this.renderIntro(); });
    const pro = button('Pro / tighter gates', `blitz-difficulty-option${this.difficulty === 'pro' ? ' is-selected' : ''}`, () => { this.difficulty = 'pro'; this.renderIntro(); });
    rookie.setAttribute('aria-pressed', String(this.difficulty === 'rookie'));
    pro.setAttribute('aria-pressed', String(this.difficulty === 'pro'));
    difficultyChooser.append(rookie, pro);
    const start = button('Ride now', 'blitz-start', () => void this.startRun('lagos'));
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
    const rankedButton = button('Verify identity / ride ranked', 'blitz-ranked-button', () => void this.prepareRankedStart('lagos', username, rankedButton, rankedStatus));
    ranked.append(username, rankedButton, rankedStatus);
    /*
     * Discovery first, stated plainly. A player should know before they tap
     * that nothing is being asked of them - the wallet belongs to the ranked
     * path and nowhere else.
     */
    const note = node('p', 'blitz-quiet', 'No wallet needed to play. Ranked runs are replay-verified.');
    screen.append(brand, edition, title, line, dailyMeta, stats, difficultyChooser, start, note, ranked);
    screen.append(button('How to ride', 'blitz-help', () => this.renderOnboarding(blitzOnboardingSeen(safeLocalStorage()) ? 1 : 0)));
    screen.append(this.soundControl());
    const pending = this.pendingRunStore.read();
    if (pending) {
      const recovery = node('section', 'blitz-pending-run');
      const recoveryStatus = node('p', 'blitz-rank-status', 'A ranked run is saved locally and still needs verification.');
      recovery.append(node('strong', '', 'SAVED RANKED RUN'), recoveryStatus);
      recovery.append(button('Verify saved run', 'blitz-verify', () => void this.submitPendingRun(pending, recoveryStatus, recovery)));
      recovery.append(button('Discard saved run', 'blitz-quiet blitz-discard-run', () => { this.pendingRunStore.clear(); recovery.remove(); }));
      screen.append(recovery);
    }
    this.ui.append(screen);
  }

  private async startRun(cityId: BlitzCityId, rankedTicket: BlitzTicket | null = null): Promise<void> {
    this.setAudioScene('paused');
    this.audio.unlock();
    this.cityId = cityId;
    this.rankedTicket = rankedTicket;
    this.rankedInterrupted = false;
    const seed = rankedTicket?.seed ?? `${cityId}-${new Date().toISOString().slice(0, 10)}-${Math.floor(Date.now() / 60_000)}`;
    // Ranked keeps one visible, equal loadout and the shared Rookie ruleset
    // until the server ticket contract carries Pro as an explicit version.
    /*
     * A ranked run takes the base loadout, whatever this rider has earned.
     * The board compares riding, not hours played. This is not the only thing
     * holding that line - the server rebuilds every ranked run from the city
     * and seed alone, so a client that handed itself a bigger tank would fail
     * verification - but the client should not be the thing that tries.
     */
    const loadout = blitzLoadoutFor({ careerScore: this.careerScore(), ranked: Boolean(rankedTicket) });
    this.state = createBlitzRun({ cityId, seed, difficulty: rankedTicket ? 'rookie' : this.difficulty, loadout });
    this.previousRenderState = null;
    this.frames = [];
    this.lastPhysicsAudioTick = -1;
    this.paused = false;
    this.input.reset();
    // The scene has to be built for the ruleset this run is judged under, or
    // a rider swerves around obstacles that are not there and rides through
    // ones that are.
    await this.renderer.loadCity(cityId, this.state.difficulty);
    this.setAudioScene(this.paused ? 'paused' : 'riding');
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
    const cityName = node('div', 'blitz-city-name', `${city.circuit} / ${this.difficulty.toUpperCase()}`);
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
    /*
     * The supply rack.
     *
     * Both supplies are finite now, so both have to be readable without
     * looking away from the road: a bar that empties, and pips that go out.
     * The pips carry a count as text too, because a pip that is nearly the
     * same colour as its empty state is no information at all.
     */
    const boost = node('div', 'blitz-boost-wrap');
    boost.append(node('span', '', 'NITRO'));
    const boostTrack = node('div', 'blitz-boost-meter');
    this.boostNode = node('i', 'blitz-boost-fill');
    boostTrack.append(this.boostNode);
    boost.append(boostTrack);
    const gearWrap = node('div', 'blitz-gear-wrap');
    gearWrap.append(node('span', '', 'GEARBOX'));
    this.gearHost = node('div', 'blitz-gear-pips');
    this.gearHost.setAttribute('aria-label', 'Gearboxes left for drifting');
    gearWrap.append(this.gearHost);
    // How much of the current slide is left. Hidden until a slide is running.
    const driftTrack = node('div', 'blitz-drift-window');
    this.driftWindowNode = node('i', 'blitz-drift-window-fill');
    driftTrack.append(this.driftWindowNode);
    driftTrack.hidden = true;
    gearWrap.append(driftTrack);
    boost.append(gearWrap);

    this.missionHost = node('section', 'blitz-mission-hud');
    this.missionHost.setAttribute('aria-label', 'Physical mission contracts');
    this.renderMissionHud(this.state!);
    this.feedbackNode = node('div', 'blitz-feedback');
    this.feedbackNode.setAttribute('aria-live', 'polite');
    this.countdownNode = node('div', 'blitz-countdown', '3');

    this.pauseOverlay = node('section', 'blitz-pause-overlay');
    this.pauseOverlay.hidden = true;
    this.pauseOverlay.append(
      node('strong', 'blitz-pause-title', 'RUN PAUSED'),
      node('p', 'blitz-pause-copy', 'Your course position is safe. Resume when the trail is clear.'),
      button('Resume', 'blitz-start blitz-resume', this.togglePause),
      button('Restart run', 'blitz-again blitz-restart', () => void this.startRun(this.cityId)),
    );

    const controls = node('section', 'blitz-controls');
    const steerZone = node('div', 'blitz-control blitz-steer-zone');
    steerZone.setAttribute('aria-label', 'Drag left or right to steer');
    const steerRail = node('div', 'blitz-steer-rail');
    const thumb = node('i', 'blitz-steer-thumb');
    steerRail.append(thumb);
    steerZone.append(node('span', '', 'STEER'), steerRail);
    const actions = node('div', 'blitz-actions');
    const drift = button('DRIFT', 'blitz-control blitz-drift', () => undefined);
    const brake = button('BRAKE', 'blitz-control blitz-brake', () => undefined);
    const boostButton = button('BOOST', 'blitz-control blitz-boost', () => undefined);
    actions.append(drift, brake, boostButton);
    controls.append(steerZone, actions);
    this.input.bindSteering(steerZone, thumb);
    this.input.bindHold(drift, 'drift');
    this.input.bindHold(brake, 'brake');
    this.input.bindHold(boostButton, 'boost');

    screen.append(top, speedBox, progress, boost, this.missionHost, this.feedbackNode, this.countdownNode, this.pauseOverlay, controls);
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
      const frame: BlitzTraceFrame = { tick: this.frames.length, input: sampled };
      this.frames.push(frame);
      const wasBoostActive = next.boostActive;
      this.previousRenderState = next;
      next = stepBlitzRun(next, sampled);
      if (!wasBoostActive && next.boostActive) this.audio.playWorldCue('bike-boost');
      if (next.lastEvent && next.lastEvent.tick !== this.lastPhysicsAudioTick && next.lastEvent.type !== 'boost-start' && next.lastEvent.type !== 'boost-end') {
        this.audio.playPhysicsCue(next.lastEvent);
        this.lastPhysicsAudioTick = next.lastEvent.tick;
      }
      this.accumulator -= STEP_MS;
      steps += 1;
    }
    this.state = next;
    this.audio.setBikeContact(next.surface, next.airborne || this.paused, next.lateralVelocityMps);
    if (this.frameGovernor.shouldRender(timestamp)) {
      this.renderer.render(next, this.input.sample().steer, this.previousRenderState, this.accumulator / STEP_MS);
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
    /*
     * A fraction of the tank this rider actually carries. Reading the raw
     * energy as a percentage was only ever right for a 60-unit tank, and a
     * levelled rider carries 84.
     */
    if (this.boostNode) this.boostNode.style.width = `${Math.min(100, state.boostEnergy / state.boostCapacity * 100)}%`;
    this.updateSupplyHud(state);
    this.audio.setBikeSpeed(state.speedMps);
    if (this.countdownNode) {
      this.countdownNode.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdownTicks / BLITZ_TICK_RATE))) : 'GO';
      this.countdownNode.classList.toggle('is-live', state.phase === 'running');
    }
    this.updateMissionHud(state);
  }

  private renderMissionHud(state: BlitzRunState): void {
    if (!this.missionHost) return;
    this.missionHost.replaceChildren();
    const heading = node('div', 'blitz-mission-heading', 'TODAY / THREE CONTRACTS');
    this.missionHost.append(heading);
    for (const mission of state.missions) {
      const card = node('article', 'blitz-mission-card');
      card.dataset.missionId = mission.id;
      const top = node('div', 'blitz-mission-top');
      top.append(node('strong', 'blitz-mission-label', mission.label), node('span', 'blitz-mission-status', 'READY'));
      const progress = node('span', 'blitz-mission-progress', `0/${mission.target}`);
      progress.dataset.missionProgress = mission.id;
      const meter = node('i', 'blitz-mission-meter-fill');
      meter.dataset.missionMeter = mission.id;
      const meterTrack = node('span', 'blitz-mission-meter');
      meterTrack.append(meter);
      card.append(top, node('p', 'blitz-mission-verb', mission.verb), progress, meterTrack);
      this.missionHost.append(card);
    }
  }

  private updateMissionHud(state: BlitzRunState): void {
    if (!this.missionHost) return;
    for (const mission of state.missions) {
      const card = this.missionHost.querySelector(`[data-mission-id="${mission.id}"]`);
      if (!(card instanceof HTMLElement)) continue;
      const status = card.querySelector('.blitz-mission-status');
      if (status) status.textContent = mission.status === 'complete' ? 'DONE' : mission.status === 'failed' ? 'MISSED' : mission.status === 'active' ? 'LIVE' : 'READY';
      const progress = card.querySelector(`[data-mission-progress="${mission.id}"]`);
      if (progress) progress.textContent = `${Math.min(mission.progress, mission.target)}/${mission.target}`;
      const meter = card.querySelector(`[data-mission-meter="${mission.id}"]`);
      if (meter instanceof HTMLElement) meter.style.width = `${Math.min(100, mission.progress / mission.target * 100)}%`;
      card.classList.toggle('is-active', mission.status === 'active');
      card.classList.toggle('is-complete', mission.status === 'complete');
      card.classList.toggle('is-failed', mission.status === 'failed');
    }
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
    this.setAudioScene(this.paused ? 'paused' : 'riding');
    if (this.pauseOverlay) this.pauseOverlay.hidden = !this.paused;
    if (this.pauseButton) {
      this.pauseButton.textContent = this.paused ? '▶' : 'II';
      this.pauseButton.setAttribute('aria-label', this.paused ? 'Resume Beacon Blitz' : 'Pause Beacon Blitz');
    }
    if (this.feedbackNode) {
      this.feedbackNode.textContent = this.paused ? 'RUN SAFE / RESUME WHEN READY' : '';
      this.feedbackNode.className = this.paused ? 'blitz-feedback is-paused' : 'blitz-feedback';
    }
  };

  private renderResult(state: BlitzRunState): void {
    if (this.frameHandle !== null) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = null;
    this.input.reset();
    this.input.clearBindings();
    this.setAudioScene('menu');
    if (state.phase === 'finished') this.audio.playWorldCue('route-complete');
    const city = blitzCity(state.cityId);
    const nextCityId = nextBlitzCity(state.cityId);
    const next = blitzCity(nextCityId);
    const best = this.saveBest(state);
    this.recordSkillUnlock(state);
    const nextUnlocked = this.isCityUnlocked(nextCityId);
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-result');
    screen.setAttribute('data-blitz-screen', 'result');
    screen.append(node('div', 'blitz-brand', 'NIM RUSH / DAILY DESCENT'));
    screen.append(node('p', 'blitz-result-kicker', state.phase === 'finished' ? `${city.circuit.toUpperCase()} CLEARED` : 'RUN ENDED'));
    screen.append(node('h1', 'blitz-result-score', state.score.toLocaleString()));
    screen.append(node('p', 'blitz-result-time', `${(state.elapsedMs / 1_000).toFixed(1)} SEC / ${state.collisions} CONTACTS / ${state.missions.filter((mission) => mission.status === 'complete').length}/3 CONTRACTS`));
    screen.append(node('p', 'blitz-result-best', best === state.score ? 'NEW PERSONAL BEST' : `PERSONAL BEST ${best.toLocaleString()}`));
    const breakdown = node('div', 'blitz-breakdown');
    const score = state.scoreBreakdown;
    breakdown.append(
      stat(`+${score.finishTime.toLocaleString()}`, 'FINISH TIME'),
      stat(`+${score.racingLine.toLocaleString()}`, 'RACING LINE'),
      stat(`+${score.control.toLocaleString()}`, 'BRAKING / CONTROL'),
      stat(`+${score.airtime.toLocaleString()}`, 'AIRTIME / LANDING'),
      stat(`+${score.missions.toLocaleString()}`, 'MISSION COMPLETION'),
      stat(`+${score.drift.toLocaleString()}`, 'DRIFT / CONTROL'),
      stat(`-${score.collisionPenalties.toLocaleString()}`, 'COLLISION PENALTIES'),
      stat(`-${score.missedGatePenalties.toLocaleString()}`, 'MISSED-GATE PENALTIES'),
    );
    screen.append(breakdown);
    /*
     * Supplies, then the ladder. A rider has just spent a run's worth of both,
     * so this is the moment the two systems are worth explaining - and the
     * only honest place to say that ranked ignores the ladder.
     */
    const total = (kind: 'nitro' | 'gearbox') => city.pickups.filter((pickup) => pickup.kind === kind).length;
    const supplies = node('section', 'blitz-supplies');
    supplies.append(node('span', 'blitz-supplies-label', 'SUPPLIES TAKEN'));
    const supplyRow = node('div', 'blitz-supply-row');
    supplyRow.append(
      supplyStat('nitro', `${state.nitroTaken}/${total('nitro')}`, 'NITRO'),
      supplyStat('gearbox', `${state.gearboxTaken}/${total('gearbox')}`, 'GEARBOX'),
    );
    supplies.append(supplyRow);
    supplies.append(node('p', 'blitz-pool-note blitz-quiet', 'Boost and drift only come off the road. The line you take is the fuel you finish with.'));
    screen.append(supplies);
    screen.append(this.riderLadder());
    screen.append(button('Ride again', 'blitz-start blitz-rematch', () => void this.startRun(state.cityId)));
    screen.append(this.soundControl());
    /*
     * The day's pool, on the screen where a player has just earned a place in
     * it. Appended empty and filled when the standing arrives, because the
     * result screen must never wait on the network to paint.
     */
    const pool = node('section', 'blitz-pool');
    pool.hidden = true;
    screen.append(pool);
    void this.presentDayPool(pool);
    /*
     * What this rider is already owed. Separate from the pool panel: the pool
     * is about today and could still change, a receipt is about a day that has
     * closed and cannot.
     */
    const rewards = node('section', 'blitz-rewards');
    rewards.hidden = true;
    screen.append(rewards);
    void this.presentRewards(rewards);
    const reveal = node('section', 'blitz-next-city');
    reveal.append(node('span', '', nextUnlocked ? 'NEXT CIRCUIT' : 'SKILL UNLOCK'), node('h2', '', next.circuit), node('p', '', nextUnlocked ? next.callout : `Finish this run with two missions and no more than two contacts to unlock ${next.name}.`));
    const nextButton = button(nextUnlocked ? `Ride ${next.name}` : `Unlock ${next.name}`, 'blitz-again blitz-next', () => void this.startRun(nextCityId));
    nextButton.disabled = !nextUnlocked;
    reveal.append(nextButton);
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
    const otherCourses = node('details', 'blitz-competition');
    otherCourses.append(node('summary', 'blitz-competition-summary', 'OTHER CIRCUITS'), reveal);
    screen.append(otherCourses);
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
    /*
     * Remembered so a rider who comes back tomorrow sees what yesterday owes
     * them without signing again. It is a public address that already appears
     * beside their rank on the board, not a secret, and losing it costs
     * nothing: the obligation lives in the ledger either way.
     */
    try { localStorage.setItem('nim-atlas:blitz:wallet', binding.value.address); } catch { /* Storage is optional. */ }
    return ticket;
  }

  /**
   * What today's board would owe if it closed now.
   *
   * This used to read the daily standing and say "split between N qualified
   * riders, X each", which described an equal split. The day pays its top
   * three, so that sentence became a false statement to a rider the moment
   * the allocator landed.
   *
   * Three states, kept apart on purpose. `unavailable` is not `unfunded`: a
   * pool the server could not read is an unknown, and showing an unknown as
   * "no pool today" is a claim about the treasury that nothing supports. The
   * panel stays hidden for an unknown rather than inventing either answer.
   */
  private async presentDayPool(host: HTMLElement): Promise<void> {
    try {
      const table = await this.api.getBlitzPrizes(BLITZ_SEASON, this.cityId);
      if (table.state === 'unavailable') return;

      host.replaceChildren();
      host.append(node('span', 'blitz-pool-label', "TODAY'S POOL / NIMIQ MAINNET"));

      if (table.state === 'unfunded' || table.poolLuna === null || table.poolLuna === 0) {
        host.append(node('strong', 'blitz-pool-value', 'No sponsored pool today'));
        host.append(node('p', 'blitz-pool-note', 'The board still counts. A verified run sets your rank whether or not a pool is funded.'));
        host.hidden = false;
        return;
      }

      host.append(node('strong', 'blitz-pool-value', formatNim(table.poolLuna)));
      host.append(node('p', 'blitz-pool-note', `Paid to the top three at the close of the day: ${table.splitBps.map(bpsLabel).join(' / ')}.`));

      if (table.allocations.length === 0) {
        host.append(node('p', 'blitz-pool-note', 'No rider has posted a verified run yet today. First place is open.'));
      } else {
        const standings = node('ol', 'blitz-pool-standings');
        for (const entry of table.allocations) {
          const row = node('li', 'blitz-pool-place');
          row.append(node('b', '', `#${entry.rank}`), node('span', '', shortWallet(entry.walletAddress)), node('strong', '', formatNim(entry.luna)));
          standings.append(row);
        }
        host.append(standings);
        if (table.allocations.length < table.splitBps.length) {
          host.append(node('p', 'blitz-pool-note blitz-quiet', `${table.splitBps.length - table.allocations.length} of the three places are still open.`));
        }
      }

      host.append(node('p', 'blitz-pool-note blitz-quiet', 'Nothing is paid until the day closes and the transfer is reconciled on chain.'));
      host.hidden = false;
    } catch {
      // Leave it hidden. The run still counted, and the board is still true.
    }
  }

  /**
   * What this rider has been awarded, and where each award actually is.
   *
   * A pool nobody can see the end of is indistinguishable from a pool that was
   * never paid. This closes that loop: once a day is closed, the rider sees the
   * obligation the moment it exists, then sees it move, then sees the chain
   * confirm it.
   *
   * It never says "paid" on anything short of chain evidence, and never hides a
   * problem as "owed" - a stuck transfer says so and keeps its reason.
   */
  private async presentRewards(host: HTMLElement): Promise<void> {
    const walletAddress = this.rememberedWallet();
    // Nothing to ask about. A rider who has never ranked has no receipts, and
    // an empty panel would only be noise on the screen where they just rode.
    if (!walletAddress) return;
    try {
      const receipts = await this.api.getBlitzRewards(walletAddress);
      if (receipts.length === 0) return;

      host.replaceChildren();
      host.append(node('span', 'blitz-rewards-label', `YOUR REWARDS / ${shortWallet(walletAddress)}`));
      const list = node('ol', 'blitz-rewards-list');
      for (const receipt of receipts.slice(0, REWARD_ROWS)) {
        const row = node('li', `blitz-reward blitz-reward-${receipt.state}`);
        row.append(node('span', 'blitz-reward-day', rewardDayLabel(receipt.period)));
        row.append(node('strong', 'blitz-reward-amount', formatNim(receipt.amountLuna)));
        row.append(node('span', 'blitz-reward-state', REWARD_STATE_LABEL[receipt.state]));
        if (receipt.state === 'attention' && receipt.attentionReason) {
          // Shown, not swallowed. Somebody waiting for money is owed the reason.
          row.append(node('small', 'blitz-reward-note', receipt.attentionReason));
        }
        if (receipt.transactionHash) {
          const hash = node('small', 'blitz-reward-hash', `${receipt.transactionHash.slice(0, 10)}…`);
          hash.title = receipt.transactionHash;
          row.append(hash);
        }
        list.append(row);
      }
      host.append(list);
      host.append(node('p', 'blitz-pool-note blitz-quiet', 'A reward is only called paid once the transfer is seen on chain from the treasury to your wallet.'));
      host.hidden = false;
    } catch {
      // Leave it hidden. A ledger we cannot reach right now is not a claim
      // that a rider is owed nothing.
    }
  }

  /** The address this rider last ranked with, if any. Public, never a key. */
  private rememberedWallet(): string | null {
    try { return localStorage.getItem('nim-atlas:blitz:wallet'); } catch { return null; }
  }

  private async submitRankedRun(state: BlitzRunState, status: HTMLElement, host: HTMLElement): Promise<void> {
    const ticket = this.rankedTicket;
    if (!ticket) return;
    try {
      const traceHash = await hashBlitzTrace(this.frames);
      const pending: BlitzPendingSubmission = {
        runId: crypto.randomUUID(), ticket, frames: structuredClone(this.frames), traceHash,
        claimedScore: state.score, savedAt: Date.now(),
      };
      this.pendingRunStore.save(pending);
      await this.submitPendingRun(pending, status, host);
    } catch (error) {
      status.textContent = error instanceof Error ? `NOT VERIFIED / ${error.message.toUpperCase()}` : 'THIS RUN COULD NOT BE VERIFIED.';
    }
  }

  private async submitPendingRun(pending: BlitzPendingSubmission, status: HTMLElement, host: HTMLElement): Promise<void> {
    status.textContent = 'VERIFYING REPLAY / KEEP THIS SCREEN OPEN...';
    try {
      const ticket = pending.ticket;
      const result = await this.api.submitBlitzRun({
        runId: pending.runId, ticketId: ticket.id, actorId: ticket.actorId, walletAddress: ticket.walletAddress,
        username: ticket.username, cityId: ticket.cityId, seasonId: ticket.seasonId,
        challengeId: ticket.challengeId, challengeDate: ticket.challengeDate, rulesetVersion: ticket.rulesetVersion,
        seed: ticket.seed, frames: pending.frames, traceHash: pending.traceHash, claimedScore: pending.claimedScore,
      });
      if (!result.ok) throw new Error(result.error);
      this.pendingRunStore.clear();
      host.querySelector('.blitz-retry-submit')?.remove();
      status.textContent = `VERIFIED #${result.value.row.rank} / ${ticket.username} / ${shortWallet(ticket.walletAddress)}`;
    } catch (error) {
      status.textContent = error instanceof Error ? `NOT VERIFIED / ${error.message.toUpperCase()}` : 'THIS RUN COULD NOT BE VERIFIED.';
      host.querySelector('.blitz-retry-submit')?.remove();
      host.append(button('Retry verification', 'blitz-retry-submit', () => {
        const retry = host.querySelector('.blitz-retry-submit');
        if (retry instanceof HTMLButtonElement) retry.disabled = true;
        void this.submitPendingRun(pending, status, host);
      }));
    }
    await this.loadLeaderboard(pending.ticket.cityId, host, pending.ticket.challengeId);
  }

  private async loadLeaderboard(cityId: BlitzCityId, host: HTMLElement, challengeId = getBlitzDailyChallenge({ now: Date.now(), cityId, seasonId: BLITZ_SEASON }).challengeId): Promise<void> {
    const existing = host.querySelector('.blitz-leaderboard');
    existing?.remove();
    const board = node('div', 'blitz-leaderboard');
    try {
      const rows = await this.api.getBlitzLeaderboard(BLITZ_SEASON, cityId, challengeId);
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

  /*
   * Gearboxes and the slide they are paying for.
   *
   * Pips are rebuilt only when the count or the capacity changes: this runs
   * every frame, and replacing five nodes thirty times a second to show the
   * same five nodes is how a HUD ends up costing more than the city does.
   */
  private updateSupplyHud(state: BlitzRunState): void {
    if (this.gearHost && this.gearHost.childElementCount !== state.driftCapacity) {
      this.gearHost.replaceChildren();
      for (let index = 0; index < state.driftCapacity; index += 1) this.gearHost.append(node('i', 'blitz-gear-pip'));
    }
    if (this.gearHost) {
      this.gearHost.setAttribute('data-gearboxes', String(state.driftCharges));
      [...this.gearHost.children].forEach((pip, index) => {
        pip.classList.toggle('is-spent', index >= state.driftCharges);
      });
    }
    const window = this.driftWindowNode?.parentElement;
    if (window) {
      const sliding = state.driftTicksLeft > 0;
      window.hidden = !sliding;
      if (sliding && this.driftWindowNode) {
        this.driftWindowNode.style.width = `${Math.min(100, state.driftTicksLeft / Math.max(1, state.driftWindowTicks) * 100)}%`;
      }
    }
  }

  /**
   * The rider's rung, and the next one.
   *
   * Career score is the sum of their best run in each city, so the ladder is
   * climbed by riding better rather than by riding more - a rider cannot grind
   * a bad line a hundred times into a level.
   */
  private riderLadder(): HTMLElement {
    const career = this.careerScore();
    const level = blitzRiderLevel(career);
    const next = blitzNextRiderLevel(career);
    const host = node('section', 'blitz-ladder');
    host.append(node('span', 'blitz-ladder-label', `RIDER LEVEL ${level.level} / ${level.title.toUpperCase()}`));
    if (level.unlock) host.append(node('p', 'blitz-ladder-unlock', level.unlock));
    if (next) {
      const track = node('div', 'blitz-ladder-meter');
      const span = Math.max(1, next.level.requiredScore - level.requiredScore);
      const fill = node('i', 'blitz-ladder-fill');
      fill.style.width = `${Math.max(0, Math.min(100, (career - level.requiredScore) / span * 100))}%`;
      track.append(fill);
      host.append(track);
      host.append(node('p', 'blitz-ladder-next', `${next.remaining.toLocaleString()} more career points for ${next.level.title}: ${next.level.unlock}`));
    } else {
      host.append(node('p', 'blitz-ladder-next', 'Every rider quality is unlocked. The board is the only thing left to climb.'));
    }
    // Said plainly, because a rider who thinks their level is worth places on
    // the board would be right to feel cheated when it is not.
    host.append(node('p', 'blitz-pool-note blitz-quiet', 'Levels change free rides only. Every ranked run is ridden on the same equipment.'));
    return host;
  }

  private saveBest(state: BlitzRunState): number {
    const key = `nim-atlas:blitz:best:${state.rulesetVersion}:${state.cityId}`;
    let previous = 0;
    try { previous = Number(localStorage.getItem(key) ?? 0); } catch { /* Private storage can be unavailable. */ }
    const best = Math.max(Number.isFinite(previous) && previous >= 0 ? previous : 0, state.score);
    try { localStorage.setItem(key, String(best)); } catch { /* The run remains playable without storage. */ }
    return best;
  }

  private recordSkillUnlock(state: BlitzRunState): void {
    if (state.phase !== 'finished') return;
    const completed = state.missions.filter((mission) => mission.status === 'complete').length;
    const unlocked = state.cityId === 'lagos' && completed >= 2 && state.collisions <= 2 ? 'london' : state.cityId === 'london' && completed >= 2 && state.collisions <= 1 ? 'dubai' : null;
    if (!unlocked) return;
    try { safeLocalStorage()?.setItem(`nim-rush:unlock:${unlocked}`, state.rulesetVersion); } catch { /* Progress remains playable without storage. */ }
  }

  /**
   * A rider's career score: their best run in each city, added up.
   *
   * Built from the bests already kept for the result screen rather than from a
   * new counter, so a rider who has been playing arrives at their real level
   * instead of being reset to one. Keyed by ruleset version like the bests
   * are, so a course change starts the ladder again rather than crediting
   * scores set on a different course.
   */
  private careerScore(): number {
    const storage = safeLocalStorage();
    if (!storage) return 0;
    let total = 0;
    for (const city of BLITZ_CITIES) {
      try {
        const value = Number(storage.getItem(`nim-atlas:blitz:best:${blitzRules(this.difficulty).rulesetVersion}:${city.id}`) ?? 0);
        if (Number.isFinite(value) && value > 0) total += value;
      } catch { /* A rider with no storage simply starts at level one. */ }
    }
    return total;
  }

  private isCityUnlocked(cityId: BlitzCityId): boolean {
    if (cityId === 'lagos') return true;
    try { return safeLocalStorage()?.getItem(`nim-rush:unlock:${cityId}`) !== null; } catch { return false; }
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
    if (document.hidden && this.audioScene !== 'menu') {
      if (this.rankedTicket) this.rankedInterrupted = true;
      this.paused = true;
      this.previousTimestamp = null;
      this.accumulator = 0;
      this.input.reset();
      this.setAudioScene('paused');
      if (this.pauseButton) { this.pauseButton.textContent = '▶'; this.pauseButton.setAttribute('aria-label', 'Resume Beacon Blitz'); }
      if (this.pauseOverlay) {
        this.pauseOverlay.hidden = false;
        const copy = this.pauseOverlay.querySelector('.blitz-pause-copy');
        if (copy) copy.textContent = this.rankedInterrupted
          ? 'The screen was interrupted. This ranked attempt will not submit. Restart a free run to try again.'
          : 'The course is paused. Resume when the trail is clear.';
      }
      if (this.feedbackNode) { this.feedbackNode.textContent = 'RUN PAUSED / RECOVERY READY'; this.feedbackNode.className = 'blitz-feedback is-paused'; }
    }
    this.syncAudioScene();
  };

  private setAudioScene(scene: 'menu' | 'riding' | 'paused'): void {
    this.audioScene = scene;
    this.syncAudioScene();
  }

  private syncAudioScene(): void {
    const silent = document.hidden || this.audioMuted;
    for (const [bus, level] of [['ambience', .25], ['events', .7], ['interface', .5], ['voice', .85]] as const) this.audio.setVolume(bus, silent ? 0 : level);
    this.audio.setRideScene(silent ? 'silent' : this.audioScene, this.state?.speedMps ?? 0);
  }

  private audioGesture = (): void => {
    if (this.audioMuted || document.hidden) return;
    this.audio.unlock();
    this.syncAudioScene();
  };

  private soundControl(): HTMLButtonElement {
    const control = button(this.audioMuted ? 'Enable sound' : 'Mute sound', 'blitz-help blitz-sound', () => {
      this.audioMuted = !this.audioMuted;
      try { safeLocalStorage()?.setItem('nim-rush:muted', String(this.audioMuted)); } catch { /* Playback does not need storage. */ }
      this.syncAudioScene();
      this.audioGesture();
      control.textContent = this.audioMuted ? 'Enable sound' : 'Mute sound';
      control.setAttribute('aria-pressed', String(this.audioMuted));
    });
    control.setAttribute('aria-pressed', String(this.audioMuted));
    control.title = 'Music in menus. Tyres, wind and impacts while riding. Audio may need a first touch.';
    return control;
  }

  private resize = (): void => {
    this.renderer.resize(window.innerWidth, window.innerHeight, Math.min(devicePixelRatio, 1.25));
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

function formatUtcTime(timestampMs: number): string {
  return new Date(timestampMs).toISOString().slice(11, 16) + 'Z';
}

/*
 * A supply tally with its own glyph, so the result screen uses the same two
 * silhouettes the road does rather than two words a rider has to map back.
 */
function supplyStat(kind: 'nitro' | 'gearbox', value: string, label: string): HTMLElement {
  const cell = node('div', `blitz-supply blitz-supply-${kind}`);
  cell.append(node('i', `blitz-supply-glyph blitz-supply-glyph-${kind}`));
  cell.append(node('strong', 'blitz-supply-value', value));
  cell.append(node('span', 'blitz-supply-label', label));
  return cell;
}

/** How many past days of receipts a result screen shows before it gets long. */
const REWARD_ROWS = 4;

/*
 * Each label is a true sentence about where the money is. "Owed" is a decision
 * the server made; only "Paid" is a claim about the chain.
 */
const REWARD_STATE_LABEL: Readonly<Record<'owed' | 'sending' | 'paid' | 'attention', string>> = {
  owed: 'OWED / AWAITING RELEASE',
  sending: 'SENDING / ON CHAIN SOON',
  paid: 'PAID / CONFIRMED',
  attention: 'HELD / NEEDS A LOOK',
};

/*
 * A payout period is `blitz-<season>-<city>-<date>`, and the date is the part a
 * rider recognises. Anything that does not end in a date falls back to the raw
 * period rather than guessing at a prettier lie.
 */
function rewardDayLabel(period: string): string {
  const match = /(d{4}-d{2}-d{2})$/.exec(period);
  return match ? match[1]! : period;
}

/**
 * Basis points as a percentage a rider can read.
 *
 * The wire format is basis points because the payout arithmetic has to stay in
 * integers; nobody wants to read "5000 bps" on a result screen.
 */
function bpsLabel(bps: number): string {
  return `${(bps / 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`;
}

function shortWallet(address: string): string {
  const compact = address.replace(/\s/g, '');
  return compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`;
}
