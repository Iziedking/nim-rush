import { BLITZ_LIMIT_SECONDS, BLITZ_TICK_RATE, BOOST_ENGAGE_ENERGY, blitzComboMultiplier, createBlitzRun, sampleBlitzRoute, stepBlitzRun } from '../../../shared/atlas/blitz/core';
import { BLITZ_LATEST_RULESET_VERSION, blitzRuleFeatures } from '../../../shared/atlas/blitz/ruleset';
import { BLITZ_SECTORS } from '../../../shared/atlas/blitz/sectors';
import { BLITZ_BADGES, blitzRunBadges } from '../../../shared/atlas/blitz/badges';
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
import { BlitzVoice, blitzCallout } from './blitz-callouts';
import { createBlitzVoiceBank } from './blitz-voice-bank';
import { createBlitzStartGate } from './blitz-start-gate';
import { BLITZ_MINIMUM_FIELD } from '../../../shared/atlas/blitz/prize';
import { anchorAddress, anchorRun } from '../../nimiq/anchor';
import { blitzAnchorData } from '../../../shared/atlas/blitz/anchor';
import type { BlitzLeaderboardRow } from '../../../shared/atlas/blitz/competition';
import { createBlitzLobbyScreen } from './blitz-lobby-screen';
import { createBlitzNimiqRequired } from './blitz-nimiq-required';
import { blitzFieldPosition, blitzRivalGaps, type BlitzRivalPath } from '../../../shared/atlas/blitz/rivals';
import { createNimiqPoweredBy, createRushLogo } from './blitz-brand';
import { createBlitzRulesBody } from './blitz-rules';

const STEP_MS = 1_000 / BLITZ_TICK_RATE;
/* Long enough to see the bike stop and read FINISH; short enough that nobody
 * taps the screen wondering whether the game has hung. */
const FINISH_HOLD_MS = 2_200;
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
  /*
   * The race voice. Speaks only what a rider cannot see at speed - a contact,
   * the last gearbox, ten seconds left - and refuses a line rather than
   * queueing it, because a callout that arrives late describes a part of the
   * hill the rider has already left.
   */
  private readonly voiceBank = createBlitzVoiceBank();
  /*
   * A recorded line if one was rendered, the browser's speech engine if not.
   * The fallback exists so a clone of this repository without the audio step
   * still has a race voice, not so anybody has to settle for one.
   */
  private readonly voice = new BlitzVoice((callout) => {
    const level = document.hidden || this.audioMuted ? 0 : 0.85;
    if (this.voiceBank.play(callout.id, level)) return;
    if (level > 0) this.audio.narrate(callout.text);
  });
  private scoreNode: HTMLElement | null = null;
  private timerNode: HTMLElement | null = null;
  private speedNode: HTMLElement | null = null;
  private progressNode: HTMLElement | null = null;
  private boostNode: HTMLElement | null = null;
  private gearHost: HTMLElement | null = null;
  private driftWindowNode: HTMLElement | null = null;
  private speedVeil: HTMLElement | null = null;
  private missionHost: HTMLElement | null = null;
  private countdownNode: HTMLElement | null = null;
  private feedbackNode: HTMLElement | null = null;
  private pauseOverlay: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private paused = false;
  private rankedTicket: BlitzTicket | null = null;
  /*
   * The pack this run is being ridden against.
   *
   * Held for the whole run and never changed mid-run: a solid rival is part of
   * the physics, so swapping one out halfway would make the trace unverifiable.
   */
  private rivals: readonly BlitzRivalPath[] = [];
  /*
   * The wallet this device has connected.
   *
   * Nimiq is the identity every run is signed with, so nothing is playable
   * without one. Read from the address a previous bind already persisted, so
   * a returning rider is not asked to sign again just to see the menu.
   */
  private connectedWallet: string | null = null;
  private gapHost: HTMLElement | null = null;

  constructor(private readonly ui: HTMLElement, canvas: HTMLCanvasElement) {
    this.renderer = new BlitzRenderer(canvas);
    this.pendingRunStore = createBlitzPendingRunStore(safeLocalStorage());
    try { this.audioMuted = safeLocalStorage()?.getItem('nim-rush:muted') === 'true'; } catch { /* Sound remains optional. */ }
  }

  async boot(): Promise<void> {
    try {
      this.ui.className = 'blitz-ui';
      this.connectedWallet = this.rememberedWallet();
      /*
       * The door goes up before anything else, so the first frame a player
       * sees is a picture rather than an empty canvas. The world then loads
       * behind it, and the press that opens the door is also the gesture that
       * lets the browser start audio.
       */
      const gate = createBlitzStartGate({
        onStart: () => {
          this.audio.unlock();
          this.voiceBank.prime();
          gate.dismiss();
        },
      });
      this.ui.append(gate.element);
      await this.renderer.initialize(this.reducedMotion);
      await this.renderer.loadCity('lagos');
      this.resize();
      this.renderer.renderPreview('lagos');
      const invited = this.invitedLobbyId();
      if (invited && this.connectedWallet) void this.renderLobby(invited);
      else this.renderIntro();
      // renderIntro replaces the UI's children, so the gate is put back on top
      // of the screen it was hiding and only then told it may be opened.
      this.ui.append(gate.element);
      gate.ready();
      // Launch can play on hosts that permit it. Suspended contexts retry on
      // gestures, but the current scene alone decides which loops may play.
      this.audioGesture();
      window.addEventListener('pointerdown', this.audioGesture);
      window.addEventListener('keydown', this.audioGesture);
      window.addEventListener('resize', this.resize);
      /*
       * On iOS the visible box changes without a window resize: the toolbar
       * slides away as you scroll, the keyboard opens, the address bar
       * collapses. Listening only to window resize leaves the canvas sized for
       * the frame before last, which is how a strip of the world ends up drawn
       * underneath the controls.
       */
      window.visualViewport?.addEventListener('resize', this.resize);
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
    const screen = node('main', 'blitz-onboarding blitz-fullscreen-page');
    screen.setAttribute('data-blitz-screen', 'onboarding');
    screen.append(createRushLogo('compact'));

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
    const screen = node('main', 'blitz-intro blitz-fullscreen-page');
    screen.setAttribute('data-blitz-screen', 'intro');
    const logo = createRushLogo('hero');
    const edition = node('span', 'blitz-edition', 'DAILY DESCENT');
    const title = node('h1', 'blitz-title', 'RIDGE\nRUN');
    const line = node('p', 'blitz-tagline', 'Find your line. Ride the ridge. Prove your run.');
    const daily = getBlitzDailyChallenge({ now: Date.now(), cityId: 'lagos', seasonId: BLITZ_SEASON });
    /*
     * The three-verb brief that used to sit here is gone. It taught check,
     * approve and confirm on the screen a player is trying to leave, next to a
     * title, a tagline, a stat strip, a leaderboard and a note - and the
     * opening now teaches the same thing properly, one idea at a time. A
     * landing page's job is to be understood in a glance and then get out of
     * the way.
     */
    const difficultyChooser = node('fieldset', 'blitz-difficulty');
    /*
     * Ranked keeps one shared ruleset, so this chooser has never applied to
     * today's challenge - but sitting under a bare 'DIFFICULTY' it read as if
     * it did, which is the sort of ambiguity that makes a rider think a
     * leaderboard can be gamed. The legend names what it governs.
     */
    difficultyChooser.append(node('legend', '', 'DIFFICULTY FOR PRACTICE AND FRIENDS'));
    const rookie = button('Rookie', `blitz-difficulty-option${this.difficulty === 'rookie' ? ' is-selected' : ''}`, () => { this.difficulty = 'rookie'; this.renderIntro(); });
    const pro = button('Pro', `blitz-difficulty-option${this.difficulty === 'pro' ? ' is-selected' : ''}`, () => { this.difficulty = 'pro'; this.renderIntro(); });
    rookie.setAttribute('aria-pressed', String(this.difficulty === 'rookie'));
    pro.setAttribute('aria-pressed', String(this.difficulty === 'pro'));
    difficultyChooser.append(rookie, pro);

    const masthead = node('section', 'blitz-intro-masthead');
    masthead.append(logo, edition, title, line);

    /*
     * One line of trail data, not a strip of boxes.
     *
     * The distance, the limit and the descent are facts a rider glances at
     * once; giving each of them a bordered card made three objects out of one
     * sentence and turned the top of the panel into furniture.
     */
    const meta = node('p', 'blitz-trail-meta', `DROP 01 · LAGOS · 1.9 KM · ${BLITZ_LIMIT_SECONDS} SEC · RESETS\u00a0${formatUtcTime(daily.expiresAt)}`);

    const command = node('section', 'blitz-intro-command');
    command.setAttribute('aria-label', 'Start a run');
    command.append(meta);

    if (!this.connectedWallet) {
      /*
       * Nimiq is the way in.
       *
       * The wallet is the identity every run is signed with, so there is no
       * screen behind this one - and the panel is one action because a rider
       * who has not connected has exactly one thing to do.
       */
      /*
       * An invite is the reason most people will ever see this screen, so it
       * says so. A stranger who followed a friend's link and is met by a
       * generic connect panel has no idea a seat is being held for them, and
       * the one thing that would make them finish is the thing we left out.
       */
      const invited = this.invitedLobbyId();
      if (invited) command.append(node('span', 'blitz-mode-label', 'YOU WERE INVITED'));
      const connect = button(invited ? 'Connect and take your seat' : 'Connect Nimiq wallet', 'blitz-start blitz-connect', () => void this.connectWallet(connect, connectNote));
      const connectNote = node('p', 'blitz-quiet', invited
        ? 'A seat is being held for you. Signing proves who you are; it never moves money.'
        : 'Signs your identity. Never a payment.');
      command.append(connect, connectNote);
    } else {
      /*
       * A rider names themselves once.
       *
       * The field used to be there every single time, so entering a race meant
       * re-reading a name you had already chosen before you could press the
       * button - three screens deep, on a phone, every day. A name that is
       * already settled is shown as settled, with one way to change it.
       *
       * The input still exists behind it, because the name is what the server
       * binds to the wallet and it is what a clash has to be corrected in.
       */
      const username = node('input', 'blitz-username');
      username.type = 'text';
      username.inputMode = 'text';
      username.autocomplete = 'username';
      username.maxLength = 18;
      username.placeholder = 'Rider name';
      username.setAttribute('aria-label', 'Rider name');
      try { username.value = localStorage.getItem('nim-atlas:blitz:username') ?? ''; } catch { /* Storage is optional. */ }

      const nameLabel = node('span', 'blitz-field-label', 'RIDER NAME');
      const settled = node('div', 'blitz-name-settled');
      const settledName = node('strong', 'blitz-name-value', username.value);
      const rename = button('Change', 'blitz-quiet blitz-name-change', () => {
        settled.hidden = true;
        username.hidden = false;
        nameLabel.hidden = false;
        username.focus();
      });
      // The rider's record, beside their name. Hidden until the server answers,
      // and for a rider with no verified day yet.
      const streak = node('span', 'blitz-streak');
      streak.hidden = true;
      settled.append(settledName, streak, rename);
      void this.presentProgress(streak);
      const nameIsSettled = /^[A-Za-z0-9_]{3,18}$/.test(username.value);
      settled.hidden = !nameIsSettled;
      username.hidden = nameIsSettled;
      /*
       * A settled name does not need a caption. The row underneath already
       * reads "Rider" with a Change button beside it, so the stamped RIDER NAME
       * tab above it was a label on a label - which is how a screen ends up
       * looking like it was assembled rather than designed. It comes back the
       * moment the field is open and there is an empty box to explain.
       */
      nameLabel.hidden = nameIsSettled;
      username.addEventListener('input', () => { settledName.textContent = username.value; });

      /*
       * The pool, as a number and a clock. What the split is and when it
       * settles are in the rules, because a rider deciding whether to ride
       * needs the size of the prize, not its arithmetic.
       */
      const pool = node('div', 'blitz-pool');
      pool.hidden = true;
      void this.presentDayPool(pool);

      const rankedStatus = node('p', 'blitz-rank-status', '');
      const rankedButton = button("Ride today's challenge", 'blitz-start blitz-ranked-button', () => void this.prepareRankedStart('lagos', username, rankedButton, rankedStatus));
      const ranked = node('section', 'blitz-ranked-launch');
      ranked.append(node('span', 'blitz-mode-label', 'DAILY CHALLENGE'), pool, nameLabel, settled, username, rankedButton, rankedStatus);

      // Practice. Deliberately the quieter of the two: it is the one that does
      // not count, and the panel should lead with the one that does.
      const free = node('section', 'blitz-mode-free');
      free.append(difficultyChooser, button('Free run', 'blitz-again blitz-free-run', () => void this.startRun('lagos')));
      /*
       * A private race with friends. Seven seats, first come first served, and
       * the link is the invitation - so the button that makes one is the same
       * button that puts the host in seat one.
       */
      const lobbyStatus = node('p', 'blitz-rank-status', '');
      const lobbyButton = button('Race friends', 'blitz-again blitz-open-lobby', () => void this.openLobby(lobbyButton, lobbyStatus));
      free.append(lobbyButton, lobbyStatus);

      command.append(ranked, free);
    }

    // A board nobody can find is a board nobody rides for.
    command.append(button('Leaderboard', 'blitz-again blitz-open-board', () => void this.renderLeaderboard('today')));
    /*
     * Rules opens a screen, not a file.
     *
     * This was an anchor to /docs/how-nim-rush-works.md, which is not deployed:
     * production's single-page fallback answered it with index.html and a 200,
     * so the app reloaded and the rider was returned to the start screen having
     * read nothing. It only ever worked in dev, where Vite serves the repo.
     */
    command.append(button('Rules', 'blitz-again blitz-open-rules', () => this.renderRules()));
    const utility = node('nav', 'blitz-intro-utility');
    utility.setAttribute('aria-label', 'Game utilities');
    utility.append(button('How to ride', 'blitz-help', () => this.renderOnboarding(blitzOnboardingSeen(safeLocalStorage()) ? 1 : 0)), this.soundControl(), createNimiqPoweredBy());
    screen.append(masthead, command, utility);
    const pending = this.pendingRunStore.read();
    if (pending) {
      const recovery = node('section', 'blitz-pending-run');
      const recoveryStatus = node('p', 'blitz-rank-status', 'A ranked run is saved locally and still needs verification.');
      recovery.append(node('strong', '', 'SAVED RANKED RUN'), recoveryStatus);
      recovery.append(button('Verify saved run', 'blitz-verify', () => void this.submitPendingRun(pending, recoveryStatus, recovery)));
      recovery.append(button('Discard saved run', 'blitz-quiet blitz-discard-run', () => { this.pendingRunStore.clear(); recovery.remove(); }));
      /*
       * Into the panel, at the top.
       *
       * This used to be a sibling of the panel in its own grid row, which on a
       * phone put it under the utility row and off the bottom of a screen that
       * was already full. A rider with a ranked run still waiting to be
       * verified would never see that it existed, and the run would sit there
       * unclaimed. It is the first thing that matters, so it is the first thing
       * in the panel.
       */
      command.prepend(recovery);
    }
    this.ui.append(screen);
  }

  /*
   * `options.seed` is how a private lobby becomes a race.
   *
   * A free run used to seed itself from the current minute. Friends who tapped
   * Ride a minute apart were riding two different hills, and under the V6
   * rules - where the day moves the obstacles - a minute seed would also have
   * been a layout nobody races on. A free run now rides today's descent for its
   * city: same rocks, same coins, same contracts as the ranked run, unranked.
   * It is practice for the thing that counts, and a lobby gets the identical
   * course, corner for corner.
   */
  /*
   * What a free run rides.
   *
   * Today's descent, so practice is practice for the run that counts - but
   * always under the NEWEST rules rather than the day's. The two are the same
   * on every day except one: the day a rules change is scheduled, when free
   * play is already riding what ranked gets at the reset. That is the point of
   * it. A fix to how the bike rides should be in a rider's hands the day it
   * ships, and ranked cannot move mid-day without throwing away the board and
   * the payouts that are keyed to it.
   */
  private freeRunSeed(cityId: BlitzCityId): string {
    const challenge = getBlitzDailyChallenge({ now: Date.now(), cityId, seasonId: BLITZ_SEASON });
    return challenge.rulesetVersion === BLITZ_LATEST_RULESET_VERSION
      ? challenge.seed
      : `${BLITZ_SEASON}:${cityId}:${challenge.date}:${BLITZ_LATEST_RULESET_VERSION}`;
  }

  private async startRun(cityId: BlitzCityId, rankedTicket: BlitzTicket | null = null, options: { readonly seed?: string } = {}): Promise<void> {
    this.setAudioScene('paused');
    this.audio.unlock();
    this.cityId = cityId;
    this.rankedTicket = rankedTicket;
    const seed = rankedTicket?.seed ?? options.seed ?? this.freeRunSeed(cityId);
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
    /*
     * Ranked rides the pack the server pinned to the ticket, so verification
     * rides the same one. A free run has no pack until the rival service is
     * wired, and an empty pack is simply a solo descent.
     */
    this.rivals = rankedTicket?.rivals ?? [];
    this.state = createBlitzRun({ cityId, seed, difficulty: rankedTicket ? 'rookie' : this.difficulty, loadout, rivals: this.rivals });
    this.previousRenderState = null;
    this.frames = [];
    this.finishHoldUntil = null;
    this.lastPhysicsAudioTick = -1;
    this.paused = false;
    this.input.reset();
    this.voice.reset();
    // Decode the lines before the first corner, not during it.
    this.voiceBank.prime();
    // The scene has to be built for the ruleset this run is judged under, or
    // a rider swerves around obstacles that are not there and rides through
    // ones that are.
    await this.renderer.loadCity(cityId, this.state.difficulty, this.state.seed);
    this.renderer.setRivals(this.rivals);
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
    /*
     * A ranked run says which of the day's goes it is.
     *
     * The count was known only to the server, so the first a rider heard of the
     * limit was being turned away at the fourth ticket - and a rider on their
     * last attempt had no way to know it was the last one, which is exactly the
     * moment the information is worth having.
     */
    const attempt = this.rankedTicket?.attemptsUsed && this.rankedTicket.attemptsAllowed
      ? ` · ATTEMPT ${this.rankedTicket.attemptsUsed} OF ${this.rankedTicket.attemptsAllowed}`
      : '';
    const cityName = node('div', 'blitz-city-name', `${city.circuit} · ${this.difficulty.toUpperCase()}${attempt}`);
    this.timerNode = node('div', 'blitz-timer', '90.0');
    this.scoreNode = node('div', 'blitz-score', '000000');
    this.pauseButton = button(this.rankedTicket ? 'LIVE' : 'II', 'blitz-pause', this.togglePause);
    this.pauseButton.setAttribute('aria-label', this.rankedTicket ? 'Ranked run cannot be paused' : 'Pause Beacon Blitz');
    top.append(cityName, this.timerNode, this.scoreNode, this.pauseButton);
    /*
     * Which part of the descent this is. The course hardens at each third, so
     * the rider is told as they cross into it, once, and then left alone.
     */
    this.sectorNode = node('div', 'blitz-sector-banner');
    this.sectorNode.hidden = true;
    this.sectorNode.setAttribute('role', 'status');
    this.shownSector = -1;
    top.append(this.sectorNode);

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
    /*
     * The trail, counted as it is taken.
     *
     * Nitro and gearboxes are spent, so their meters are about what is left.
     * The NIM count is the opposite: it only ever goes up, and it is the one
     * number on the HUD a rider can improve by choosing a better line. Without
     * it, collecting sixty tokens and collecting six look the same until the
     * run is over.
     */
    const nimWrap = node('div', 'blitz-nim-wrap');
    nimWrap.append(node('span', '', 'NIM'));
    this.nimNode = node('strong', 'blitz-nim-count', '0');
    this.nimNode.setAttribute('aria-label', 'NIM tokens collected');
    nimWrap.append(this.nimNode);
    /*
     * The streak, under the count. A coin in a run of them is worth more, and
     * a rider chasing x2 needs to see how close they are without looking away
     * from the trail - so it is short, and it glows once the multiplier is on.
     */
    this.comboNode = node('span', 'blitz-nim-combo');
    this.comboNode.hidden = true;
    this.comboNode.setAttribute('aria-live', 'off');
    nimWrap.append(this.comboNode);
    boost.append(nimWrap);
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

    /*
     * Who is actually being raced.
     *
     * A time on its own says nothing - a rider needs to know they are four
     * seconds off the name above them. Hidden entirely when riding alone,
     * because an empty list is worse than no list.
     */
    this.gapHost = node('section', 'blitz-gaps');
    this.gapHost.setAttribute('aria-label', 'Gaps to other riders');
    /*
     * Riding an empty hill, said out loud.
     *
     * Somebody has to be first down a course, and when they are, a ranked run
     * looks exactly like a free one - same trail, same silence, no reason to
     * believe the race is real. Naming it turns the flattest version of the
     * mode into the one with a claim attached: the line you draw now is the
     * one everybody who rides after you has to get past.
     */
    this.gapHost.hidden = this.rivals.length > 0 ? false : !this.rankedTicket;
    if (this.rivals.length === 0 && this.rankedTicket) {
      const alone = node('div', 'blitz-first-down');
      alone.append(
        node('strong', 'blitz-first-down-title', 'FIRST DOWN'),
        node('span', 'blitz-first-down-note', 'You set the line'),
      );
      this.gapHost.append(alone);
    }

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
      /*
       * A way out. Pausing offered Resume and Restart and nothing else, so the
       * only exit from a run was to finish it or close the app - which, on a
       * ranked attempt, is the one thing that loses it.
       */
      button('Back to menu', 'blitz-again blitz-pause-menu', () => this.renderIntro()),
    );

    const controls = node('section', 'blitz-controls');
    const steerZone = node('div', 'blitz-control blitz-steer-zone');
    steerZone.setAttribute('aria-label', 'Drag left or right to steer');
    const steerRail = node('div', 'blitz-steer-rail');
    const thumb = node('i', 'blitz-steer-thumb');
    steerRail.append(thumb);
    steerZone.append(node('span', '', 'STEER'), steerRail);
    /*
     * One pad per thumb.
     *
     * Tuck and brake were two 52px buttons, and the rhythm of a descent -
     * brake into the corner, tuck out of it - meant a thumb hopping between
     * them mid-corner. They are the two ends of one axis, so they are now one
     * pad: hold the top to tuck, slide down to brake, let go to sit up. The
     * thumb never leaves the control it is already on.
     *
     * The pad also says what the hill is about to ask for, which is the other
     * half of why the bike felt like it was riding itself: a rider could not
     * see their own decisions coming.
     */
    const posture = node('div', 'blitz-control blitz-posture');
    posture.setAttribute('role', 'group');
    posture.setAttribute('aria-label', 'Posture: hold the top to tuck, the bottom to brake');
    const postureTuck = node('div', 'blitz-posture-half blitz-posture-tuck');
    postureTuck.append(node('span', 'blitz-posture-name', 'TUCK'), node('small', 'blitz-posture-hint', 'HOLD TO RIDE'));
    const postureBrake = node('div', 'blitz-posture-half blitz-posture-brake');
    postureBrake.append(node('i', 'blitz-key-glyph blitz-key-glyph-brake'), node('span', 'blitz-posture-name', 'BRAKE'));
    const postureCoach = node('span', 'blitz-posture-coach');
    postureCoach.setAttribute('role', 'status');
    posture.append(postureTuck, postureBrake, postureCoach);
    this.postureNode = posture;
    this.postureCoachNode = postureCoach;

    /*
     * The spend rack, in slots that are always there.
     *
     * BOOST is dead with an empty tank and DRIFT is dead with no gearbox, so
     * each key only lights when there is something to spend. They used to be
     * removed from the layout entirely, which collapsed the row and moved the
     * pad underneath them UNDER THE RIDER'S THUMB, mid-run, every time a
     * bottle was taken or spent. The slots now hold their space and the keys
     * fade in and out of them, so nothing below ever moves.
     */
    const spend = node('div', 'blitz-spend');
    const boostButton = button('', 'blitz-control blitz-boost blitz-spend-key', () => undefined);
    boostButton.setAttribute('aria-label', 'Nitro');
    boostButton.append(node('i', 'blitz-key-glyph blitz-key-glyph-bottle'), node('span', 'blitz-spend-label', 'NITRO'));
    const drift = button('', 'blitz-control blitz-drift blitz-spend-key', () => undefined);
    drift.setAttribute('aria-label', 'Drift');
    drift.append(node('i', 'blitz-key-glyph blitz-key-glyph-gear'), node('span', 'blitz-spend-label', 'DRIFT'));
    spend.append(boostButton, drift);

    controls.append(steerZone, spend, posture);
    this.boostKey = boostButton;
    this.driftKey = drift;
    this.input.bindSteering(steerZone, thumb);
    this.input.bindPosture(posture, (held) => {
      // What the rider is doing wins over what the hill is asking for: a
      // prompt that argues with the thumb already on the pad is noise.
      if (held !== 'neutral') this.setCoach(null);
    });
    this.input.bindLatch(boostButton, 'boost');
    // A gearbox buys 1.5s of slide; the pulse outlasts it slightly so the
    // window is never cut short by the button letting go first.
    this.input.bindPulse(drift, 'drift', 1_700);

    /*
     * The speed layer.
     *
     * A camera that only moves faster does not read as faster - what sells
     * speed is the frame closing in at the edges while the centre stays
     * readable. Painted rather than blurred: a real backdrop-filter costs a
     * full-screen pass every frame on a phone, and this has to be free.
     */
    this.speedVeil = node('div', 'blitz-speed-veil');
    this.speedVeil.setAttribute('aria-hidden', 'true');
    screen.append(top, speedBox, progress, boost, this.gapHost, this.missionHost, this.feedbackNode, this.speedVeil, this.countdownNode, this.pauseOverlay, controls);
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
      next = stepBlitzRun(next, sampled, this.rivals);
      if (!wasBoostActive && next.boostActive) this.audio.playWorldCue('bike-boost');
      if (next.lastEvent && next.lastEvent.tick !== this.lastPhysicsAudioTick && next.lastEvent.type !== 'boost-start' && next.lastEvent.type !== 'boost-end') {
        this.audio.playPhysicsCue(next.lastEvent);
        this.lastPhysicsAudioTick = next.lastEvent.tick;
      }
      // Offered every step; the channel decides. Comparing the two states is
      // what keeps a line tied to something that actually just happened.
      this.voice.offer(blitzCallout(this.previousRenderState, next));
      this.accumulator -= STEP_MS;
      steps += 1;
    }
    this.state = next;
    this.audio.setBikeContact(next.surface, next.airborne || this.paused, next.lateralVelocityMps);
    if (this.frameGovernor.shouldRender(timestamp)) {
      this.renderer.render(next, this.input.sample().steer, this.previousRenderState, this.accumulator / STEP_MS);
      this.updateRunHud(next);
    }
    /*
     * Arriving, rather than being cut off mid-stride.
     *
     * The result screen used to replace the world on the exact tick the finish
     * line was crossed, at a hundred and something kilometres an hour - so a
     * run ended by the trail vanishing underneath a rider still travelling. The
     * course geometry stops at the line too, which is what made it read as
     * riding off the end of the world.
     *
     * A finish now holds the world for a couple of seconds while the bike rolls
     * to a stop and the banner reads FINISH. A timeout gets none of this: the
     * clock running out is not an arrival, and pretending it is would be a
     * flourish for the one ending that has not earned one.
     */
    if (next.phase === 'finished' && this.finishHoldUntil === null) {
      this.finishHoldUntil = timestamp + FINISH_HOLD_MS;
      this.finishSpeedMps = next.speedMps;
      this.input.reset();
      if (this.countdownNode) { this.countdownNode.textContent = 'FINISH'; this.countdownNode.classList.add('is-live'); }
    }
    if (this.finishHoldUntil !== null && timestamp < this.finishHoldUntil) {
      const remaining = (this.finishHoldUntil - timestamp) / FINISH_HOLD_MS;
      // Rolling to a halt, not braking: the rider has already done the work.
      const coasting = { ...next, speedMps: this.finishSpeedMps * remaining * remaining, boostActive: false };
      if (this.frameGovernor.shouldRender(timestamp)) this.renderer.render(coasting, 0, coasting, 0);
      this.audio.setBikeSpeed(coasting.speedMps);
      this.frameHandle = requestAnimationFrame(this.frame);
      return;
    }
    if (next.phase === 'finished' || next.phase === 'timeout') {
      this.finishHoldUntil = null;
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
    if (this.speedNode) {
      this.speedNode.textContent = Math.round(state.speedMps * 3.6).toString().padStart(3, '0');
      /*
       * Rising or falling, in colour. The number alone changes too slowly to
       * read as a consequence of the thumb on the pad, which is most of why
       * posture felt like it did nothing.
       */
      const change = state.speedMps - this.previousSpeedMps;
      this.previousSpeedMps = state.speedMps;
      this.speedNode.classList.toggle('is-gaining', change > 0.04);
      this.speedNode.classList.toggle('is-losing', change < -0.04);
    }
    if (this.progressNode) this.progressNode.style.width = `${Math.min(100, state.distanceMeters / city.lengthMeters * 100)}%`;
    /*
     * A fraction of the tank this rider actually carries. Reading the raw
     * energy as a percentage was only ever right for a 60-unit tank, and a
     * levelled rider carries 84.
     */
    if (this.boostNode) this.boostNode.style.width = `${Math.min(100, state.boostEnergy / state.boostCapacity * 100)}%`;
    this.updateSupplyHud(state);
    /*
     * Nothing below 26 m/s, everything by 45. The low end is where a rider
     * coasts, and closing the frame in on a rider who is already slow would
     * read as a penalty rather than as speed.
     */
    if (this.speedVeil) {
      const rush = Math.max(0, Math.min(1, (state.speedMps - 26) / 19));
      this.speedVeil.style.setProperty('--rush', (rush * rush).toFixed(3));
      this.speedVeil.classList.toggle('is-boosting', state.boostActive);
    }
    this.audio.setBikeSpeed(state.speedMps);
    if (this.countdownNode) {
      this.countdownNode.textContent = state.phase === 'countdown' ? String(Math.max(1, Math.ceil(state.countdownTicks / BLITZ_TICK_RATE))) : 'GO';
      this.countdownNode.classList.toggle('is-live', state.phase === 'running');
    }
    this.updateGapHud(state);
    this.updateMissionHud(state);
  }

  /*
   * One contract on screen, not three.
   *
   * Three stacked cards sat over the top quarter of the trail, which is the
   * part a rider needs to read to pick a line - so the instructions were
   * covering the thing they were instructions about. A rider can only work on
   * one contract at a time anyway, so only one is shown: whichever is live,
   * or the next one waiting.
   *
   * It also gets out of the way. The card is there while something is
   * happening to it and fades once nothing has changed for a few seconds,
   * coming straight back when progress moves or the contract does. Nothing is
   * removed from the DOM, so the update path and its tests are unchanged.
   */
  private finishHoldUntil: number | null = null;
  private finishSpeedMps = 0;
  private nimNode: HTMLElement | null = null;
  private postureNode: HTMLElement | null = null;
  private postureCoachNode: HTMLElement | null = null;
  private coachAsk: 'tuck' | 'brake' | null = null;
  private coachAskedAt = 0;
  private previousSpeedMps = 0;
  private comboNode: HTMLElement | null = null;
  private sectorNode: HTMLElement | null = null;
  private shownSector = -1;
  private boostKey: HTMLElement | null = null;
  private driftKey: HTMLElement | null = null;
  private missionShownId: string | null = null;
  private missionAwakeUntil = 0;

  private renderMissionHud(state: BlitzRunState): void {
    if (!this.missionHost) return;
    this.missionHost.replaceChildren();
    this.missionShownId = null;
    this.missionAwakeUntil = 0;
    const heading = node('div', 'blitz-mission-heading', "TODAY'S THREE CONTRACTS");
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
      /*
       * The instruction, then how to do it, then how far away it is.
       *
       * The card used to show a four-word verb and a counter. "Respect the
       * surface" with 0/1 beside it tells a rider nothing they can act on, and
       * the description that would have - which every contract already carries
       * - was never rendered anywhere in the app. Nor was failureReason, so a
       * contract went from READY to MISSED without ever saying why.
       */
      const detail = node('p', 'blitz-mission-detail', mission.description);
      detail.dataset.missionDetail = mission.id;
      const distance = node('span', 'blitz-mission-distance', '');
      distance.dataset.missionDistance = mission.id;
      card.append(top, node('p', 'blitz-mission-verb', mission.verb), detail, progress, meterTrack, distance);
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
      const detail = card.querySelector(`[data-mission-detail="${mission.id}"]`);
      // A failed contract explains itself. It knew all along; it just never said.
      if (detail) detail.textContent = mission.status === 'failed' && mission.failureReason ? mission.failureReason : mission.description;
      const distance = card.querySelector(`[data-mission-distance="${mission.id}"]`);
      if (distance instanceof HTMLElement) {
        // A rider cannot plan for something they first hear about as it starts.
        const away = Math.round(mission.gateDistance - state.distanceMeters);
        distance.textContent = mission.status === 'pending' && away > 0 ? `IN ${away} M` : '';
        distance.hidden = distance.textContent === '';
      }
      card.classList.toggle('is-active', mission.status === 'active');
      card.classList.toggle('is-complete', mission.status === 'complete');
      card.classList.toggle('is-failed', mission.status === 'failed');
    }
    this.showCurrentContract(state);
  }

  /**
   * The one contract worth reading right now, and how long it stays up.
   *
   * "Live" wins, because that is the one being scored this second. Otherwise
   * the next one still open, so a rider knows what is coming. When every
   * contract is settled there is nothing left to instruct, and the card goes.
   */
  private showCurrentContract(state: BlitzRunState): void {
    if (!this.missionHost) return;
    const live = state.missions.find((mission) => mission.status === 'active');
    const next = state.missions.find((mission) => mission.status !== 'complete' && mission.status !== 'failed');
    const current = live ?? next ?? null;
    const signature = current ? `${current.id}:${current.status}:${Math.min(current.progress, current.target)}` : 'none';
    if (signature !== this.missionShownId) {
      this.missionShownId = signature;
      // Four seconds is long enough to read a six-word instruction at speed and
      // short enough that a rider is not reading it through the next corner.
      this.missionAwakeUntil = performance.now() + 4_200;
    }
    for (const card of this.missionHost.querySelectorAll('.blitz-mission-card')) {
      card.classList.toggle('is-shown', card instanceof HTMLElement && card.dataset.missionId === current?.id);
    }
    const awake = Boolean(current) && performance.now() < this.missionAwakeUntil;
    this.missionHost.classList.toggle('is-idle', !awake);
  }

  private togglePause = (): void => {
    if (this.rankedTicket) {
      if (this.feedbackNode) {
        this.feedbackNode.textContent = 'A RANKED RUN CANNOT BE PAUSED';
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
      this.feedbackNode.textContent = this.paused ? 'PAUSED. RESUME WHEN READY.' : '';
      this.feedbackNode.className = this.paused ? 'blitz-feedback is-paused' : 'blitz-feedback';
    }
  };

  /**
   * The public board, as a screen of its own.
   *
   * It existed only as five rows tucked inside a collapsed panel on the result
   * screen, which meant the only people who ever saw who was winning were the
   * people who had just ridden - and even they had to go looking. A daily
   * contest that hides its standings is asking riders to care about something
   * they cannot see.
   *
   * Today and all time come from the same endpoint: the season board is the
   * all-time board, and passing a challenge id narrows it to one day.
   */
  private async renderLeaderboard(scope: 'today' | 'all'): Promise<void> {
    this.setAudioScene('menu');
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-board blitz-fullscreen-page');
    screen.setAttribute('data-blitz-screen', 'leaderboard');

    const head = node('section', 'blitz-board-head');
    head.append(createRushLogo('compact'), node('h1', 'blitz-board-title', 'LEADERBOARD'));

    const tabs = node('nav', 'blitz-board-tabs');
    tabs.setAttribute('aria-label', 'Leaderboard range');
    const today = button("Today", `blitz-board-tab${scope === 'today' ? ' is-current' : ''}`, () => void this.renderLeaderboard('today'));
    const allTime = button('All time', `blitz-board-tab${scope === 'all' ? ' is-current' : ''}`, () => void this.renderLeaderboard('all'));
    if (scope === 'today') today.setAttribute('aria-current', 'page');
    else allTime.setAttribute('aria-current', 'page');
    tabs.append(today, allTime);

    const body = node('section', 'blitz-board-body');
    body.append(node('p', 'blitz-board-status', 'READING THE BOARD...'));
    const back = node('nav', 'blitz-board-actions');
    back.append(button('Back', 'blitz-again blitz-board-back', () => this.renderIntro()), createNimiqPoweredBy());
    screen.append(head, tabs, body, back);
    this.ui.append(screen);

    const cityId: BlitzCityId = 'lagos';
    const challengeId = scope === 'today'
      ? getBlitzDailyChallenge({ now: Date.now(), cityId, seasonId: BLITZ_SEASON }).challengeId
      : undefined;
    try {
      const rows = await this.api.getBlitzLeaderboard(BLITZ_SEASON, cityId, challengeId);
      body.replaceChildren();
      body.append(node('p', 'blitz-board-scope', scope === 'today'
        ? `${blitzCity(cityId).name.toUpperCase()} - TODAY, RESETS 00:00 UTC`
        : `${blitzCity(cityId).name.toUpperCase()} - EVERY VERIFIED RUN THIS SEASON`));
      if (rows.length === 0) {
        body.append(node('p', 'blitz-board-empty', scope === 'today'
          ? 'Nobody has posted a verified run today. The first one takes the board.'
          : 'No verified runs yet this season.'));
      }
      for (const row of rows.slice(0, 25)) {
        const item = node('div', `blitz-board-row${row.rank <= 3 ? ' is-podium' : ''}`);
        item.append(
          node('b', 'blitz-board-rank', `#${row.rank}`),
          node('span', 'blitz-board-name', row.username),
          node('small', 'blitz-board-wallet', shortWallet(row.walletAddress)),
          node('span', 'blitz-board-time', `${(row.elapsedMs / 1_000).toFixed(1)}s`),
          node('strong', 'blitz-board-score', row.score.toLocaleString()),
        );
        body.append(item);
      }
    } catch {
      body.replaceChildren(node('p', 'blitz-board-status', 'THE BOARD IS OFFLINE. YOUR RUNS ARE STILL VERIFIED.'));
    }
  }

  /** The rules document, on screen, with a way back. */
  private renderRules(): void {
    this.setAudioScene('menu');
    this.input.clearBindings();
    this.ui.replaceChildren();
    const screen = node('main', 'blitz-board blitz-rules-screen blitz-fullscreen-page');
    screen.setAttribute('data-blitz-screen', 'rules');
    const head = node('section', 'blitz-board-head');
    head.append(createRushLogo('compact'), node('h1', 'blitz-board-title', 'HOW IT WORKS'));
    const body = node('section', 'blitz-board-body');
    body.append(createBlitzRulesBody());
    const actions = node('nav', 'blitz-board-actions');
    actions.append(button('Back', 'blitz-again blitz-board-back', () => this.renderIntro()), createNimiqPoweredBy());
    screen.append(head, body, actions);
    this.ui.append(screen);
  }

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
    const screen = node('main', 'blitz-result blitz-fullscreen-page');
    screen.setAttribute('data-blitz-screen', 'result');
    const primary = node('section', 'blitz-result-primary');
    primary.append(createRushLogo('compact'));
    const resultHero = node('section', 'blitz-result-hero');
    resultHero.append(node('p', 'blitz-result-kicker', state.phase === 'finished' ? `${city.circuit.toUpperCase()} CLEARED` : 'RUN ENDED'));
    resultHero.append(node('span', 'blitz-result-score-label', 'TOTAL RUN SCORE'));
    resultHero.append(node('h1', 'blitz-result-score', state.score.toLocaleString()));
    /*
     * Riders put out, said out loud.
     *
     * A takedown is the one thing in a run that happened to somebody else, so
     * it is worth naming rather than leaving folded into the racing-line
     * number. Only shown when there were any: a line reading "0 TAKEDOWNS" on
     * every clean run is furniture.
     */
    const cleared = state.missions.filter((mission) => mission.status === 'complete').length;
    const ledgerLine = [`${(state.elapsedMs / 1_000).toFixed(1)} SEC`, `${state.collisions} CONTACTS`, `${cleared} OF 3 CONTRACTS`];
    if (state.takedowns > 0) ledgerLine.push(`${state.takedowns} PUT OUT`);
    // The same separator the trail data above uses. A slash between three
    // facts reads as a machine listing them rather than a run being described.
    resultHero.append(node('p', 'blitz-result-time', ledgerLine.join(' · ')));
    /*
     * A zero is not a personal best.
     *
     * The score floors at zero, and a rider who bounced down the hill can land
     * there with a first run behind them and be congratulated for it. Nothing
     * is the one score that never deserves the line, so it says what happened
     * instead.
     */
    resultHero.append(node('p', 'blitz-result-best', state.score === 0
      ? 'NO SCORE. THE CONTACTS TOOK IT ALL.'
      : best === state.score ? 'NEW PERSONAL BEST' : `PERSONAL BEST ${best.toLocaleString()}`));
    primary.append(resultHero, this.resultContracts(state), this.resultBadges(state));
    screen.append(primary);
    const ledger = node('section', 'blitz-result-ledger');
    const breakdown = node('div', 'blitz-breakdown');
    const score = state.scoreBreakdown;
    breakdown.append(
      stat(`+${score.finishTime.toLocaleString()}`, 'FINISH TIME'),
      /*
       * The trail, counted and priced.
       *
       * It was being added into the racing-line term, which meant a rider could
       * take sixty NIM tokens down a hill and find no line on the result screen
       * that said so. A thing you spend a run collecting has to be a thing the
       * run reports back.
       */
      stat(`+${score.nimTrail.toLocaleString()}`, `NIM TRAIL (${state.tokensTaken} TAKEN)`),
      stat(`+${score.racingLine.toLocaleString()}`, 'RACING LINE'),
      stat(`+${score.control.toLocaleString()}`, 'BRAKING'),
      stat(`+${score.airtime.toLocaleString()}`, 'AIRTIME AND LANDING'),
      stat(`+${score.missions.toLocaleString()}`, 'MISSION COMPLETION'),
      stat(`+${score.drift.toLocaleString()}`, 'DRIFTING'),
      stat(`-${score.collisionPenalties.toLocaleString()}`, 'COLLISION PENALTIES'),
      stat(`-${score.missedGatePenalties.toLocaleString()}`, 'MISSED-GATE PENALTIES'),
    );
    ledger.append(breakdown);
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
    ledger.append(supplies, this.riderLadder());
    screen.append(ledger);
    /*
     * "Ride again" on a daily with nothing left is an offer that cannot be
     * taken, so the button says what it would actually spend.
     */
    const left = this.rankedTicket?.attemptsAllowed && this.rankedTicket.attemptsUsed
      ? this.rankedTicket.attemptsAllowed - this.rankedTicket.attemptsUsed
      : null;
    const rematchLabel = left === null ? 'Ride again'
      : left <= 0 ? 'Free run - no attempts left today'
      : left === 1 ? 'Ride again - 1 attempt left'
      : `Ride again - ${left} attempts left`;
    /*
     * After a ranked run with goes remaining, this spends one.
     *
     * It used to call startRun with no ticket, which is a free run - so a
     * button offering another attempt would have handed back an unranked ride.
     * With nothing left it stays a free run, and says so.
     */
    const rematch = button(rematchLabel, 'blitz-start blitz-rematch', () => {
      if (left === null || left <= 0) { void this.startRun(state.cityId); return; }
      void this.rideAnotherAttempt(state.cityId, rematch, rematchLabel);
    });
    const resultActions = node('nav', 'blitz-result-actions');
    resultActions.setAttribute('aria-label', 'Result actions');
    /*
     * Ride again, or leave.
     *
     * The only way off this screen was to start another run, which is fine
     * when a rider wants one and a trap when they want the daily challenge, a
     * lobby, or to stop. Every screen needs a door.
     */
    resultActions.append(
      rematch,
      button('Menu', 'blitz-again blitz-result-home', () => this.renderIntro()),
      this.soundControl(),
      createNimiqPoweredBy(),
    );
    screen.append(resultActions);
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
    competition.append(node('summary', 'blitz-competition-summary', this.rankedTicket ? 'RANKED RUN STATUS' : 'LEADERBOARD'));
    /*
     * A rider who is already connected is not asked to connect again.
     *
     * This screen only ever knew two states: mid-verification, or a stranger.
     * So finishing a free run with a bound wallet and a chosen name put up a
     * blank username box, a line telling you to connect once, and a button
     * saying connect - to somebody who had connected, named themselves, and
     * just ridden. Three pieces of furniture, all of them wrong, at the exact
     * moment the app should be saying "go again, for a rank this time".
     */
    const alreadyConnected = Boolean(this.connectedWallet);
    const rankStatus = node('p', 'blitz-rank-status', this.rankedTicket
      ? 'VERIFYING THIS RANKED RUN...'
      : alreadyConnected ? '' : 'CONNECT ONCE TO START A VERIFIED RUN. NO PAYMENT.');
    competition.append(rankStatus);
    if (this.rankedTicket) {
      void this.submitRankedRun(state, rankStatus, competition);
    } else {
      const username = node('input', 'blitz-username');
      username.type = 'text';
      username.inputMode = 'text';
      username.autocomplete = 'username';
      username.maxLength = 18;
      username.placeholder = 'Leaderboard username';
      username.setAttribute('aria-label', 'Leaderboard username');
      try { username.value = localStorage.getItem('nim-atlas:blitz:username') ?? ''; } catch { /* Storage is optional. */ }
      // The name is already chosen and bound to the wallet; asking for it again
      // on the way into a second run is the same friction the home panel drops.
      username.hidden = alreadyConnected && /^[A-Za-z0-9_]{3,18}$/.test(username.value);
      const identity = button(
        alreadyConnected ? "Ride today's challenge" : 'CONNECT WALLET TO RIDE RANKED',
        'blitz-verify',
        () => void this.prepareRankedRun(state.cityId, username, identity, rankStatus),
      );
      competition.append(username, identity);
      void this.loadLeaderboard(state.cityId, competition);
    }
    screen.append(competition);
    const otherCourses = node('details', 'blitz-competition');
    otherCourses.append(node('summary', 'blitz-competition-summary', 'OTHER CIRCUITS'), reveal);
    screen.append(otherCourses);
    this.ui.append(screen);
  }

  /*
   * Every badge, earned ones lit. The unearned ones stay on the card with what
   * they ask for, because a badge you can see and do not have is the reason to
   * take the next run.
   */
  private resultBadges(state: BlitzRunState): HTMLElement {
    const earned = new Set(blitzRunBadges(state));
    const host = node('section', 'blitz-badges');
    host.setAttribute('aria-label', 'Badges this run');
    const heading = node('div', 'blitz-contracts-heading');
    heading.append(node('span', '', 'BADGES'), node('strong', 'blitz-contracts-count', `${earned.size}/${BLITZ_BADGES.length}`));
    const list = node('ul', 'blitz-badge-list');
    for (const badge of BLITZ_BADGES) {
      const got = earned.has(badge.id);
      const item = node('li', got ? 'blitz-badge is-earned' : 'blitz-badge');
      item.setAttribute('aria-label', `${badge.label}: ${got ? 'earned' : badge.ask}`);
      item.append(node('strong', 'blitz-badge-name', badge.label), node('span', 'blitz-badge-ask', got ? 'EARNED' : badge.ask));
      list.append(item);
    }
    host.append(heading, list);
    return host;
  }

  private resultContracts(state: BlitzRunState): HTMLElement {
    const completed = state.missions.filter((mission) => mission.status === 'complete').length;
    const host = node('section', 'blitz-contracts');
    host.setAttribute('aria-label', 'Daily descent contracts');
    const heading = node('div', 'blitz-contracts-heading');
    heading.append(node('span', '', 'CONTRACTS CLEARED'), node('strong', 'blitz-contracts-count', `${completed}/3`));
    const list = node('ol', 'blitz-contract-list');
    for (const [index, mission] of state.missions.entries()) {
      const resultContractStatus = mission.status === 'complete' ? 'CLEARED' : mission.status === 'failed' ? 'MISSED' : 'OPEN';
      const item = node('li', `blitz-contract blitz-contract-${mission.status}`);
      if (mission.status === 'complete') item.classList.add('is-complete');
      if (mission.status === 'failed') item.classList.add('is-failed');
      item.setAttribute('aria-label', `${mission.label}: ${resultContractStatus}`);
      item.append(
        node('span', 'blitz-contract-index', String(index + 1).padStart(2, '0')),
        node('strong', 'blitz-contract-name', mission.label),
        node('span', 'blitz-contract-state', resultContractStatus),
      );
      list.append(item);
    }
    host.append(heading, list);
    return host;
  }

  /**
   * Spend one of the day's remaining attempts, using the name already bound.
   *
   * The two existing ranked paths both take a username input and validate it,
   * which the result screen has no reason to show: the rider named themselves
   * before their first run and the ticket carries it.
   */
  private async rideAnotherAttempt(cityId: BlitzCityId, trigger: HTMLButtonElement, label: string): Promise<void> {
    const username = this.rankedTicket?.username;
    if (!username) { await this.startRun(cityId); return; }
    trigger.disabled = true;
    trigger.textContent = 'OPENING NIMIQ WALLET...';
    try {
      const ticket = await this.issueRankedTicket(cityId, username);
      await this.startRun(cityId, ticket.value);
    } catch (error) {
      // Put the button back the way it was: a failed attempt must not look
      // like a spent one.
      trigger.disabled = false;
      trigger.textContent = label;
      if (this.feedbackNode) {
        this.feedbackNode.textContent = error instanceof Error ? error.message.toUpperCase() : 'RANKED MODE IS UNAVAILABLE.';
        this.feedbackNode.className = 'blitz-feedback is-wrong';
      }
    }
  }

  private async prepareRankedStart(cityId: BlitzCityId, usernameInput: HTMLInputElement, buttonNode: HTMLButtonElement, status: HTMLElement): Promise<void> {
    const username = usernameInput.value.trim();
    if (!/^[A-Za-z0-9_]{3,18}$/.test(username)) {
      status.textContent = 'USE 3–18 LETTERS, NUMBERS, OR UNDERSCORES.';
      return;
    }
    buttonNode.disabled = true;
    status.textContent = 'OPENING NIMIQ WALLET TO SIGN YOUR IDENTITY.';
    try {
      const ticket = await this.issueRankedTicket(cityId, username);
      try { localStorage.setItem('nim-atlas:blitz:username', username); } catch { /* Storage is optional. */ }
      status.textContent = 'IDENTITY VERIFIED. LOADING THE RANKED SEED...';
      await this.startRun(cityId, ticket.value);
    } catch (error) {
      status.textContent = error instanceof Error ? error.message.toUpperCase() : 'RANKED MODE IS UNAVAILABLE.';
      buttonNode.disabled = false;
      /*
       * A name is one per wallet per season, so somebody else can already have
       * the one you picked. That is the single failure a rider can fix from
       * this screen, so the field comes back open rather than leaving them
       * reading a refusal with nothing to act on.
       */
      if (error instanceof Error && /name/i.test(error.message)) this.reopenNameField(usernameInput);
    }
  }

  /** Put the name back in front of a rider who has to change it. */
  private reopenNameField(usernameInput: HTMLInputElement): void {
    const settled = usernameInput.parentElement?.querySelector('.blitz-name-settled');
    if (settled instanceof HTMLElement) settled.hidden = true;
    usernameInput.hidden = false;
    usernameInput.focus();
    usernameInput.select();
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

  /**
   * Connect once, then ride.
   *
   * Separated from the ranked ticket because a rider should be able to get
   * into the game - and into practice - without also committing to a scored
   * run. The signature proves who they are and moves nothing.
   */
  /**
   * The lobby this link points at, if any.
   *
   * Read from the address rather than from state, because an invite arrives
   * cold: the rider following it has no session, may never have opened the
   * game, and the link is the only thing that knows where they are going.
   */
  private invitedLobbyId(): string | null {
    try {
      const id = new URLSearchParams(window.location.search).get('lobby');
      // Same shape the server accepts. A malformed id is somebody's mistyped
      // message, not a lobby, and following it would only produce a 400.
      return id && /^[A-Za-z0-9_-]{16,64}$/.test(id) ? id : null;
    } catch { return null; }
  }

  /**
   * Show a lobby: the field, the empty seats, and the way in.
   *
   * Reloaded from the server on every visit rather than cached, because the
   * whole point of the screen is who has turned up since last time.
   */
  private async renderLobby(lobbyId: string): Promise<void> {
    this.setAudioScene('menu');
    this.input.clearBindings();
    const view = await this.api.getBlitzLobby(lobbyId);
    if (!view) {
      // A stale or mistyped invite is an ordinary thing to follow. Say so and
      // put the rider back on the front door rather than leaving a blank page.
      this.renderIntro();
      return;
    }
    this.ui.replaceChildren();
    const screen = createBlitzLobbyScreen({
      view,
      you: this.connectedWallet,
      onJoin: () => void this.joinLobby(lobbyId),
      onRide: () => void this.startRun('lagos', null, {
        seed: getBlitzDailyChallenge({ now: Date.now(), cityId: 'lagos', seasonId: BLITZ_SEASON }).seed,
      }),
      onLeave: () => { this.clearInvite(); this.renderIntro(); },
    });
    this.ui.append(screen.element);
  }

  /** Take a seat, then show the lobby again with yourself in it. */
  private async joinLobby(lobbyId: string): Promise<void> {
    if (!this.connectedWallet) { this.renderIntro(); return; }
    const credential = await getOrCreateCredential();
    await this.api.claimBlitzSeat(lobbyId, { actorId: credential.playerId, walletAddress: this.connectedWallet });
    // Re-read rather than trusting the claim's own copy: somebody else may
    // have taken a seat in the same second, and the field should show it.
    await this.renderLobby(lobbyId);
  }

  /** Open a lobby and land the host in it, seated. */
  private async openLobby(action: HTMLButtonElement, status: HTMLElement): Promise<void> {
    if (!this.connectedWallet) return;
    action.disabled = true;
    status.textContent = 'Opening a lobby.';
    try {
      const credential = await getOrCreateCredential();
      const opened = await this.api.openBlitzLobby({ actorId: credential.playerId, walletAddress: this.connectedWallet, capacity: 7 });
      if (!opened.ok) throw new Error(opened.error);
      // The host takes seat one by opening it. A lobby whose creator has to
      // remember to join is a lobby that starts with an empty first seat.
      await this.joinLobby(opened.value.id);
    } catch (error) {
      action.disabled = false;
      status.textContent = error instanceof Error ? error.message : 'A lobby could not be opened.';
    }
  }

  /** Drop the invite from the address so a reload does not re-enter it. */
  /** Point somebody at Nimiq Pay, carrying their invite with them. */
  private renderNimiqRequired(): void {
    this.input.clearBindings();
    this.ui.replaceChildren();
    this.ui.append(createBlitzNimiqRequired({
      lobbyId: this.invitedLobbyId(),
      onBack: () => this.renderIntro(),
    }));
  }

  private clearInvite(): void {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete('lobby');
      window.history.replaceState({}, '', url.toString());
    } catch { /* Without history the invite simply stays in the address. */ }
  }

  private async connectWallet(action: HTMLButtonElement, status: HTMLElement): Promise<void> {
    action.disabled = true;
    status.textContent = 'Opening Nimiq for an identity signature.';
    try {
      const initialized = await this.wallet.initialize();
      if (!initialized.ok) {
        /*
         * Not an error to report in a status line. A rider who followed an
         * invite in their chat app's browser has done nothing wrong and needs
         * the app, not a message saying the wallet is unavailable.
         */
        if (initialized.reason !== 'timeout') { this.renderNimiqRequired(); return; }
        throw new Error('Nimiq took too long. Try again.');
      }
      const credential = await getOrCreateCredential();
      const binding = await this.walletBinding.bind({ actorId: credential.playerId, seasonId: BLITZ_SEASON, network: 'testalbatross' });
      if (!binding.ok) throw new Error(binding.error);
      try { localStorage.setItem('nim-atlas:blitz:wallet', binding.value.address); } catch { /* Storage is optional. */ }
      this.connectedWallet = binding.value.address;
      const invited = this.invitedLobbyId();
      if (invited) { void this.renderLobby(invited); return; }
      this.renderIntro();
    } catch (error) {
      action.disabled = false;
      status.textContent = error instanceof Error ? error.message : 'Nimiq could not be reached.';
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
      host.append(node('span', 'blitz-pool-label', "TODAY'S POOL ON NIMIQ MAINNET"));

      if (table.state === 'unfunded' || table.poolLuna === null || table.poolLuna === 0) {
        host.append(node('strong', 'blitz-pool-value', 'No sponsored pool today'));
        host.append(node('p', 'blitz-pool-note', 'The board still counts. A verified run sets your rank whether or not a pool is funded.'));
        host.hidden = false;
        return;
      }

      host.append(node('strong', 'blitz-pool-value', formatNim(table.poolLuna)));
      /*
       * A number and a standing, and nothing else.
       *
       * This panel used to carry the split, a sentence about first place being
       * open, a count of unclaimed places and a line about chain settlement -
       * four explanations stacked under one figure. A rider deciding whether
       * to ride needs the size of the prize and who is on it; the arithmetic
       * and the settlement rule are in the rules document, where somebody who
       * wants them can read them once instead of every day.
       */
      if (table.qualifiedRiders < BLITZ_MINIMUM_FIELD) {
        /*
         * Nobody has ridden. There is no standing to show and no shortfall to
         * explain, so the pool says the pot is there and open.
         */
        host.append(node('p', 'blitz-pool-note', 'Nobody has ridden today. First run takes the board.'));
      } else if (table.allocations.length === 0) {
        host.append(node('p', 'blitz-pool-note', 'First place open.'));
      } else {
        const standings = node('ol', 'blitz-pool-standings');
        for (const entry of table.allocations.slice(0, 3)) {
          const row = node('li', 'blitz-pool-place');
          row.append(node('b', '', `#${entry.rank}`), node('span', '', shortWallet(entry.walletAddress)), node('strong', '', formatNim(entry.luna)));
          standings.append(row);
        }
        host.append(standings);
      }

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
  /*
   * The day streak, from the server's verified rows. When today is not ridden
   * yet the streak is still alive, and saying so is the whole point: it is the
   * moment the number is worth something.
   */
  private async presentProgress(host: HTMLElement): Promise<void> {
    const walletAddress = this.rememberedWallet();
    if (!walletAddress) return;
    try {
      const progress = await this.api.getBlitzProgress(BLITZ_SEASON, walletAddress);
      if (progress.daysRidden === 0) return;
      const days = `${progress.daysRidden} DAY${progress.daysRidden === 1 ? '' : 'S'} RIDDEN`;
      host.textContent = progress.dayStreak > 0
        ? `${progress.dayStreak}-DAY STREAK${progress.riddenToday ? '' : ' · RIDE TODAY TO KEEP IT'}`
        : days;
      host.title = `${days} · best ${progress.bestScore.toLocaleString()}`;
      host.classList.toggle('is-at-risk', progress.dayStreak > 0 && !progress.riddenToday);
      host.hidden = false;
    } catch {
      // A record that cannot be read is left off, not shown as zero.
    }
  }

  private async presentRewards(host: HTMLElement): Promise<void> {
    const walletAddress = this.rememberedWallet();
    // Nothing to ask about. A rider who has never ranked has no receipts, and
    // an empty panel would only be noise on the screen where they just rode.
    if (!walletAddress) return;
    try {
      const receipts = await this.api.getBlitzRewards(walletAddress);
      if (receipts.length === 0) return;

      host.replaceChildren();
      host.append(node('span', 'blitz-rewards-label', `REWARDS FOR ${shortWallet(walletAddress)}`));
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
      /*
       * Written down before it is sent, and the answer is read.
       *
       * The run is ninety to a hundred and twenty seconds of somebody's
       * attention. If the network is out, or the app is closed on the result
       * screen, the trace has to survive - that is what the recovery panel
       * exists for. save() returns false when the record will not fit, and
       * that boolean used to be discarded, so a run too large to store was
       * dropped in silence and the rider was told nothing.
       */
      if (!this.pendingRunStore.save(pending)) {
        status.textContent = 'THIS RUN IS TOO LARGE TO SAVE LOCALLY. SENDING IT NOW - KEEP THIS SCREEN OPEN.';
      }
      await this.submitPendingRun(pending, status, host);
    } catch (error) {
      status.textContent = error instanceof Error ? `NOT VERIFIED. ${error.message.toUpperCase()}` : 'THIS RUN COULD NOT BE VERIFIED.';
    }
  }

  private async submitPendingRun(pending: BlitzPendingSubmission, status: HTMLElement, host: HTMLElement): Promise<void> {
    status.textContent = 'VERIFYING YOUR RUN. KEEP THIS SCREEN OPEN.';
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
      status.textContent = `VERIFIED. RANK ${result.value.row.rank} FOR ${ticket.username}.`;
      this.offerAnchor(host, result.value.row);
    } catch (error) {
      status.textContent = error instanceof Error ? `NOT VERIFIED. ${error.message.toUpperCase()}` : 'THIS RUN COULD NOT BE VERIFIED.';
      host.querySelector('.blitz-retry-submit')?.remove();
      host.append(button('Retry verification', 'blitz-retry-submit', () => {
        const retry = host.querySelector('.blitz-retry-submit');
        if (retry instanceof HTMLButtonElement) retry.disabled = true;
        void this.submitPendingRun(pending, status, host);
      }));
    }
    await this.loadLeaderboard(pending.ticket.cityId, host, pending.ticket.challengeId);
  }


  /*
   * The offer to make a run permanent.
   *
   * Only ever shown on a run the server has already verified, because there is
   * nothing worth writing onto a chain about a result nobody checked. It is a
   * real transaction on mainnet costing a real fee, so it is a rider's choice
   * and never automatic, and the copy says what it buys rather than what it
   * costs: the board can be switched off, an explorer entry cannot.
   */
  private offerAnchor(host: HTMLElement, row: BlitzLeaderboardRow): void {
    host.querySelector('.blitz-anchor')?.remove();
    host.querySelector('.blitz-anchor-note')?.remove();
    if (row.anchorHash) { host.append(this.anchorReceipt(row.anchorHash)); return; }
    if (!anchorAddress()) return;

    const note = node('p', 'blitz-anchor-note', '');
    /*
     * "Write this run onto Nimiq" described the mechanism, not the point, and
     * a rider reading it on a result screen has no idea whether it is a thing
     * they need to do or a thing that has already happened. The run is already
     * verified by the time this appears; what this buys is permanence.
     */
    const action = button('Save this score on Nimiq forever', 'blitz-again blitz-anchor', () => {
      action.disabled = true;
      note.textContent = 'OPENING NIMIQ PAY. THIS SENDS A TRANSACTION.';
      void (async () => {
        const sent = await anchorRun(blitzAnchorData({
          challengeDate: row.challengeDate, cityId: row.cityId, score: row.score, traceHash: row.traceHash,
        }));
        if (!sent.ok) { note.textContent = sent.reason.toUpperCase(); action.disabled = false; return; }
        try {
          const receipt = await this.api.anchorBlitzRun(row.runId, sent.serializedTx);
          action.remove();
          note.replaceWith(this.anchorReceipt(receipt.hash));
        } catch (error) {
          // The transaction is on chain either way; only our record of it failed.
          note.textContent = error instanceof Error
            ? `SENT, BUT NOT RECORDED. ${error.message.toUpperCase()}`
            : 'SENT, BUT NOT RECORDED.';
          action.disabled = false;
        }
      })();
    });
    host.append(action, note);
  }

  /** The finished thing: a hash anybody can check without trusting us. */
  private anchorReceipt(hash: string): HTMLElement {
    const wrap = node('p', 'blitz-anchor-note');
    wrap.append(node('span', '', 'ON CHAIN '));
    const link = document.createElement('a');
    link.className = 'blitz-anchor-link';
    link.href = `https://nimiq.watch/#${hash}`;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = `${hash.slice(0, 10)}…`;
    wrap.append(link);
    return wrap;
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
  /*
   * The three nearest riders, nearest first.
   *
   * Rebuilt only when the set of names changes; the numbers are written in
   * place. This runs every frame, and replacing three rows thirty times a
   * second to show the same three names is how a HUD starts costing more than
   * the city does.
   */
  /**
   * The pack minus whoever you have put out.
   *
   * A rider you took down has to leave the gap list, the place count and the
   * scene together. Reading it from run state rather than from a field on this
   * class keeps it identical to what the server computes when it replays the
   * trace, because it is the same list.
   */
  private liveRivals(state: BlitzRunState): readonly BlitzRivalPath[] {
    if (state.downedRivals.length === 0) return this.rivals;
    const down = new Set(state.downedRivals);
    return this.rivals.filter((rival) => !down.has(rival.runId));
  }

  private updateGapHud(state: BlitzRunState): void {
    const host = this.gapHost;
    if (!host || this.rivals.length === 0) return;
    const live = this.liveRivals(state);
    const gaps = blitzRivalGaps({
      rivals: live,
      tick: state.tick,
      distanceMeters: state.distanceMeters,
      speedMps: state.speedMps,
    }).slice(0, 3);
    /*
     * Your place in the field, before the gaps.
     *
     * The gap list says who is near. It does not say whether you are winning,
     * and that is the number a rider is actually racing - so it goes first and
     * stays up even when nobody is close enough to have a gap worth printing.
     */
    const position = blitzFieldPosition({ rivals: live, tick: state.tick, distanceMeters: state.distanceMeters });
    host.hidden = false;
    let place = host.querySelector('.blitz-place');
    if (!place) {
      place = node('div', 'blitz-place');
      place.append(node('strong', 'blitz-place-value', ''), node('span', 'blitz-place-field', ''));
      host.prepend(place);
    }
    const placeValue = place.querySelector('.blitz-place-value');
    const placeField = place.querySelector('.blitz-place-field');
    if (placeValue) placeValue.textContent = String(position.place);
    if (placeField) placeField.textContent = `OF ${position.field}`;
    place.classList.toggle('is-leading', position.place === 1);
    if (gaps.length === 0) return;
    const signature = gaps.map((gap) => gap.runId).join('|');
    if (host.dataset.signature !== signature) {
      host.dataset.signature = signature;
      for (const row of [...host.querySelectorAll('.blitz-gap')]) row.remove();
      for (const gap of gaps) {
        const row = node('div', 'blitz-gap');
        row.dataset.runId = gap.runId;
        row.append(node('span', 'blitz-gap-name', gap.username), node('strong', 'blitz-gap-time', ''));
        host.append(row);
      }
    }
    [...host.querySelectorAll('.blitz-gap')].forEach((row, index) => {
      const gap = gaps[index];
      if (!gap) return;
      const time = row.querySelector('.blitz-gap-time');
      // Ahead reads as a target to chase, behind as a lead to defend.
      const ahead = gap.metres > 0;
      row.classList.toggle('is-ahead', ahead);
      if (time) time.textContent = gap.seconds === null ? '--' : `${ahead ? '+' : '-'}${Math.abs(gap.seconds).toFixed(1)}`;
    });
  }

  /*
   * A key you cannot use is not on the screen.
   *
   * Boost needs enough in the tank to engage and drift needs a gearbox; with
   * neither, both buttons were still sitting over the trail doing nothing. The
   * boost latch is also put out here rather than by the rider, because running
   * the tank dry is the one way to stop boosting that is not a tap.
   */
  private updateNimCount(state: BlitzRunState): void {
    if (this.nimNode && this.nimNode.textContent !== String(state.tokensTaken)) {
      this.nimNode.textContent = String(state.tokensTaken);
      // A short pulse on the tick it changes: enough to catch the eye without
      // asking a rider to look away from the trail.
      this.nimNode.classList.remove('is-banked');
      void this.nimNode.offsetWidth;
      this.nimNode.classList.add('is-banked');
    }
  }

  /** The streak and the sector, on V6 runs only. */
  private updateArcHud(state: BlitzRunState): void {
    const features = blitzRuleFeatures(state.seed);
    if (this.comboNode) {
      const show = features.trailCombo && state.trailStreak > 0;
      this.comboNode.hidden = !show;
      if (show) {
        const multiplier = blitzComboMultiplier(state.trailStreak);
        const text = `x${multiplier} · ${state.trailStreak} IN A ROW`;
        if (this.comboNode.textContent !== text) this.comboNode.textContent = text;
        this.comboNode.classList.toggle('is-hot', multiplier > 1);
      }
    }
    if (this.sectorNode && features.sectors && state.phase === 'running' && state.sector !== this.shownSector) {
      this.shownSector = state.sector;
      const sector = BLITZ_SECTORS[state.sector]!;
      this.sectorNode.textContent = `SECTOR ${state.sector + 1} · ${sector.label}`;
      this.sectorNode.hidden = false;
      // Restart the fade, so each sector gets its own moment.
      this.sectorNode.classList.remove('is-showing');
      void this.sectorNode.offsetWidth;
      this.sectorNode.classList.add('is-showing');
    }
  }

  /*
   * What the hill is about to ask for.
   *
   * The complaint this answers is "the game seems to be playing itself". Part
   * of that was steering that went the wrong way, and part of it is that a
   * rider could not see their own decisions arriving: a corner reads as
   * scenery until it is throwing you wide.
   *
   * The ask is computed from the same two numbers the simulation uses for
   * corner push - the bend of the road ahead and the square of the speed ratio
   * - so it can never advise something the physics disagrees with. Measured
   * over a full run on all three cities, 0.030 sits around the 85th percentile
   * on the two twisty courses and is rarely reached on the straight one, which
   * is what a prompt tied to the road should do.
   */
  private updateCoach(state: BlitzRunState): void {
    const pad = this.postureNode;
    if (!pad) return;
    // A rider already on the pad is not told what to do.
    if (state.phase !== 'running' || pad.classList.contains('is-tucking') || pad.classList.contains('is-braking')) {
      this.setCoach(null);
      return;
    }
    const city = blitzCity(state.cityId);
    const lookahead = Math.max(18, state.speedMps * 1.1);
    const ahead = sampleBlitzRoute(state.cityId, Math.min(city.lengthMeters, state.distanceMeters + lookahead));
    const load = Math.abs(ahead.bend) * (state.speedMps / city.baseSpeedMps) ** 2;
    this.setCoach(load >= 0.03 ? 'brake' : load <= 0.01 ? 'tuck' : this.coachAsk);
  }

  /** One prompt at a time, and never faster than a rider can read it. */
  private setCoach(ask: 'tuck' | 'brake' | null): void {
    if (ask === this.coachAsk) return;
    const now = performance.now();
    if (ask !== null && now - this.coachAskedAt < 800) return;
    this.coachAsk = ask;
    this.coachAskedAt = now;
    if (this.postureCoachNode) this.postureCoachNode.textContent = ask === 'brake' ? 'BRAKE' : ask === 'tuck' ? 'TUCK' : '';
    this.postureNode?.classList.toggle('is-asking-brake', ask === 'brake');
    this.postureNode?.classList.toggle('is-asking-tuck', ask === 'tuck');
  }

  /*
   * A key is lit when it can be spent and ghosted when it cannot - but it
   * keeps its slot either way. Removing it collapsed the row and moved the
   * posture pad under the rider's thumb mid-run, every time a bottle was
   * taken or spent.
   */
  private updateSpendKeys(state: BlitzRunState): void {
    if (this.boostKey) {
      const usable = state.boostEnergy >= BOOST_ENGAGE_ENERGY;
      this.boostKey.classList.toggle('is-ready', usable);
      this.boostKey.setAttribute('aria-disabled', String(!usable));
      if (!usable) this.input.setLatch('boost', false, this.boostKey);
    }
    if (this.driftKey) {
      const usable = state.driftCharges > 0;
      this.driftKey.classList.toggle('is-ready', usable);
      this.driftKey.setAttribute('aria-disabled', String(!usable));
    }
  }

  private updateSupplyHud(state: BlitzRunState): void {
    this.updateSpendKeys(state);
    this.updateNimCount(state);
    this.updateArcHud(state);
    this.updateCoach(state);
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
    host.append(node('span', 'blitz-ladder-label', `RIDER LEVEL ${level.level}, ${level.title.toUpperCase()}`));
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
    const screen = node('main', 'blitz-unavailable blitz-fullscreen-page');
    screen.append(createRushLogo('compact'), node('h1', '', 'BIKE IS IN THE SHOP'), node('p', '', 'This device could not start the 3D circuit. Reload once, or use a WebGL-capable browser.'));
    screen.append(button('Reload', 'blitz-start', () => location.reload()));
    screen.append(createNimiqPoweredBy());
    this.ui.append(screen);
  }

  private visibilityChanged = (): void => {
    if (document.hidden && this.audioScene !== 'menu') {
      this.paused = true;
      this.previousTimestamp = null;
      this.accumulator = 0;
      this.input.reset();
      this.setAudioScene('paused');
      if (this.pauseButton) { this.pauseButton.textContent = '▶'; this.pauseButton.setAttribute('aria-label', 'Resume Beacon Blitz'); }
      if (this.pauseOverlay) {
        this.pauseOverlay.hidden = false;
        const copy = this.pauseOverlay.querySelector('.blitz-pause-copy');
        if (copy) copy.textContent = 'The course is paused. Resume when the trail is clear.';
      }
      if (this.feedbackNode) { this.feedbackNode.textContent = 'PAUSED. YOUR RUN IS SAFE.'; this.feedbackNode.className = 'blitz-feedback is-paused'; }
    } else if (!document.hidden && this.paused && this.rankedTicket && this.state && this.state.phase === 'running') {
      /*
       * Coming back resumes a ranked run.
       *
       * A ranked run refuses the pause button on purpose, so without this it
       * had no way back: hiding the screen for an instant left it paused
       * forever with the only control that could unpause it disabled.
       */
      this.paused = false;
      this.previousTimestamp = null;
      this.accumulator = 0;
      this.frameGovernor.reset();
      this.input.reset();
      this.setAudioScene('riding');
      if (this.pauseOverlay) this.pauseOverlay.hidden = true;
      if (this.pauseButton) { this.pauseButton.textContent = 'LIVE'; this.pauseButton.setAttribute('aria-label', 'A ranked run cannot be paused'); }
      if (this.feedbackNode) { this.feedbackNode.textContent = ''; this.feedbackNode.className = 'blitz-feedback'; }
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

  /*
   * Size the picture to the box it is actually drawn in.
   *
   * The stylesheet gives the stage `visualViewport.height`, and this asked the
   * renderer for `window.innerHeight`. On a desktop those are the same number
   * and nothing looked wrong. On iOS they are not: innerHeight counts the strip
   * under Safari's toolbar that nobody can see, so the camera was set up for a
   * taller frame than the one on screen and the bottom of the world was drawn
   * into space the page had already given to the controls - which is the pale
   * band along the bottom of the run.
   *
   * visualViewport is the honest number where it exists, and innerHeight is
   * the right fallback where it does not.
   */
  private resize = (): void => {
    const viewport = window.visualViewport;
    const width = Math.ceil(viewport?.width ?? window.innerWidth);
    const height = Math.ceil(viewport?.height ?? window.innerHeight);
    this.renderer.resize(width, height, Math.min(devicePixelRatio, 1.25));
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

/*
 * One line of the score.
 *
 * A run that earns nothing in four of six categories used to print four large
 * +0s at the same weight as the points actually scored, which buries the one
 * number a rider came to read. A zero is still shown - it is information, and
 * hiding it would make the ledger look incomplete - but it is dimmed, so the
 * eye lands on what the run was worth.
 */
function stat(value: string, label: string): HTMLElement {
  const item = node('div', 'blitz-stat');
  if (/^[+-]?0$/.test(value.replace(/,/g, ''))) item.dataset.empty = 'true';
  item.append(node('strong', '', value), node('span', '', label));
  return item;
}

/**
 * A prize, in the unit a rider thinks in.
 *
 * Luna is the integer unit the chain and the ledger use - 1 NIM is 100,000 of
 * them - and this used to print both, because when the pot was a fraction of a
 * NIM a bare NIM figure rounded the real amount away to nothing.
 *
 * At a funded pool that stopped being true: "2,000 NIM" is exact, and
 * "200,000,000 Luna (2,000 NIM)" asks a rider to do arithmetic to find out
 * what they won. Luna stays everywhere it matters - the config, the ledger,
 * the receipts, every amount the server reasons about - and leaves the screen.
 *
 * Fractions are still shown when there are any, so a share that does not divide
 * evenly is never rounded into a number the treasury will not pay.
 */
function formatNim(luna: number): string {
  return `${(luna / 100_000).toLocaleString('en-US', { maximumFractionDigits: 5 })} NIM`;
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
  owed: 'OWED, AWAITING RELEASE',
  sending: 'SENDING',
  paid: 'PAID',
  attention: 'HELD, NEEDS A LOOK',
};

/*
 * A payout period is `blitz-<season>-<city>-<date>`, and the date is the part a
 * rider recognises. Anything that does not end in a date falls back to the raw
 * period rather than guessing at a prettier lie.
 */
function rewardDayLabel(period: string): string {
  const match = /(\d{4}-\d{2}-\d{2})$/.exec(period);
  return match ? match[1]! : period;
}

function shortWallet(address: string): string {
  const compact = address.replace(/\s/g, '');
  return compact.length <= 12 ? compact : `${compact.slice(0, 6)}…${compact.slice(-4)}`;
}
