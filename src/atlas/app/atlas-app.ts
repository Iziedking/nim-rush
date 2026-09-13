import { createNimiqMark } from '../ui/nimiq-mark';
import { createAtlasCrest, createNimiqPoweredBy } from '../ui/atlas-mark';
import { createAtlasState } from '../../../shared/atlas/state';
import { BEACON_SEALS, createRouteRun, recoverRouteRun, routeLesson, routeProgress, routeRestoration, routeTarget, routeWorld, stepRouteRun, type RouteAction, type RouteRun } from '../../../shared/atlas/adventures/route-rescue';
import { createEvidenceChoices, createRouteCard } from '../ui/route-rescue';
import { createAtlasUsageReporter } from '../usage';
import { atlasFreePlayComplete } from '../../../shared/atlas/city/onboarding';
import { AtlasRuntimeStats } from '../city/runtime-stats';
import { projectLivingWorld } from '../../../shared/atlas/living-world';
import { AtlasCameraLookController, AtlasInputController, installAtlasKeyboard, shouldHandleDirectionalClick, type AtlasDirection } from '../input';
import { createAtlasProgressStore } from '../progress';
import { AtlasRenderer } from '../render/renderer';
import { createIdleOrbit } from '../render/three/orbit';
import { ATLAS_GUIDE_REACH_METRES, createAtlasTutorial, type AtlasTutorialDirector } from '../tutorial';
import { AtlasConversationController, type AtlasConversationDisplay } from '../conversations/conversation-controller';
import { dialogueSheet, type DialogueOptions } from '../ui/shell/dialogue';
import { harborInvoiceLesson } from '../conversations/harbor-invoice';
import { isPortraitNow, rotateGate, shouldGateForLandscape, watchOrientation } from '../ui/shell/rotate-gate';
import { ATLAS_PROLOGUE } from '../../../shared/atlas/prologue';
import type { AtlasRole } from '../../../shared/atlas/types';
import type { AtlasAction } from '../../../shared/atlas/state';
import { LAST_LANTERN, createLastLanternState, recoverLastLanternState, replayLastLantern, serializeLastLanternState, type LastLanternAction, type LastLanternState } from '../../../shared/atlas/adventures/last-lantern';
import { ATLAS_LANTERN_PRICE_NIM, ATLAS_LUNAS_PER_NIM } from '../../../shared/atlas/economy';
import { ATLAS_KNOWLEDGE_BOOK, createKnowledgeBookState, gradeKnowledgeTeachBack, unlockKnowledgeFragment, type KnowledgeBookState } from '../../../shared/atlas/knowledge';
import { ATLAS_EVERGREEN_ADVENTURES, replayEvergreenAdventure, type EvergreenAction, type EvergreenAdventure, type EvergreenState } from '../../../shared/atlas/adventures/evergreen';
import { ATLAS_MAINNET_SHOP_ITEMS } from '../../../shared/atlas/shop';
import { createAtlasApiClient, type AtlasCompetitionSummary, type AtlasCompetitiveTicket, type AtlasDailyObligationSummary, type AtlasDailyStandingSummary, type AtlasDailySubmitResult } from '../api';
import { createAtlasWalletAdapter } from '../wallet';
import { createAtlasWalletBindingFlow } from '../wallet-binding';
import { getOrCreateCredential } from '../../net/player-credential';
import type { AtlasWalletBinding } from '../../../shared/atlas/wallet-binding';
import { AtlasPaymentController } from './payment-controller';
import { readAtlasClientPaymentConfig } from '../payment-config';
import type { AtlasDailyChallenge } from '../../../shared/atlas/daily';
import { dailyChallengeChoices, dailyRetryHint, evergreenTeachBackChoices, formatDailyChoice, selectDailyChallenge } from '../product-model';
import { createSemanticWorldControl } from '../ui/semantic-world-controls';
import { createAtlasToolkit, type AtlasToolkit } from '../ui/atlas-toolkit';
import { createAtlasAudio } from '../audio/atlas-audio';
import { ATLAS_HOW_TO_PLAY_PATHS, ATLAS_HOW_TO_PLAY_SNAPSHOTS, ATLAS_HOW_TO_PLAY_STEPS, ATLAS_NIMIQ_BRIDGE, ATLAS_PAYMENT_VERBS } from '../ui/how-to-play';
import { createAtlasAssetManager } from '../assets/asset-manager';
import { createAtlasKnowledgeBookView } from '../ui/knowledge-book';
import { createCompetitionView } from '../ui/competition';
import { createAtlasCoreRunController, type AtlasCoreRunView } from './core-run-controller';
import { BEACON_CORE_WORLD } from '../../../shared/atlas/districts/beacon-core-world';
import { parseAtlasAssetManifest } from '../assets/manifest';
import { AtlasLivingCityController, type AtlasLivingCityNavigation } from '../city/living-city-controller';
import { parseAtlasCityScene, type AtlasCitySceneV1 } from '../../../shared/atlas/city/types';
import type { AtlasCityPlayerState } from '../../../shared/atlas/city/player';
import { projectPayHarborPhysicalMission } from '../../../shared/atlas/city/pay-harbor-mission';
import { getAtlasWaypointGuidance } from '../../../shared/atlas/city/wayfinding';
import { createPayHarborScene } from '../scenes/pay-harbor';
import { activeHarborContract, advanceHarborContract, harborContractsForDay, harborContractStars, startHarborContract, type HarborContractProgress } from '../../../shared/atlas/harbor-contracts';
import { ATLAS_STORY, ATLAS_STORY_CHAPTERS, getAtlasStoryChapter, selectAtlasHubDispatch } from '../../../shared/atlas/story';
import { createHarborContractStore } from '../harbor-contract-store';
import { harborContractDialogue, projectHarborContractMission } from '../ui/harbor-contracts';

/*
 * How long a tap on a directional arrow holds the direction down.
 *
 * The city ramps a walk up from standing, so the old 120 ms pulse ended before
 * the player had gone anywhere: measured at 0.00 m over twenty taps. These
 * arrows are the only way to move for a keyboard or assistive-technology
 * player, so a tap has to be worth a step.
 */
const DIRECTIONAL_TAP_MILLISECONDS = 520;

const BUILDER_REPAIR_STEPS = [
  { title: 'Provider ready', prompt: 'What should initialization do before a wallet action?', answer: 'Return a provider or an honest unavailable state.', choices: ['Return a provider or an honest unavailable state.', 'Request accounts during app boot.'] },
  { title: 'Player intent', prompt: 'When may the route ask for account access?', answer: 'Only after the player chooses the wallet action.', choices: ['Only after the player chooses the wallet action.', 'Whenever the page loads.'] },
  { title: 'Approved accounts', prompt: 'What can the account step return?', answer: 'An approved address list or a clear rejection.', choices: ['An approved address list or a clear rejection.', 'A payment confirmation.'] },
  { title: 'Exact payment', prompt: 'What must the typed request preserve?', answer: 'Testnet, recipient, and integer Lunas.', choices: ['Testnet, recipient, and integer Lunas.', 'A decimal amount and a guessed recipient.'] },
  { title: 'Wallet result', prompt: 'What does the provider result prove?', answer: 'Only a lookup value until chain proof exists.', choices: ['Only a lookup value until chain proof exists.', 'That the item is already fulfilled.'] },
  { title: 'Chain confirmation', prompt: 'When may the route become verified?', answer: 'After canonical evidence reaches the confirmation threshold.', choices: ['After canonical evidence reaches the confirmation threshold.', 'As soon as a hash is returned.'] },
  { title: 'One fulfillment', prompt: 'What should happen after verification?', answer: 'Fulfill the exact order once.', choices: ['Fulfill the exact order once.', 'Create a new item on every retry.'] },
] as const;

export class AtlasApp {
  private harborDialogue: DialogueOptions | null = null;
  private readonly input = new AtlasInputController();
  private readonly renderer: AtlasRenderer;
  private readonly progress = createAtlasProgressStore(safeStorage());
  private readonly contractStore = createHarborContractStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
  });
  private contractProgress = this.contractStore.snapshot();
  private contractMission = projectHarborContractMission(this.contractProgress);
  private readonly paymentConfig = readAtlasClientPaymentConfig();
  private readonly wallet = createAtlasWalletAdapter();
  private readonly api = createAtlasApiClient({ baseUrl: import.meta.env.VITE_API_BASE ?? '' });
  private readonly walletBinding = createAtlasWalletBindingFlow({ api: this.api, wallet: this.wallet });
  private readonly coreRun = createAtlasCoreRunController({ api: this.api });
  private readonly sessionActorId = getAtlasSessionActorId(safeStorage());
  /* Anonymous participation counting. Reuses the session actor id above rather
   * than minting a second identifier; the server hashes it before storing. */
  private readonly usage = createAtlasUsageReporter({ session: this.sessionActorId, apiBase: import.meta.env.VITE_API_BASE ?? '' });
  /*
   * Free play before the game asks anything of you.
   *
   * The mission card used to be on screen before the player had taken a step,
   * and the first thing it pointed at was 3.8 m away, so a play test reported
   * the city as small and the person you talk to as already in front of you.
   * The card now waits until the player has walked a little or a short while
   * has passed, whichever comes first, so the first thing anyone does in Atlas
   * is move around a city that is not yet asking for anything.
   *
   * The time fallback matters: a player who stands still is not stuck, and a
   * gate with no timeout would read as a broken build.
   */
  private freePlayDone = false;
  private freePlayOrigin: { x: number; z: number } | null = null;
  private freePlayStartedAt = 0;
  private selectedRole: AtlasRole = this.progress.load().activeRole;
  private screen: 'welcome' | 'how-to-play' | 'lantern' | 'trial' | 'book' | 'daily' | 'evergreen' | 'core-run' | 'beacon-commons' | 'pay-harbor' = 'welcome';
  private lanternState: LastLanternState = createLastLanternState('explorer', 'practice');
  private suspended = false;
  private builderStep = 0;
  private builderNotice = '';
  private knowledgeState: KnowledgeBookState = createKnowledgeBookState();
  private bookOpen = true;
  private teachBackStep = 0;
  private teachBackNotice = '';
  private dailyNotice = '';
  private dailyCompletedDate: string | null = readDailyCompletedDate();
  /*
   * The daily run's server state.
   *
   * The screen used to say "Reward share appears only after server
   * verification" and then never call the server, so the reward it named could
   * not arrive. `/atlas/api/daily/*` has been live and tested for a while with
   * no client at all; these hold what it answers.
   */
  private dailyStanding: AtlasDailyStandingSummary | null = null;
  private dailyStandingBusy = false;
  private dailySubmitBusy = false;
  private dailyServerResult: AtlasDailySubmitResult | null = null;
  private dailyObligation: AtlasDailyObligationSummary | null = null;
  private evergreenAdventure: EvergreenAdventure = ATLAS_EVERGREEN_ADVENTURES[0]!;
  private evergreenActions: EvergreenAction[] = [];
  private evergreenState: EvergreenState = replayEvergreenAdventure(this.evergreenAdventure, []);
  private evergreenNotice = '';
  private paymentNotice = '';
  private paymentBusy = false;
  private walletBindingBusy = false;
  private walletBindingNotice = '';
  private atlasWalletBinding: AtlasWalletBinding | null = null;
  private atlasCompetitiveTicket: AtlasCompetitiveTicket | null = null;
  private atlasCompetitiveTicketBusy = false;
  private coreRunActorId: string | null = null;
  private coreRunId = createAtlasClientRunId();
  private atlasServiceStatus: 'loading' | 'local-first' | 'unavailable' = 'loading';
  private atlasBeaconStatus: 'loading' | 'live' | 'stale' | 'unavailable' = 'loading';
  private atlasContributorCount = 0;
  private atlasCompetition: AtlasCompetitionSummary[] = [];
  private liveOrderId: string | null = null;
  private liveLookup: string | null = null;
  private paymentController: AtlasPaymentController | null = null;
  private toolkit: AtlasToolkit | null = null;
  private readonly audio = createAtlasAudio();
  private livingCity: AtlasLivingCityController | null = null;
  private livingCityHost: HTMLElement | null = null;
  /* Non-null only while the welcome screen is showing; see screenPanel. */
  private orbitStartedAt: number | null = null;
  private readonly orbit = createIdleOrbit({
    reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  });
  private livingCityInit: Promise<void> | null = null;
  private cityAssets: ReturnType<typeof createAtlasAssetManager> | null = null;
  private beaconScene: AtlasCitySceneV1 | null = null;
  private beaconMapSvg: SVGSVGElement | null = null;
  private beaconMapPlayer: SVGPolygonElement | null = null;
  private beaconMapTarget: SVGCircleElement | null = null;
  private cityWaypointLabel: HTMLElement | null = null;
  private cityWaypointDistance: HTMLElement | null = null;
  private cityPaceLabel: HTMLElement | null = null;
  private cityLoadState: 'loading' | 'ready' | 'unavailable' = 'loading';
  private beaconTravelNotice = '';
  private tutorial: AtlasTutorialDirector = createAtlasTutorial({ completed: readTutorialDone() });
  private tutorialOrigin: { x: number; z: number } | null = null;
  /*
   * Mara's lines existed and nothing ever showed them: the controller that owns
   * conversations was referenced by no other file. Held here so the lantern
   * screen can put the conversation in front of the payment panels, which is
   * where a player expects to be spoken to.
   */
  private readonly conversations = new AtlasConversationController();
  private maraConversation: AtlasConversationDisplay | null = null;
  private stopWatchingOrientation: (() => void) | null = null;
  private readonly directionalTapTimers = new Map<AtlasDirection, number>();
  private cityQuestStep: 'meet-guide' | 'guide-met' = 'meet-guide';
  private routeRun: RouteRun | null = null;
  private routeCard: HTMLElement | null = null;
  private evidenceOpen = false;
  private accessibleMovement = false;
  private cityMuted = false;
  private cityReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  private cameraOverview = false;
  private readonly routeFeed: string[] = [];
  private readonly runtimeStats = new URLSearchParams(location.search).has('stats') ? new AtlasRuntimeStats() : null;
  private payHarborBuilderStation = 0;

  constructor(private readonly ui: HTMLElement, private readonly canvas: HTMLCanvasElement) {
    if (!this.contractProgress.opened && this.progress.load().completedTrialIds.includes('last-lantern')) {
      this.saveHarborContracts({ ...this.contractProgress, opened: true });
    }
    this.renderer = new AtlasRenderer(canvas);
    installAtlasKeyboard(window, this.input);
    window.addEventListener('resize', this.resize);
    window.addEventListener('blur', () => this.suspend('paused'));
    window.addEventListener('focus', this.resume);
    document.addEventListener('visibilitychange', this.visibility);
   this.resize();
  }

  boot(): void {
    this.usage.record('session-start');
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('/service-worker.js', { scope: '/' }).catch(() => undefined);
    /*
     * Browsers refuse to start audio before a gesture, so the theme waits for
     * the first touch anywhere rather than trying at load and failing silently.
     * Playtested as "no background sound on start": nothing ever unlocked audio
     * outside the two screens that called unlock() themselves.
     */
    window.addEventListener('pointerdown', () => {
      this.audio.unlock();
      if (this.screen !== 'beacon-commons' && this.screen !== 'pay-harbor') this.audio.playTheme();
    }, { once: true });
    this.canvas.hidden = true;
    this.renderWelcome();
    void this.ensureLivingCity().then(() => {
      this.cityLoadState = 'ready';
      if (this.screen === 'welcome') this.renderWelcome();
    }).catch(() => {
      this.cityLoadState = 'unavailable';
      if (this.screen === 'welcome') this.renderWelcome();
    });
    void this.loadAtlasStatus();
  }

  private async loadAtlasStatus(): Promise<void> {
    const [bootstrap, beacon, competition] = await Promise.allSettled([this.api.getBootstrap(), this.api.getBeacon(), this.api.getCompetition()]);
    this.atlasServiceStatus = bootstrap.status === 'fulfilled' ? bootstrap.value.campaignMode : 'unavailable';
    if (beacon.status === 'fulfilled') {
      this.atlasBeaconStatus = beacon.value.status;
      this.atlasContributorCount = beacon.value.verifiedContributorCount;
    } else {
      this.atlasBeaconStatus = 'unavailable';
      this.atlasContributorCount = 0;
    }
    this.atlasCompetition = competition.status === 'fulfilled' ? competition.value : [];
    if (this.screen === 'welcome') this.renderWelcome();
  }

  private returnHome = (): void => {
    this.screen = 'welcome';
    this.suspended = false;
    this.canvas.hidden = true;
    this.cityLoadState = 'loading';
    this.renderWelcome();
    void this.stopLivingCity().then(() => {
      if (this.screen !== 'welcome') return;
      void this.ensureLivingCity().then(() => {
        this.cityLoadState = 'ready';
        if (this.screen === 'welcome') this.renderWelcome();
      }).catch(() => {
        this.cityLoadState = 'unavailable';
        if (this.screen === 'welcome') this.renderWelcome();
      });
    });
  };

  private screenNav(context: string): HTMLElement {
    const nav = element('nav', 'atlas-screen-nav');
    nav.setAttribute('aria-label', 'Atlas navigation');
    const home = actionButton('Atlas home', this.returnHome, 'Return to NIM Atlas home');
    const location = element('span', '', `${this.selectedRole.toUpperCase()} / ${context.toUpperCase()}`);
    nav.append(home, location);
    return nav;
  }

  private openHowToPlay = (): void => {
    this.screen = 'how-to-play';
    this.renderHowToPlay();
  };

  private renderHowToPlay(): void {
    this.ui.replaceChildren();
    this.renderer.drawHarbor('street', this.selectedRole);
    const panel = this.screenPanel('atlas-how-to-play');
    panel.setAttribute('aria-label', 'How to play NIM Atlas');
    panel.append(
      this.screenNav('How to play'),
      element('p', 'atlas-eyebrow', 'SFACE / NIM ATLAS'),
      element('h1', '', 'Four moves. One changed district.'),
      element('p', 'atlas-guide-lead', 'Choose a path, help a real need, and leave the network better than you found it.'),
    );

    const steps = element('ol', 'atlas-step-rail');
    for (const step of ATLAS_HOW_TO_PLAY_STEPS) {
      const item = element('li', 'atlas-step-card');
      item.append(element('span', 'atlas-step-number', step.number), element('p', 'atlas-step-label', step.label), element('h2', '', step.title), element('p', '', step.copy));
      steps.append(item);
    }
    panel.append(steps);

    const paths = element('section', 'atlas-guide-section');
    paths.append(element('p', 'atlas-eyebrow', 'YOUR ROLE'), element('div', 'atlas-path-grid'));
    const pathGrid = paths.lastElementChild!;
    for (const path of ATLAS_HOW_TO_PLAY_PATHS) {
      const card = element('article', 'atlas-path-card');
      card.append(element('p', 'atlas-step-label', path.label), element('h2', '', path.title), element('p', '', path.copy));
      pathGrid.append(card);
    }
    panel.append(paths);

    const bridge = element('section', 'atlas-guide-section atlas-bridge-section');
    bridge.append(element('p', 'atlas-eyebrow', 'WHY NIMIQ IS IN THE GAME'), element('p', 'atlas-guide-note', 'The lesson is the action: every safe payment step has a visible consequence.'));
    const bridgeList = element('dl', 'atlas-nimiq-bridge');
    for (const row of ATLAS_NIMIQ_BRIDGE) bridgeList.append(element('dt', '', row.label), element('dd', '', row.meaning));
    bridge.append(bridgeList, element('p', 'atlas-verb-line', ATLAS_PAYMENT_VERBS.join('  /  ')));

    /*
     * How to get something to pay with.
     *
     * In-app purchases settle on the Nimiq test network, so a new player needs
     * test NIM before the lantern is reachable at all. Without this the live
     * payment path is a wall: the wallet opens, there is nothing to spend, and
     * nothing on screen says where to get it.
     */
    const faucet = element('section', 'atlas-guide-section atlas-faucet-section');
    faucet.append(
      element('p', 'atlas-eyebrow', 'BEFORE YOU BUY ANYTHING'),
      element('p', 'atlas-guide-note', 'Purchases in Atlas settle on the Nimiq test network, so they cost test NIM rather than real funds. Claim some first, then the harbor lantern is yours to buy for 0.1 NIM.'),
    );
    const faucetSteps = element('ol', 'atlas-faucet-steps');
    for (const step of [
      'Open Nimiq Pay and switch it to the test network.',
      'Copy your test address.',
      'Claim free test NIM from the faucet below.',
      'Come back to Pay Harbor and buy the lantern.',
    ]) faucetSteps.append(element('li', '', step));
    faucet.append(faucetSteps, externalLink('Claim test NIM from the Nimiq faucet', 'https://faucet.pos.nimiq-testnet.com/'));
    panel.append(bridge, faucet);

    const snapshots = element('section', 'atlas-guide-section');
    snapshots.append(element('p', 'atlas-eyebrow', 'SEE THE LOOP'), element('div', 'atlas-snapshot-grid'));
    const snapshotGrid = snapshots.lastElementChild!;
    for (const snapshot of ATLAS_HOW_TO_PLAY_SNAPSHOTS) {
      const figure = element('figure', 'atlas-snapshot');
      const image = document.createElement('img');
      image.src = snapshot.src;
      image.alt = snapshot.alt;
      image.loading = 'lazy';
      image.decoding = 'async';
      figure.append(image, element('figcaption', '', snapshot.caption));
      snapshotGrid.append(figure);
    }
    panel.append(snapshots);

    const deeper = document.createElement('details');
    deeper.className = 'atlas-guide-details';
    deeper.append(element('summary', '', 'Open the deeper NIM guide'));
    deeper.append(element('p', '', 'Want the builder-level version? The Knowledge Book turns each verb into a playable rule.'), externalLink('Read Nimiq Provider API', 'https://nimiq.dev/mini-apps/api-reference/nimiq-provider'), externalLink('Read Nimiq Mini Apps', 'https://nimiq.dev/mini-apps/'));
    panel.append(deeper, actionButton('Enter the living city', this.openBeaconCommons, 'Enter Beacon Commons and meet Mara'));
    this.ui.append(panel);
  }

  private startGarden = (): void => this.openBeaconCommons();

  private renderWelcome(): void {
    this.ui.replaceChildren();
    this.canvas.hidden = true;
    const panel = this.screenPanel('atlas-welcome atlas-home atlas-landing-shell');
    if (this.orbit.active) this.orbitStartedAt = performance.now();
    panel.setAttribute('aria-label', 'NIM Atlas game landing page');
    if (this.cityLoadState !== 'ready') {
      panel.append(this.renderLandingSplash());
      this.ui.append(panel);
      return;
    }
    /*
     * The crest leads and Nimiq is credited at the foot of the panel.
     *
     * Both marks used to sit together at the top, and because the attribution
     * line is centred while the crest is not, "POWERED BY NIMIQ" read as the
     * title of the product. A player's first impression was a Nimiq page. The
     * crest is the mark of the thing they are about to play; the credit is a
     * credit, and belongs where credits go.
     */
    panel.append(createAtlasCrest({ className: 'atlas-crest-lead' }));
    const eyebrow = element('p', 'atlas-eyebrow', 'NIM ATLAS / BEACON COMMONS');
    /*
     * The headline opens on the world, not on the technology.
     *
     * It used to be "Explore Nimiq. Build what survives." over "Learn how
     * Nimiq works by...", so the first word a player read was the sponsor and
     * the second line announced homework. Both are drawn from ATLAS_STORY now:
     * a hook a player can be curious about, and a promise of what they will
     * actually do. Nimiq is credited at the foot of the panel instead.
     */
    const heading = element('h1', '', 'The Beacon didn’t break.');
    const tagline = element('p', 'atlas-tagline', 'Its six threads stopped listening to each other. Follow one, from a person who needs help to a promise that actually arrives.');
    /*
     * "Sface is a Nimiq Pay Mini App game" used to sit here. It is true, and it
     * is plumbing: it describes the delivery mechanism to a player who has not
     * yet been given a reason to care about the game. The About screen still
     * carries it for anyone who wants it.
     */
    /*
     * ATLAS_STORY.logline used to sit here as a third paragraph. It says the
     * same thing the tagline now says - six parts of a city that stopped
     * trusting each other - so it was the screen telling the player twice.
     */
    /*
     * The 01/02/03 learning loop used to live here.
     *
     * It taught walk, use, see-change as three cards a player read before
     * playing. The first-run tutorial now teaches those three things in the
     * city, one at a time, blocking until each is done — which teaches them
     * better and costs no height on the one screen where height decides
     * whether anybody finds the button that starts the game.
     */
    const mission = element('div', 'atlas-mission-card');
    mission.append(
      element('strong', '', this.contractProgress.opened ? 'THE HARBOR NEEDS YOU' : '60-SECOND RUN / Meet Mara'),
      element('p', '', this.contractProgress.opened ? 'Your harbor is open. Deliver supplies, check orders, and improve your best ratings. Unfinished jobs resume where you left off.' : 'Mara needs one safe NIM payment route. Restore it, carry the lantern, relight the harbor. Choose a path, meet the Commons guide, and learn why each move matters.'),
    );
    const roles = element('div', 'atlas-role-choice');
    roles.append(element('strong', '', 'CHOOSE YOUR FIRST PATH'));
    const roleButtons = element('div', 'atlas-role-buttons');
    for (const role of ATLAS_PROLOGUE.roles) {
      const button = actionButton(role.title, () => {
        this.selectedRole = role.id;
        this.progress.setRole(role.id);
        this.renderWelcome();
      }, `Choose ${role.title} path`);
      button.className = `atlas-role atlas-role-${role.id}${this.selectedRole === role.id ? ' is-selected' : ''}`;
      button.setAttribute('aria-pressed', String(this.selectedRole === role.id));
      roleButtons.append(button);
    }
    const activeRole = ATLAS_PROLOGUE.roles.find((role) => role.id === this.selectedRole)!;
    roles.append(roleButtons, element('p', 'atlas-role-description', activeRole.description));
    const promise = element('p', 'atlas-quiet', this.selectedRole === 'builder' ? 'Builder: repair, predict, verify.' : 'Explorer: inspect, approve, confirm.');
    const startLabel = this.contractProgress.opened
      ? (this.contractProgress.active ? 'Resume harbor job' : 'Harbor contracts')
      : 'Start 60-second run';
    const startAction = this.contractProgress.opened ? () => { void this.enterPayHarbor(); } : this.openBeaconCommons;
    const startDescription = this.contractProgress.opened
      ? 'Return to your open harbor'
      : 'Start the 60-second NIM Atlas run and Meet Mara';
    const start = actionButton(startLabel, startAction, startDescription);
    start.classList.add('atlas-start');
    // Only `start` keeps the signal colour. Everything else here is a ghost, so
    // a first-time player has exactly one obvious next move. Three identical
    // orange buttons is not a hierarchy, it is three ways of saying "maybe".
    const howToPlay = ghostButton('How to play', this.openHowToPlay, 'Read how to play NIM Atlas');
    const book = ghostButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book');
    const daily = ghostButton('Play today\'s Atlas puzzle', this.openDailyPuzzle, 'Play today\'s Atlas puzzle');
    const districts = ghostButton('Walk the District Atlas', this.openEvergreen, 'Walk the evergreen District Atlas');
    const coreRun = ghostButton('Play the verified core run', this.openCoreRun, 'Play the replay-backed Atlas core run');
    const primary = element('div', 'atlas-home-primary');
    primary.append(mission, roles, promise, start, howToPlay);
    const introduction = element('div', 'atlas-home-intro');
    introduction.append(eyebrow, heading, tagline);
    const homeGrid = element('div', 'atlas-home-grid');
    homeGrid.append(introduction, primary);
    const routes = document.createElement('details');
    routes.className = 'atlas-home-routes';
    routes.append(element('summary', '', 'More ways to learn in the city'));
    const quick = element('div', 'atlas-quick-grid');
    quick.append(daily, book, districts, coreRun);
    routes.append(quick);
    const saved = this.progress.load().completedAdventureIds.includes('genesis-garden');
    panel.append(homeGrid, routes, this.renderStatusDrawer());
    if (saved) panel.append(element('p', 'atlas-saved', 'Garden seal saved on this device. You can replay it.'));
    panel.append(createNimiqPoweredBy());
    this.ui.append(panel);
  }

  /*
   * Every screen is a sheet over a live city.
   *
   * This used to be conditional on the city being ready, which meant a screen
   * could be a full-bleed page one moment and a bottom sheet the next. The city
   * now runs from boot, so the condition is gone and the shape is constant.
   *
   * The two play shells do not come through here: they are already the
   * world-first surface everything else is being made to resemble.
   */
  private screenPanel(className: string): HTMLElement {
    // Every screen but the welcome one wants the camera following the player,
    // so stopping the drift here means no screen has to remember to.
    this.orbitStartedAt = null;
    this.audio.stopCityAmbience();
    this.audio.playTheme();
    return element('section', `atlas-panel ${className}`.trim());
  }

  private renderLandingSplash(): HTMLElement {
    const splash = element('div', 'atlas-landing-splash');
    const state = this.cityLoadState === 'unavailable';
    /*
     * The splash is the *first* screen a player ever sees, so it follows the
     * same rule as the title screen: the crest leads and Nimiq is credited at
     * the foot. Both marks used to sit together at the top here too, and the
     * centred "POWERED BY NIMIQ" out-weighed a 34px crest in the corner, so a
     * player's first impression of the game was a Nimiq loading page.
     */
    splash.append(createAtlasCrest({ className: 'atlas-crest-lead' }));
    splash.append(
      element('p', 'atlas-eyebrow', 'NIM ATLAS / BEACON COMMONS'),
      element('h1', '', state ? 'Reconnect the city.' : 'Entering Beacon Commons.'),
      element('p', 'atlas-splash-copy', state ? 'The 3D city did not finish loading. Your learning path is safe; try the city link again.' : 'A living NIM Atlas district is getting ready around you.'),
    );
    const steps = element('div', 'atlas-splash-steps');
    for (const label of ['CITY', 'PLAYER', 'PEOPLE']) {
      const step = element('span', 'atlas-splash-step', label);
      step.dataset.state = state ? 'waiting' : 'loading';
      steps.append(step);
    }
    splash.append(steps);
    if (state) {
      const retry = actionButton('Retry city link', () => {
        this.cityLoadState = 'loading';
        this.renderWelcome();
        void this.ensureLivingCity().then(() => {
          this.cityLoadState = 'ready';
          if (this.screen === 'welcome') this.renderWelcome();
        }).catch(() => {
          this.cityLoadState = 'unavailable';
          if (this.screen === 'welcome') this.renderWelcome();
        });
      }, 'Retry loading the Beacon Commons city');
      retry.classList.add('atlas-splash-retry');
      splash.append(retry);
    }
    splash.append(createNimiqPoweredBy());
    return splash;
  }

  private renderBeaconStatus(): HTMLElement {
    const section = element('section', 'atlas-beacon');
    section.setAttribute('aria-label', 'Network Beacon');
    section.append(
      element('strong', '', 'NETWORK BEACON'),
      element('p', `atlas-beacon-status is-${this.atlasBeaconStatus}`, `${this.atlasBeaconStatus.toUpperCase()} / SERVER PROJECTION`),
      element('p', 'atlas-quiet', this.atlasBeaconStatus === 'live' ? `${this.atlasContributorCount.toLocaleString()} verified contributors projected by the server.` : 'Verified shared-world progress is not available in this build. No progress is being invented locally.'),
      element('p', 'atlas-quiet', `Atlas service: ${this.atlasServiceStatus}. District systems change only after the server projects verified eligible best daily deltas.`),
    );
    const systems = element('div', 'atlas-beacon-systems');
    for (const district of ['GENESIS GARDEN', 'LIGHT FOREST', 'PAY HARBOR', 'ALBATROSS CAUSEWAY', 'VALIDATOR PEAKS', 'BUILDER CITY']) {
      systems.append(element('span', 'atlas-beacon-system', district));
    }
    section.append(systems);
    return section;
  }

  private renderShopCatalog(): HTMLElement {
    const section = element('section', 'atlas-shop');
    section.setAttribute('aria-label', 'Optional mainnet shop');
    section.append(
      element('strong', '', 'MAINNET EXPANSIONS'),
      element('p', 'atlas-shop-lock', 'OWNER APPROVAL REQUIRED'),
      element('p', 'atlas-quiet', 'Purchases stay disabled in the browser and in testnet mode. Core adventures, knowledge, and reward paths remain free.'),
    );
    const items = element('div', 'atlas-shop-items');
    for (const item of ATLAS_MAINNET_SHOP_ITEMS) {
      const card = element('article', 'atlas-shop-card');
      card.append(element('strong', '', item.type.replace('-', ' ').toUpperCase()), element('small', '', `${item.priceLuna.toLocaleString()} Lunas / MAINNET`));
      const locked = actionButton('Locked', () => undefined, `Mainnet ${item.id} is locked`);
      locked.disabled = true;
      locked.classList.add('atlas-shop-locked');
      card.append(locked);
      items.append(card);
    }
    section.append(items);
    return section;
  }

  private renderLeaderboards(): HTMLElement {
    const board = element('section', 'atlas-leaderboards');
    board.setAttribute('aria-label', 'Verified Atlas leaderboards');
    board.append(element('strong', '', 'VERIFIED PLAY / SEPARATE PATHS'), element('p', 'atlas-quiet', this.atlasCompetition.length > 0
      ? 'Explorer and Builder scores are ranked separately. These standings come from server summaries; rewards still require the published eligibility and verification gates.'
      : 'Explorer and Builder scores are ranked separately. Public standings appear here after the server summary is available; local play never invents names, scores, or rewards.' ));
    const tracks = element('div', 'atlas-leaderboard-grid');
    if (this.atlasCompetition.length > 0) {
      board.append(createCompetitionView(this.atlasCompetition));
      return board;
    }
    for (const title of ['EXPLORER LEADERBOARD', 'BUILDER LEADERBOARD']) {
      const card = element('article', 'atlas-leaderboard-card');
      card.append(element('strong', '', title), element('p', '', 'BOARD UNAVAILABLE'), element('small', '', 'Server-verified runs will appear here only after replay checks and the leaderboard read API are enabled.'));
      tracks.append(card);
    }
    board.append(tracks);
    return board;
  }

  private renderStatusDrawer(): HTMLElement {
    const drawer = document.createElement('details');
    drawer.className = 'atlas-status-drawer';
    const summary = element('summary', '', 'Verified world, rankings, and optional expansions');
    const story = element('section', 'atlas-story-status');
    story.setAttribute('aria-label', 'Atlas story loop');
    story.append(
      element('strong', '', `${ATLAS_STORY.hubName.toUpperCase()} / THE THREAD THAT BINDS`),
      element('p', 'atlas-quiet', ATLAS_STORY.dailyLoop),
    );
    drawer.append(summary, story, this.renderLeaderboards(), this.renderBeaconStatus(), this.renderShopCatalog());
    return drawer;
  }

  private openBeaconCommons = (): void => {
    this.canvas.hidden = true;
    this.audio.unlock();
    this.audio.narrateLine(ATLAS_STORY_CHAPTERS[0]!.voice.arrival);
    this.screen = 'beacon-commons';
    this.beaconTravelNotice = '';
    this.cityQuestStep = 'meet-guide';
    try {
      this.routeRun = recoverRouteRun(JSON.parse(localStorage.getItem(`atlas-route-practice-v1-${this.selectedRole}`) ?? 'null'));
      if (this.routeRun?.role !== this.selectedRole) this.routeRun = null;
    } catch { this.routeRun = null; }
    this.routeRun ??= createRouteRun(this.selectedRole);
    this.cityQuestStep = this.routeRun.stage === 'arrive' ? 'meet-guide' : 'guide-met';
    this.renderBeaconCommons();
    void this.ensureLivingCity().then(() => {
      if (this.screen !== 'beacon-commons') return;
      // Welcome can stop at any orbit angle. Start facing the guide, then
      // leave subsequent camera changes entirely under the player's control.
      this.livingCity?.recenterCamera();
      this.renderBeaconCommons();
    }).catch((error: unknown) => {
      if (this.screen !== 'beacon-commons') return;
      this.beaconTravelNotice = error instanceof Error ? error.message : 'Beacon Commons is unavailable.';
      this.renderBeaconCommons();
    });
  };

  private renderBeaconCommons(): void {
    this.ui.replaceChildren();
    if (this.gateForLandscape()) return;
    const citizens = this.livingCity?.crowdSnapshot() ?? [];
    const visibleCitizens = citizens.filter((citizen) => citizen.visible).length;
    const activeCitizens = citizens.filter((citizen) => citizen.active).length;
    const shell = element('section', 'atlas-play-shell atlas-living-city-play-shell');
    /*
     * All seven chapters are played on one 3D scene. That is deliberate, but
     * the topbar used to name the geometry while the mission card named the
     * chapter, so a player in chapter 2 read "BEACON COMMONS" directly above a
     * card headed "LIGHT FOREST". The label follows the chapter instead, and
     * comes from the same `routeLesson` the card is built from, so the two
     * cannot drift apart again. Outside a run there is no chapter, and the
     * player really is in Beacon Commons.
     */
    const place = this.routeRun ? routeLesson(this.routeRun).name : 'Beacon Commons';
    shell.setAttribute('aria-label', `${place} living city adventure`);

    const topbar = element('header', 'atlas-topbar atlas-city-topbar');
    const brand = this.createCityBrand(`${place.toUpperCase()} / LIVING CITY`, `Leave ${place} and return to Atlas home`);
    const population = element('div', 'atlas-integrity atlas-city-population', this.livingCity ? `${visibleCitizens} HERE / ${activeCitizens} ACTIVE` : 'CITY LOADING');
    population.setAttribute('role', 'status');
    const pause = actionButton(this.suspended ? 'Resume' : 'Pause', this.togglePause, this.suspended ? `Resume ${place}` : `Pause ${place}`);
    pause.className = 'atlas-pause';
    const access = actionButton(this.accessibleMovement ? 'Stick' : 'D-pad', () => {
      this.accessibleMovement = !this.accessibleMovement;
      shell.classList.toggle('has-accessible-movement', this.accessibleMovement);
      access.textContent = this.accessibleMovement ? 'Stick' : 'D-pad';
    }, 'Switch between joystick and accessible directional buttons');
    const mute = actionButton(this.cityMuted ? 'Sound off' : 'Sound on', () => {
      this.cityMuted = !this.cityMuted;
      for (const bus of ['ambience', 'events', 'interface', 'voice'] as const) this.audio.setVolume(bus, this.cityMuted ? 0 : bus === 'ambience' ? 0.25 : 0.7);
      mute.textContent = this.cityMuted ? 'Sound off' : 'Sound on';
      mute.setAttribute('aria-pressed', String(this.cityMuted));
    }, 'Mute or unmute game audio');
    access.className = 'atlas-pause';
    mute.className = 'atlas-pause';
    const motion = actionButton(this.cityReducedMotion ? 'Motion reduced' : 'Reduce motion', () => {
      this.cityReducedMotion = !this.cityReducedMotion;
      this.livingCity?.setReducedMotion(this.cityReducedMotion);
      shell.classList.toggle('has-reduced-motion', this.cityReducedMotion);
      motion.textContent = this.cityReducedMotion ? 'Motion reduced' : 'Reduce motion';
      motion.setAttribute('aria-pressed', String(this.cityReducedMotion));
    }, 'Toggle reduced motion');
    motion.className = 'atlas-pause';
    motion.setAttribute('aria-pressed', String(this.cityReducedMotion));
    shell.classList.toggle('has-reduced-motion', this.cityReducedMotion);
    /*
     * These three are settings, not play controls, and .atlas-topbar is a
     * three-column grid. Appending them to it wrapped them onto a second row
     * over the city. They sit behind one button now.
     */
    const settingsPanel = element('div', 'atlas-hud-settings');
    settingsPanel.setAttribute('aria-label', 'Accessibility and sound settings');
    settingsPanel.hidden = true;
    settingsPanel.append(access, mute, motion);
    const settingsToggle = actionButton('Settings', () => {
      settingsPanel.hidden = !settingsPanel.hidden;
      settingsToggle.setAttribute('aria-expanded', String(!settingsPanel.hidden));
    }, 'Show accessibility and sound settings');
    settingsToggle.className = 'atlas-pause';
    settingsToggle.setAttribute('aria-expanded', 'false');
    const topbarActions = element('div', 'atlas-topbar-actions');
    topbarActions.append(settingsToggle, pause);
    topbar.append(brand, population, topbarActions);
    shell.classList.toggle('has-accessible-movement', this.accessibleMovement);

    const objective = this.routeRun
      ? routeObjective(this.routeRun)
      : this.cityQuestStep === 'meet-guide'
      ? {
          depth: 'glance' as const,
          objective: 'MEET THE COMMONS GUIDE',
          detail: this.beaconTravelNotice || 'Pay Harbor has gone dark. Follow the pink marker to the guide, then talk when you are close.',
          status: `${this.selectedRole.toUpperCase()} PATH / LEFT STICK MOVES / PUSH OUTER RING TO RUN`,
        }
      : {
          depth: 'glance' as const,
          objective: 'FIND THE PAY HARBOR GATE',
          detail: "Mara's Last Lantern is dark. Follow the pink street to Pay Harbor before its trade route closes.",
          status: 'MISSION ACCEPTED / FOLLOW PINK / TRAVEL AT THE GATE',
        };
    this.toolkit = createAtlasToolkit(objective);

    const controls = element('div', 'atlas-controls atlas-city-controls');
    const movement = element('div', 'atlas-mobile-movement');
    movement.setAttribute('aria-label', 'Movement controls');
    movement.append(this.createCityJoystick());
    const accessibleDirections = element('div', 'atlas-movement atlas-movement-accessible');
    accessibleDirections.append(
      this.movementButton('Up', 'up', '\u2191'),
      this.movementButton('Left', 'left', '\u2190'),
      this.movementButton('Down', 'down', '\u2193'),
      this.movementButton('Right', 'right', '\u2192'),
    );
    movement.append(accessibleDirections);
    const actions = element('div', 'atlas-actions');
    actions.append(this.createCitySprint());
    const routeAction = this.routeRun?.stage === 'arrive' ? 'Talk' : this.routeRun?.stage === 'evidence' ? 'Inspect' : this.routeRun?.stage === 'verified' ? 'Install' : this.routeRun?.stage === 'complete' ? 'Travel' : this.routeRun?.chapter === 1 && this.routeRun?.stage === 'signal' ? 'Follow trail' : this.routeRun?.chapter === 2 && this.routeRun?.stage === 'signal' ? 'Compare requests' : this.routeRun?.chapter === 3 && this.routeRun?.stage === 'signal' ? 'Advance receipt' : this.routeRun?.chapter === 4 && this.routeRun?.stage === 'signal' ? 'Check validator' : this.routeRun?.chapter === 5 && this.routeRun?.stage === 'signal' ? 'Verify server' : 'Mission';
    const interact = actionButton(
      this.routeRun ? routeAction : this.cityQuestStep === 'meet-guide' ? 'Talk' : 'Travel',
      this.routeRun ? this.interactRoute : this.cityQuestStep === 'meet-guide' ? this.interactWithCommonsGuide : this.travelToPayHarbor,
      this.routeRun ? `${routeAction} at the marked destination` : this.cityQuestStep === 'meet-guide' ? 'Interact with the Commons guide' : 'Travel through the Pay Harbor gate',
    );
    interact.className = 'atlas-tool atlas-context-action';
    actions.append(interact);
    controls.append(movement, actions);
    const hint = element('p', 'atlas-key-hint', this.livingCity ? `${this.livingCity.qualityTier().toUpperCase()} PROFILE / DRAG TO WALK / HOLD RUN TO SPRINT` : 'LOADING VERIFIED PROCEDURAL 3D ASSETS');
    const cameraCenter = actionButton('Center', () => this.livingCity?.recenterCamera(), 'Center the camera behind the player');
    cameraCenter.className = 'atlas-camera-center';
    const cameraMode = actionButton(this.cameraOverview ? 'Follow' : 'Overview', () => {
      this.cameraOverview = !this.cameraOverview;
      cameraMode.textContent = this.cameraOverview ? 'Follow' : 'Overview';
      this.presentRouteWorld();
    }, 'Switch between follow camera and city overview');
    cameraMode.className = 'atlas-camera-mode';
    shell.append(topbar, settingsPanel, this.toolkit.element, this.createBeaconMap(), this.createCityWaypoint(), this.createCameraLookZone(), cameraCenter, controls, hint);
    shell.append(cameraMode);
    if (this.routeRun && this.freePlayDone) {
      /*
       * The stage's dim class outlives the shell, so this branch has to clear
       * it. applyTutorialStep is the only thing that toggles it and it lives on
       * the other branch, so a route card rendered while the tutorial was still
       * incomplete left the world dimmed permanently with no prompt and no
       * spotlight to explain why - the shell is rebuilt each render, so the
       * chrome vanished while the class on the persistent stage element stayed.
       * Probed on a Pixel 7 Pro: stageDimmed true, isTutorial false, zero
       * prompts, tutorial still on step 'walk'.
       */
      this.clearTutorialChrome();
      this.toolkit.element.hidden = true;
      this.routeCard = createRouteCard(this.routeRun, this.actRoute);
      shell.append(this.routeCard);
      const feed = element('ol', 'atlas-route-feed');
      feed.setAttribute('aria-label', 'Recent city events');
      for (const line of this.routeFeed.slice(-2)) feed.append(element('li', '', line));
      shell.append(feed);
      this.presentRouteWorld();
    } else this.applyTutorialStep(shell, movement, interact);
    this.ui.append(shell);
    this.audio.unlock();
    this.audio.stopTheme();
    this.audio.playCityAmbience();
    this.resizeLivingCity();
  }

  private presentRouteWorld(): void {
    const run = this.routeRun;
    if (!run || this.screen !== 'beacon-commons') return;
    const world = routeWorld(run);
    this.livingCity?.present(projectLivingWorld(world, createAtlasState(world.mission), routeRestoration(run)));
    this.livingCity?.advance(routeProgress(run));
    this.livingCity?.setInteractionPresentation({ districtId: 'beacon-commons', relayCarried: run.stage === 'verified', builderStationIndex: routeRestoration(run) === 'restored' ? 1 : 0, targetAnchorId: this.currentCityTargetAnchorId(), cameraMode: this.cameraOverview ? 'overview' : 'follow' });
  }

  private actRoute = (action: RouteAction): void => {
    if (this.suspended) return;
    const run = this.routeRun;
    const player = this.livingCity?.playerSnapshot();
    if (!run || !player) return;
    // World position gates interactions; deterministic mission rules live in shared.
    const needsStation = ['weak-evidence', 'reorg-evidence', 'match-evidence'].includes(action);
    if (needsStation && !this.isNearBeaconAnchor(player, 'community-plaza', 2.4)) return;
    const next = stepRouteRun(run, action);
    if (next === run) return;
    this.routeRun = next;
    /* Counted here because this is the only place a run advances, so the funnel
     * cannot drift from the game. The reporter drops repeats itself. */
    this.usage.record('chapter-start', next.chapter);
    if (next.stage === 'complete' && run.stage !== 'complete') this.usage.record('chapter-complete', next.chapter);
    this.cityQuestStep = next.stage === 'arrive' ? 'meet-guide' : 'guide-met';
    try { localStorage.setItem(`atlas-route-practice-v1-${next.role}`, JSON.stringify({ version: 1, role: next.role, actions: next.actions })); }
    catch { this.routeFeed.push('Local saving unavailable. Keep this tab open to continue.'); }
    if (next.notice) this.routeFeed.push(next.notice);
    if (this.routeFeed.length > 3) this.routeFeed.splice(0, this.routeFeed.length - 3);
    const refusal = action === 'try-signal' || action === 'follow-stale-trail' || action === 'trust-early-receipt' || action === 'trust-single-validator' || action === 'trust-browser' || action === 'rush-beacon' || action === 'weak-evidence' || action === 'reorg-evidence' || action === 'wrong-answer';
    this.audio.playWorldCue(refusal ? 'route-refused' : action === 'match-evidence' ? 'route-evidence' : action === 'install' ? 'route-repaired' : action === 'teach-back' ? 'route-complete' : 'city-interaction');
    if (action === 'install') {
      const chapter = next.chapter === 0 ? getAtlasStoryChapter('genesis-garden') : next.chapter === 1 ? getAtlasStoryChapter('light-forest') : next.chapter === 2 ? getAtlasStoryChapter('pay-harbor') : next.chapter === 3 ? getAtlasStoryChapter('albatross-causeway') : next.chapter === 4 ? getAtlasStoryChapter('validator-peaks') : next.chapter === 5 ? getAtlasStoryChapter('builder-city') : next.chapter === 6 ? getAtlasStoryChapter('beacon-core') : undefined;
      if (chapter) this.audio.narrateLine(chapter.voice.completion);
      else this.audio.narrate(`Practice route restored. ${routeLesson(next).result}`);
    }
    this.evidenceOpen = false;
    this.input.clearJoystick();
    this.renderBeaconCommons();
    // A replaced button must not strand keyboard focus on the document body.
    this.routeCard?.querySelector<HTMLElement>('button, summary')?.focus({ preventScroll: true });
  };

  private interactRoute = (): void => {
    if (this.suspended) return;
    const run = this.routeRun;
    const player = this.livingCity?.playerSnapshot();
    if (!run || !player) return;
    if (run.stage === 'complete') { this.travelToPayHarbor(); return; }
    if (!this.isNearBeaconAnchor(player, routeTarget(run), 2.4)) {
      if (this.routeCard) {
        let hint = this.routeCard.querySelector<HTMLElement>('[data-reach-hint]');
        if (!hint) { hint = element('p', 'atlas-route-notice'); hint.dataset.reachHint = 'true'; hint.setAttribute('role', 'status'); this.routeCard.append(hint); }
        hint.textContent = 'Follow the marker. Move within 2.4 metres to interact.';
      }
      return;
    }
    if (run.stage === 'arrive') this.actRoute('talk');
    else if (run.stage === 'verified') this.actRoute('install');
    else if (run.stage === 'evidence' && !this.evidenceOpen) {
      this.evidenceOpen = true;
      this.routeCard?.append(createEvidenceChoices(run, this.actRoute));
      this.routeCard?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true });
    } else this.routeCard?.querySelector<HTMLElement>('button, summary')?.focus({ preventScroll: true });
  };

  private interactWithCommonsGuide = (): void => {
    const player = this.livingCity?.playerSnapshot();
    if (!player) {
      this.beaconTravelNotice = 'The city is still loading. Movement will unlock when the verified 3D assets are ready.';
      this.renderBeaconCommons();
      return;
    }
    if (!this.isNearBeaconAnchor(player, 'mission-guide', ATLAS_GUIDE_REACH_METRES)) {
      this.toolkit?.setDetail('Move closer to the pink guide beside the market, then talk.');
      return;
    }
    this.cityQuestStep = 'guide-met';
    this.beaconTravelNotice = '';
    this.audio.playWorldCue('city-interaction');
    this.audio.narrateLine(ATLAS_STORY_CHAPTERS[0]!.voice.arrival);
    this.renderBeaconCommons();
  };

  private createBeaconMap(): HTMLElement {
    const panel = element('aside', 'atlas-mini-map');
    const districtLabel = this.screen === 'pay-harbor' ? 'Pay Harbor' : 'Beacon Commons';
    panel.setAttribute('aria-label', `${districtLabel} navigation map`);
    panel.append(element('span', 'atlas-mini-map-label', 'CITY MAP'));
    const scene = this.beaconScene;
    if (!scene) {
      panel.append(element('span', 'atlas-mini-map-loading', 'LOADING'));
      return panel;
    }
    const points = scene.paths.flatMap((path) => path.points).concat(scene.anchors.map((anchor) => anchor.position));
    const minX = Math.min(...points.map((point) => point[0])) - 2;
    const maxX = Math.max(...points.map((point) => point[0])) + 2;
    const minZ = Math.min(...points.map((point) => point[2])) - 2;
    const maxZ = Math.max(...points.map((point) => point[2])) + 2;
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `${minX} ${minZ} ${maxX - minX} ${maxZ - minZ}`);
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `${districtLabel} route network with current position`);
    for (const path of scene.paths) {
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
      line.setAttribute('points', path.points.map((point) => `${point[0]},${point[2]}`).join(' '));
      line.setAttribute('class', path.purpose === 'walk' ? 'atlas-map-route' : 'atlas-map-side-route');
      svg.append(line);
    }
    for (const anchor of scene.anchors.filter((candidate) => !candidate.id.startsWith('npc-spawn-'))) {
      const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      marker.setAttribute('cx', String(anchor.position[0]));
      marker.setAttribute('cy', String(anchor.position[2]));
      marker.setAttribute('r', anchor.kind === 'travel' ? '0.42' : '0.25');
      marker.setAttribute('class', anchor.kind === 'travel' ? 'atlas-map-landmark' : 'atlas-map-point');
      svg.append(marker);
    }
    const target = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    target.setAttribute('r', '0.55');
    target.setAttribute('class', 'atlas-map-target');
    const player = document.createElementNS('http://www.w3.org/2000/svg', 'polygon');
    player.setAttribute('points', '-0.48,0.52 0,-0.72 0.48,0.52');
    player.setAttribute('class', 'atlas-map-player');
    svg.append(target, player);
    panel.append(svg);
    this.beaconMapSvg = svg;
    this.beaconMapPlayer = player;
    this.beaconMapTarget = target;
    this.updateBeaconMap(this.livingCity?.playerSnapshot());
    return panel;
  }

  private updateBeaconMap(player: AtlasCityPlayerState | undefined): void {
    if (player && this.beaconMapPlayer) {
      const rotationDegrees = (player.headingRadians - Math.PI) * 180 / Math.PI;
      this.beaconMapPlayer.setAttribute('transform', `translate(${player.x} ${player.z}) rotate(${rotationDegrees})`);
      /* A 21 m window in a 168 px circle put eight metres in a fingertip. Seven
         metres either side keeps the next target on screen while making the
         street it sits on readable. */
      const localRadius = 7;
      this.beaconMapSvg?.setAttribute('viewBox', `${player.x - localRadius} ${player.z - localRadius} ${localRadius * 2} ${localRadius * 2}`);
      if (this.cityPaceLabel) {
        this.cityPaceLabel.textContent = player.pace === 'run' ? 'RUNNING' : player.pace === 'walk' ? 'WALKING' : 'READY';
        this.cityPaceLabel.dataset.pace = player.pace;
      }
    }
    const targetId = this.currentCityTargetAnchorId();
    const target = this.beaconScene?.anchors.find((anchor) => anchor.id === targetId);
    if (target) {
      const playerPosition = player ?? this.livingCity?.playerSnapshot();
      if (!playerPosition) return;
      this.updateCityWaypoint(playerPosition, target.position);
      if (!this.beaconMapTarget) return;
      const deltaX = target.position[0] - playerPosition.x;
      const deltaZ = target.position[2] - playerPosition.z;
      const distance = Math.hypot(deltaX, deltaZ);
      // Keep the target ring inside the seven-metre circular map, including its rim.
      const targetRadius = 5.6;
      const scale = distance > targetRadius ? targetRadius / distance : 1;
      this.beaconMapTarget.setAttribute('cx', String(playerPosition.x + deltaX * scale));
      this.beaconMapTarget.setAttribute('cy', String(playerPosition.z + deltaZ * scale));
    }
  }

  private currentCityTargetAnchorId(): string {
    if (this.screen === 'pay-harbor') return this.currentPayHarborMission().targetAnchorId;
    if (this.routeRun && this.screen === 'beacon-commons') return this.routeRun.stage === 'complete' ? 'travel-pay-harbor' : routeTarget(this.routeRun);
    if (this.cityQuestStep === 'meet-guide') return 'mission-guide';
    return 'travel-pay-harbor';
  }

  private travelToPayHarbor = (): void => {
    const player = this.livingCity?.playerSnapshot();
    if (!player || !this.isNearBeaconAnchor(player, 'travel-pay-harbor', 3)) {
      this.toolkit?.setDetail('Follow the pink street to the tall transport building. Travel unlocks when you reach its entrance.');
      return;
    }
    this.toolkit?.setDetail('Opening the verified Pay Harbor route...');
    void this.enterPayHarbor();
  };

  private async enterPayHarbor(): Promise<void> {
    const controller = this.livingCity;
    const assets = this.cityAssets;
    if (!controller || !assets) {
      this.toolkit?.setDetail('The living city is not ready yet. Stay at the gate and try again.');
      return;
    }
    try {
      const scenePath = '/atlas/3d/v1/pay-harbor/scene.json';
      const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
      await controller.activateDistrict('pay-harbor');
      controller.setNavigation(livingCityNavigation(scene));
      this.beaconScene = scene;
      const lanternMode = this.paymentConfig.enabled ? 'live' : 'practice';
      this.lanternState = this.readLastLanternState(lanternMode) ?? createLastLanternState(this.selectedRole, lanternMode);
      this.harborDialogue = null;
      this.paymentNotice = this.lanternState.phase === 'confirming' && lanternMode !== 'practice'
        ? 'A submitted payment was restored safely. Atlas is checking the network; no second approval is needed.'
        : '';
      this.liveOrderId = null;
      this.liveLookup = null;
      this.paymentController = this.paymentConfig.enabled ? this.createPaymentController() : null;
      this.payHarborBuilderStation = this.lanternState.phase === 'fulfilled' && this.selectedRole === 'builder' ? this.readBuilderStation() : 0;
      this.restorePaymentJourney();
      this.screen = 'pay-harbor';
      this.presentPayHarborWorld();
      this.audio.playWorldCue('city-interaction');
      this.audio.narrate(this.contractProgress.opened ? this.currentPayHarborMission().detail : 'You have reached Pay Harbor. Find Mara, inspect the lantern, and verify every payment field before the city changes.');
      this.renderPayHarbor();
    } catch {
      this.toolkit?.setDetail('Pay Harbor could not open. Beacon Commons is still safe; try the gate again when the route is available.');
    }
  }

  private renderPayHarbor(): void {
    this.ui.replaceChildren();
    if (this.gateForLandscape()) return;
    const mission = this.currentPayHarborMission();
    const citizens = this.livingCity?.crowdSnapshot() ?? [];
    const shell = element('section', 'atlas-play-shell atlas-living-city-play-shell atlas-pay-harbor-play-shell');
    shell.setAttribute('aria-label', 'Pay Harbor living city mission');

    const topbar = element('header', 'atlas-topbar atlas-city-topbar');
    const brand = this.createCityBrand('PAY HARBOR / THE LAST LANTERN', 'Leave Pay Harbor and return to Atlas home');
    const population = element('div', 'atlas-integrity atlas-city-population', `${citizens.filter((citizen) => citizen.visible).length} HERE / ${citizens.filter((citizen) => citizen.active).length} ACTIVE`);
    population.setAttribute('role', 'status');
    const pause = actionButton(this.suspended ? 'Resume' : 'Pause', this.togglePause, this.suspended ? 'Resume Pay Harbor' : 'Pause Pay Harbor');
    pause.className = 'atlas-pause';
    if (this.contractProgress.opened) {
      const jobs = actionButton('Jobs', () => this.openHarborBoard(), 'View harbor jobs or put aside your current job');
      jobs.className = 'atlas-pause';
      topbar.append(brand, jobs, pause);
    } else topbar.append(brand, population, pause);

    this.toolkit = createAtlasToolkit({ depth: 'glance', objective: mission.objective, detail: this.contractProgress.opened ? this.contractStore.notice() || mission.detail : this.paymentNotice || mission.detail, status: mission.status });
    const controls = element('div', 'atlas-controls atlas-city-controls');
    const movement = element('div', 'atlas-mobile-movement');
    movement.setAttribute('aria-label', 'Movement controls');
    movement.append(this.createCityJoystick());
    const accessibleDirections = element('div', 'atlas-movement atlas-movement-accessible');
    accessibleDirections.append(
      this.movementButton('Up', 'up', '\u2191'),
      this.movementButton('Left', 'left', '\u2190'),
      this.movementButton('Down', 'down', '\u2193'),
      this.movementButton('Right', 'right', '\u2192'),
    );
    movement.append(accessibleDirections);
    const actions = element('div', 'atlas-actions');
    actions.append(this.createCitySprint());
    const interact = actionButton(mission.actionLabel, this.interactInPayHarbor, `${mission.actionLabel}: ${mission.objective}`);
    interact.className = 'atlas-tool atlas-context-action';
    actions.append(interact);
    controls.append(movement, actions);
    const hint = element('p', 'atlas-key-hint', `${this.livingCity?.qualityTier().toUpperCase() ?? 'BALANCED'} PROFILE / FOLLOW THE MAP / ACT WHEN CLOSE`);
    const cameraCenter = actionButton('Center', () => this.livingCity?.recenterCamera(), 'Center the camera behind the player');
    cameraCenter.className = 'atlas-camera-center';
    shell.append(topbar, this.toolkit.element);
    const paymentReview = this.createCityPaymentReview();
    if (paymentReview) shell.append(paymentReview);
    shell.append(this.createBeaconMap(), this.createCityWaypoint(), this.createCameraLookZone(), cameraCenter, controls, hint);
    this.ui.append(shell);
    if (this.harborDialogue) {
      shell.inert = true;
      const dialogue = dialogueSheet(this.harborDialogue);
      dialogue.setAttribute('aria-modal', 'true');
      this.ui.append(dialogue);
      dialogue.querySelector<HTMLButtonElement>('button')?.focus();
    }
    this.audio.unlock();
    this.audio.stopTheme();
    this.audio.playCityAmbience();
    this.resizeLivingCity();
  }

  private createCityBrand(locationLabel: string, ariaLabel: string): HTMLButtonElement {
    const brand = document.createElement('button');
    brand.type = 'button';
    brand.className = 'atlas-brand';
    brand.setAttribute('aria-label', ariaLabel);
    brand.addEventListener('click', this.returnHome);
    /*
     * Our own crest, decorative because the button already carries an
     * aria-label. This used to be the Nimiq signet, which read as though NIM
     * Atlas were an official Nimiq product. It is a game that teaches Nimiq,
     * so the crest leads and Nimiq is credited by name in `createNimiqPoweredBy`.
     */
    brand.append(createAtlasCrest({ decorative: true }), element('span', '', 'NIM ATLAS'), element('small', '', locationLabel));
    return brand;
  }

  private interactInPayHarbor = (): void => {
    if (this.harborDialogue || this.suspended || this.paymentBusy) return;
    const player = this.livingCity?.playerSnapshot();
    const mission = this.currentPayHarborMission();
    if (!player || !this.isNearBeaconAnchor(player, mission.targetAnchorId, 2.4)) {
      this.toolkit?.setDetail('Follow the pink target on the city map and move closer before acting.');
      return;
    }
    if (this.contractProgress.opened) {
      this.interactHarborContract();
      return;
    }
    if (this.lanternState.phase === 'street') {
      this.showHarborDialogue(this.conversations.start('mara-lantern', 'arrival'), () => this.advancePhysicalLantern({ type: 'enter-shop' }));
      return;
    }
    if (this.lanternState.phase === 'shop') return this.advancePhysicalLantern({ type: 'select-lantern' });
    if (this.lanternState.phase === 'selected' && this.selectedRole === 'builder') {
      this.input.setSystem('paused');
      this.startBuilderRepair();
      return;
    }
    if (this.lanternState.phase === 'selected') return this.reviewHarborInvoice();
    if ((this.lanternState.phase === 'review' || this.lanternState.phase === 'confirming') && this.lanternState.mode === 'practice') {
      return this.advancePhysicalLantern({ type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'practice-only', network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna, canonical: true, success: true, confirmations: LAST_LANTERN.minimumConfirmations } });
    }
    if (this.lanternState.phase === 'review') {
      void this.payWithNimiqPay();
      return;
    }
    if (this.lanternState.phase === 'confirming') {
      void this.reconcileLiveOrder();
      return;
    }
    if (this.lanternState.phase === 'verified') return this.advancePhysicalLantern({ type: 'fulfill-lantern' });
    if (this.lanternState.phase === 'fulfilled' && this.selectedRole === 'builder' && this.payHarborBuilderStation < 6) {
      this.payHarborBuilderStation += 1;
      this.saveLastLanternState();
      this.audio.playWorldCue('city-interaction');
      this.renderPayHarbor();
      return;
    }
    if (this.lanternState.phase === 'fulfilled') return this.advancePhysicalLantern({ type: 'reach-tower' });
    void this.returnToBeaconCommons();
  };

  private showHarborDialogue(display: AtlasConversationDisplay, onContinue: () => void, onChoose?: (choiceId: string) => void): void {
    this.input.setSystem('paused');
    this.input.clearJoystick();
    this.harborDialogue = {
      display,
      speakerName: 'Mara',
      continueLabel: this.contractProgress.opened ? 'Continue' : this.lanternState.phase === 'tower-lit' ? 'Explore the open harbor' : 'Find the lantern counter',
      onChoose: onChoose ?? ((choiceId) => this.showHarborDialogue(this.conversations.choose(choiceId), onContinue)),
      onContinue: () => {
        this.closeHarborDialogue();
        onContinue();
      },
    };
    this.audio.narrate(display.subtitle);
    this.renderPayHarbor();
  }

  private closeHarborDialogue(): void {
    this.harborDialogue = null;
    this.input.clearJoystick();
    this.input.setSystem(this.suspended ? 'paused' : 'active');
  }

  private reviewHarborInvoice(retry = false): void {
    const request = this.currentLanternRequest();
    this.showHarborDialogue(harborInvoiceLesson(request, retry), () => this.renderPayHarbor(), (choiceId) => {
      if (choiceId !== 'correct') {
        this.reviewHarborInvoice(true);
        return;
      }
      this.closeHarborDialogue();
      this.paymentNotice = 'One lantern, correct amount. Now check the recipient and network before approving.';
      this.advancePhysicalLantern({ type: 'review-request', request });
    });
  }

  private createCityPaymentReview(): HTMLElement | null {
    if (this.lanternState.phase !== 'review' && this.lanternState.phase !== 'confirming') return null;
    const request = this.currentLanternRequest();
    const fee = this.lanternState.mode === 'practice' ? '0 Lunas / practice' : 'Quoted by Nimiq Pay';
    const total = this.lanternState.mode === 'practice' ? `${request.valueLuna.toLocaleString()} Lunas` : 'Shown before approval';
    const review = element('dl', 'atlas-city-payment-review');
    review.setAttribute('aria-label', 'Exact payment fields');
    review.append(
      element('dt', '', 'NETWORK'), this.networkValueCell(request.network),
      element('dt', '', 'RECIPIENT'), element('dd', '', request.recipient),
      element('dt', '', 'AMOUNT'), element('dd', '', formatLanternAmount(request.valueLuna)),
      element('dt', '', 'FEE'), element('dd', '', fee),
      element('dt', '', 'TOTAL'), element('dd', '', total),
      element('dt', '', 'SAFETY'), element('dd', '', this.lanternState.phase === 'confirming'
        ? 'CHECKING / Atlas is verifying the payment on the network. Approval is not proof of delivery.'
        : 'Approval gives permission to request this payment. It does not prove the shop received NIM.'),
    );
    return review;
  }

  private networkValueCell(network: string): HTMLElement {
    const value = element('dd', 'atlas-payment-network');
    value.append(createNimiqMark('signet', { decorative: true }), element('span', '', network));
    return value;
  }

  private advancePhysicalLantern(action: LastLanternAction): void {
    try {
      replayLastLantern([action], this.lanternState);
      this.saveLastLanternState();
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      if (this.lanternState.phase === 'tower-lit') {
        this.progress.completeDistrict('pay-harbor');
        this.progress.completeTrial('last-lantern');
        if (!this.contractProgress.opened) this.saveHarborContracts({ ...this.contractProgress, opened: true });
      }
      this.presentPayHarborWorld();
      if (this.lanternState.phase === 'tower-lit' && action.type === 'reach-tower') {
        this.showHarborDialogue(this.conversations.start('mara-lantern', 'tower-lit'), () => this.openHarborBoard());
        return;
      }
      this.renderPayHarbor();
    } catch (error) {
      this.toolkit?.setDetail(error instanceof Error ? error.message : 'The harbor action could not continue.');
    }
  }

  private currentPayHarborMission() {
    return this.contractProgress.opened ? this.contractMission : projectPayHarborPhysicalMission(this.lanternState, this.payHarborBuilderStation);
  }

  private saveHarborContracts(next: HarborContractProgress): void {
    this.contractStore.save(next);
    this.contractProgress = this.contractStore.snapshot();
    this.contractMission = projectHarborContractMission(this.contractProgress);
  }

  private openHarborBoard(): void {
    if (!this.contractProgress.opened || this.suspended || this.paymentBusy) return;
    const current = activeHarborContract(this.contractProgress);
    const day = new Date().toISOString().slice(0, 10);
    const contracts = harborContractsForDay(day);
    const choices = current ? [
      { id: 'close', label: `Resume: ${current.title}` },
      { id: 'abandon', label: 'Put aside this job and choose another' },
    ] : [
      ...contracts.map((contract) => {
        const best = this.contractProgress.records.find((record) => record.id === contract.id);
        return { id: contract.kind, label: `${contract.title}${best ? ` / Best ${best.stars}/3 stars / Replay` : ''}` };
      }),
      { id: 'close', label: 'Keep exploring' },
    ];
    const subtitle = current ? `${current.title}. ${this.currentPayHarborMission().detail}` : `The harbor is open, but our neighbors still need help. Choose a job. Three stars for a first-try check; retry freely to learn. Supplies restored: ${this.contractProgress.stocked.length}/3. Daily orders use UTC. Free local practice: no payment or NIM reward.`;
    this.showHarborDialogue(harborContractDialogue(`${subtitle} ${this.contractStore.notice()}`.trim(), choices), () => this.renderPayHarbor(), (id) => {
      if (id === 'abandon') {
        this.saveHarborContracts({ ...this.contractProgress, active: null });
        this.presentPayHarborWorld();
        this.openHarborBoard();
        return;
      }
      if (id !== 'close') {
        const contract = contracts.find((candidate) => candidate.kind === id);
        if (!contract || this.contractProgress.active) return;
        this.saveHarborContracts(startHarborContract(this.contractProgress, day, contract.kind));
      }
      this.closeHarborDialogue();
      this.presentPayHarborWorld();
      this.renderPayHarbor();
    });
  }

  private interactHarborContract(): void {
    const contract = activeHarborContract(this.contractProgress);
    const run = this.contractProgress.active;
    if (!contract || !run) { this.openHarborBoard(); return; }
    if (run.step === 1) { this.reviewHarborContract(); return; }
    const stars = harborContractStars(run.mistakes);
    this.saveHarborContracts(advanceHarborContract(this.contractProgress, this.currentPayHarborMission().targetAnchorId));
    this.presentPayHarborWorld();
    this.audio.playWorldCue('city-interaction');
    if (run.step === 2) {
      const best = this.contractProgress.records.find((record) => record.id === contract.id)?.stars ?? stars;
      this.showHarborDialogue(harborContractDialogue(`${contract.outcome} ${stars}/3 stars this run. Personal best: ${best}/3. Supplies restored: ${this.contractProgress.stocked.length}/3. Local practice only. ${this.contractStore.notice()}`), () => this.openHarborBoard());
    } else this.renderPayHarbor();
  }

  private reviewHarborContract(retry = false): void {
    const contract = activeHarborContract(this.contractProgress);
    if (!contract || this.contractProgress.active?.step !== 1) return;
    this.showHarborDialogue(harborContractDialogue(`${retry ? `${contract.retry} ` : ''}${contract.question}`, [...contract.choices, { id: 'close', label: 'Check later' }]), () => this.renderPayHarbor(), (id) => {
      if (id === 'close') { this.closeHarborDialogue(); this.renderPayHarbor(); return; }
      const player = this.livingCity?.playerSnapshot();
      const target = this.currentPayHarborMission().targetAnchorId;
      if (!player || !this.isNearBeaconAnchor(player, target, 2.4)) { this.closeHarborDialogue(); this.renderPayHarbor(); return; }
      this.saveHarborContracts(advanceHarborContract(this.contractProgress, target, id));
      if (this.contractProgress.active?.step === 1) { this.reviewHarborContract(true); return; }
      this.closeHarborDialogue();
      this.presentPayHarborWorld();
      this.renderPayHarbor();
    });
  }

  private presentPayHarborWorld(): void {
    const mission = this.currentPayHarborMission();
    const restoration = mission.restoration;
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.livingCity?.setInteractionPresentation({
      districtId: 'pay-harbor',
      relayCarried: this.selectedRole === 'builder' && this.lanternState.phase === 'fulfilled',
      lanternCarried: this.lanternState.phase === 'fulfilled',
      builderStationIndex: this.payHarborBuilderStation,
      targetAnchorId: mission.targetAnchorId,
      harborCargo: this.contractProgress.active !== null && this.contractProgress.active.step > 0,
      harborStocked: this.contractProgress.stocked,
    });
    this.livingCity?.present(createPayHarborScene({ restoration, reducedMotion }).snapshot);
  }

  private async returnToBeaconCommons(): Promise<void> {
    const controller = this.livingCity;
    const assets = this.cityAssets;
    if (!controller || !assets) return;
    try {
      const scenePath = '/atlas/3d/v1/beacon-commons/scene.json';
      const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
      await controller.activateDistrict('beacon-commons');
      controller.setInteractionPresentation(undefined);
      controller.setPlayerRole(this.selectedRole);
      controller.setNavigation(livingCityNavigation(scene));
      controller.present(projectLivingWorld(BEACON_CORE_WORLD, createAtlasState(BEACON_CORE_WORLD.mission), 'waiting'));
      this.beaconScene = scene;
      this.cityQuestStep = 'meet-guide';
      this.screen = 'beacon-commons';
      this.renderBeaconCommons();
    } catch {
      this.toolkit?.setDetail('Beacon Commons is temporarily unavailable. Your Pay Harbor progress is already saved.');
    }
  }

  private ensureLivingCity(): Promise<void> {
    if (this.livingCity) return Promise.resolve();
    if (!this.livingCityInit) this.livingCityInit = this.initializeLivingCity().finally(() => { this.livingCityInit = null; });
    return this.livingCityInit;
  }

  private async initializeLivingCity(): Promise<void> {
    const { createAtlasRenderer } = await import('../render/scene-graph');
    const response = await fetch('/atlas/manifests/assets-v2.json', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('The verified Beacon Commons asset manifest is unavailable.');
    const manifest = parseAtlasAssetManifest(await response.json());
    if (manifest.version !== 2) throw new Error('The Beacon Commons asset manifest is outdated.');
    const assets = createAtlasAssetManager({ load: async () => undefined, unload: async () => undefined }, { manifest, expectedManifestVersion: 2 });
    this.cityAssets = assets;
    const scenePath = '/atlas/3d/v1/beacon-commons/scene.json';
    const scene = parseAtlasCityScene(JSON.parse(new TextDecoder().decode(await assets.loadBytes(scenePath))) as unknown);
    this.beaconScene = scene;
    const host = document.createElement('div');
    host.id = 'atlas-city-stage';
    host.setAttribute('aria-hidden', 'true');
    (this.ui.parentElement ?? document.body).append(host);
    this.runtimeStats?.attach(this.ui.parentElement ?? document.body);
    const renderer = createAtlasRenderer();
    const controller = new AtlasLivingCityController({
      renderer,
      daySeed: new Date().toISOString().slice(0, 10),
      navigation: livingCityNavigation(scene),
      sampleMovement: () => {
        const action = this.input.sample();
        if (this.suspended || (this.screen === 'pay-harbor' && this.harborDialogue)) return { moveX: 0, moveY: 0 };
        return { moveX: action.moveX, moveY: action.moveY, run: action.run };
      },
      onFrame: ({ player }) => {
        this.runtimeStats?.sample(performance.now(), controller.stats(), controller.qualityTier());
        this.updateBeaconMap(player);
        this.observeFreePlay(player);
        this.observeTutorial(player);
      },
      /*
       * Derived from the current screen, not from a flag each screen has to
       * remember to clear.
       *
       * The first version cleared orbitStartedAt in screenPanel, which the two
       * play shells deliberately do not call — so after visiting the welcome
       * screen the camera kept orbiting during play, overriding player-follow
       * and leaving it pointed at empty ground. Gating on the screen makes the
       * whole class of mistake impossible.
       */
      idleHeading: () => {
        if (this.screen !== 'welcome' || this.orbitStartedAt === null) return null;
        return this.orbit.headingAt((performance.now() - this.orbitStartedAt) / 1_000);
      },
    });
    try {
      await renderer.initialize(host, {
        onPlayerFootstep: () => { if (this.isLivingCityScreen() && !this.suspended) this.audio.playWorldCue('city-footstep'); },
        preferredRenderer: new URLSearchParams(location.search).get('renderer') === 'canvas' ? 'canvas' : new URLSearchParams(location.search).get('renderer') === 'pixi' ? 'pixi' : undefined,
        reducedMotion: this.cityReducedMotion,
        resolution: 1,
        // Cap the backing store at 2x. Below the device ratio the city is
        // upscaled and reads as blurry; above it costs pixels nobody sees.
        qualityTier: 'balanced',
        maxPixelRatio: 2,
        assetManager: assets,
      });
      await controller.activateDistrict('beacon-commons');
      controller.present(projectLivingWorld(BEACON_CORE_WORLD, createAtlasState(BEACON_CORE_WORLD.mission), 'waiting'));
      controller.resize(Math.max(1, host.clientWidth), Math.max(1, host.clientHeight), 1);
      controller.start();
      if (this.suspended) controller.pause();
      if (this.screen !== 'welcome' && this.screen !== 'beacon-commons') {
        await controller.destroy();
        host.remove();
        return;
      }
      this.livingCityHost = host;
      this.livingCity = controller;
    } catch (error) {
      await controller.destroy().catch(() => undefined);
      this.cityAssets = null;
      host.remove();
      throw error;
    }
  }

  private async stopLivingCity(): Promise<void> {
    const controller = this.livingCity;
    const host = this.livingCityHost;
    this.livingCity = null;
    this.livingCityHost = null;
    this.cityAssets = null;
    this.beaconScene = null;
    this.beaconMapSvg = null;
    this.beaconMapPlayer = null;
    this.beaconMapTarget = null;
    this.cityWaypointLabel = null;
    this.cityWaypointDistance = null;
    await controller?.destroy();
    host?.remove();
  }

  /*
   * Screenshot capture entry.
   *
   * The guide images in docs/shots and public/atlas/screenshots are produced by
   * scripts/shoot-atlas.mjs, and two of them document the lantern screen, which
   * is reachable only by walking to Mara in the 3D city. The capture used to
   * assume one click from home reached it; that stopped being true when the
   * welcome screen was given a single primary action pointing at Beacon
   * Commons, and the capture has been failing there ever since.
   *
   * Asking for the screen directly is honest about what the tool needs, and
   * cheaper than teaching a screenshot script to play the game. main.ts only
   * hands this out when the page is opened with ?capture=1.
   */
  openLanternForCapture(): void {
    this.startLantern();
  }

  openPaymentReviewForCapture(): void {
    this.startLantern();
    this.maraConversation = null;
    this.lanternState = createLastLanternState(this.selectedRole, 'practice');
    const request = this.currentLanternRequest();
    replayLastLantern([
      { type: 'enter-shop' },
      { type: 'select-lantern' },
      { type: 'review-request', request },
    ], this.lanternState);
    this.audio.setState({ phase: this.lanternState.phase });
    this.renderLantern();
  }

  openBeaconCommonsForCapture(): void {
    this.openBeaconCommons();
  }

  openDailyForCapture(): void {
    this.openDailyPuzzle();
  }

  openDistrictAtlasForCapture(): void {
    this.openEvergreen();
  }

  openCoreRunForCapture(): void {
    this.openCoreRun();
  }

  private startLantern = (): void => {
    void this.stopLivingCity();
    this.canvas.hidden = false;
    this.audio.unlock();
    const lanternMode = this.paymentConfig.enabled ? 'live' : 'practice';
    this.lanternState = this.readLastLanternState(lanternMode) ?? createLastLanternState(this.selectedRole, lanternMode);
    this.audio.setState({ phase: this.lanternState.phase });
    this.paymentNotice = this.lanternState.phase === 'confirming' && lanternMode !== 'practice'
      ? 'A submitted payment was restored safely. Atlas is checking the network; no second approval is needed.'
      : '';
    this.liveOrderId = null;
    this.liveLookup = null;
    this.paymentController = this.paymentConfig.enabled ? this.createPaymentController() : null;
    this.restorePaymentJourney();
    this.screen = 'lantern';
    this.maraConversation = this.conversations.start('mara-lantern', 'arrival');
    this.renderLantern();
  };

  private createPaymentController(): AtlasPaymentController {
    const request = this.currentLanternRequest();
    if (!this.paymentConfig.enabled || request.network !== 'testalbatross' || request.recipient === LAST_LANTERN.recipient) throw new Error('A real TestAlbatross recipient is required for live payment.');
    const paymentRequest = { ...request, network: 'testalbatross' as const };
    return new AtlasPaymentController({
      actorId: this.sessionActorId,
      request: paymentRequest,
      wallet: this.wallet,
      api: this.api,
      minimumConfirmations: LAST_LANTERN.minimumConfirmations,
      persistence: createPaymentPersistence(safeStorage(), `sface-atlas-payment:${this.sessionActorId}:${request.itemId}`),
    });
  }

  private restorePaymentJourney(): void {
    const state = this.paymentController?.state;
    if (!state || !state.orderId || !state.lookup || !['confirming', 'verified', 'fulfilled'].includes(state.status)) return;
    const request = this.currentLanternRequest();
    const recoveryActions: LastLanternAction[] = this.lanternState.phase === 'street'
      ? [{ type: 'enter-shop' }, { type: 'select-lantern' }, { type: 'review-request', request }, { type: 'await-evidence' }]
      : this.lanternState.phase === 'shop'
        ? [{ type: 'select-lantern' }, { type: 'review-request', request }, { type: 'await-evidence' }]
        : this.lanternState.phase === 'selected'
          ? [{ type: 'review-request', request }, { type: 'await-evidence' }]
          : this.lanternState.phase === 'review' ? [{ type: 'await-evidence' }] : [];
    if (recoveryActions.length > 0) {
      replayLastLantern(recoveryActions, this.lanternState);
      this.saveLastLanternState();
    }
    if (this.lanternState.phase !== 'confirming') return;
    this.liveOrderId = state.orderId;
    this.liveLookup = state.lookup;
    this.paymentNotice = 'A submitted payment was restored safely. Atlas will re-check canonical evidence before unlocking the harbor.';
  }

  private saveLastLanternState(): void {
    const storage = safeStorage();
    try {
      storage.setItem(lastLanternStorageKey(this.sessionActorId, this.selectedRole, this.lanternState.mode), JSON.stringify(serializeLastLanternState(this.lanternState)));
      storage.setItem(builderStationStorageKey(this.sessionActorId, this.selectedRole, this.lanternState.mode), String(this.payHarborBuilderStation));
    } catch {
      // Mission authority remains in memory when browser storage is unavailable.
    }
  }

  private readLastLanternState(mode: LastLanternState['mode']): LastLanternState | null {
    try {
      const raw = safeStorage().getItem(lastLanternStorageKey(this.sessionActorId, this.selectedRole, mode));
      return raw ? recoverLastLanternState(JSON.parse(raw) as unknown, this.selectedRole, mode) : null;
    } catch {
      return null;
    }
  }

  private readBuilderStation(): number {
    try {
      const value = Number.parseInt(safeStorage().getItem(builderStationStorageKey(this.sessionActorId, this.selectedRole, this.lanternState.mode)) ?? '', 10);
      return Number.isSafeInteger(value) ? Math.max(0, Math.min(6, value)) : 0;
    } catch {
      return 0;
    }
  }

  private openKnowledgeBook = (): void => {
    void this.stopLivingCity();
    this.screen = 'book';
    this.bookOpen = true;
    this.teachBackStep = 0;
    this.teachBackNotice = '';
    this.renderKnowledgeBook();
  };

  private openDailyPuzzle = (): void => {
    void this.stopLivingCity();
    this.screen = 'daily';
    this.dailyNotice = '';
    this.dailyCompletedDate = readDailyCompletedDate();
    this.dailyServerResult = null;
    this.dailyObligation = null;
    void this.refreshDailyStanding();
    const dispatch = selectAtlasHubDispatch(new Date());
    const chapter = getAtlasStoryChapter(dispatch.chapterId);
    if (chapter) {
      this.audio.unlock();
      this.audio.narrateLine({ ...chapter.voice.arrival, text: `${dispatch.hook} ${chapter.voice.arrival.text}` });
    }
    this.renderDailyPuzzle();
  };

  private openCoreRun = (): void => {
    void this.stopLivingCity();
    this.screen = 'core-run';
    this.canvas.hidden = false;
    this.coreRun.reset();
    this.atlasCompetitiveTicket = null;
    this.coreRunActorId = this.atlasWalletBinding?.actorId ?? null;
    this.coreRunId = createAtlasClientRunId();
    this.renderCoreRun();
  };

  private advanceCoreRun = (): void => {
    const view = this.coreRun.state();
    if (view.phase !== 'running') return;
    this.coreRun.step(nextCoreRunAction(view));
    this.renderCoreRun();
  };

  private bindCoreRunWallet = async (): Promise<void> => {
    if (this.walletBindingBusy || this.atlasWalletBinding) return;
    const seasonId = import.meta.env.VITE_ATLAS_COMPETITIVE_SEASON_ID ?? '';
    if (!/^[a-z0-9-]{1,80}$/.test(seasonId)) {
      this.walletBindingNotice = 'Competitive season identity is not configured on this deployment yet. Your local run remains playable.';
      this.renderCoreRun();
      return;
    }
    this.walletBindingBusy = true;
    this.walletBindingNotice = 'Opening Nimiq Pay for an identity signature. No NIM payment will be requested.';
    this.renderCoreRun();
    try {
      const initialized = await this.wallet.initialize();
      if (!initialized.ok) {
        this.walletBindingNotice = initialized.reason === 'timeout' ? 'Nimiq Pay took too long to respond. Try Connect wallet again.' : 'Nimiq Pay is unavailable. Try Connect wallet again.';
        return;
      }
      const credential = await getOrCreateCredential();
      this.coreRunActorId = credential.playerId;
      const result = await this.walletBinding.bind({ actorId: credential.playerId, seasonId, network: 'testalbatross' });
      if (result.ok) {
        this.atlasWalletBinding = result.value;
        this.atlasCompetitiveTicket = null;
        this.walletBindingNotice = 'Wallet identity bound for this season. The next step is requesting a server competitive ticket.';
      } else {
        this.walletBindingNotice = result.error;
      }
    } catch (error) {
      this.walletBindingNotice = error instanceof Error ? error.message : 'Wallet identity binding could not be completed.';
    } finally {
      this.walletBindingBusy = false;
      this.renderCoreRun();
    }
  };

  private requestCoreRunTicket = async (): Promise<void> => {
    if (this.atlasCompetitiveTicketBusy || !this.atlasWalletBinding || !this.coreRunActorId) return;
    this.atlasCompetitiveTicketBusy = true;
    this.walletBindingNotice = 'Requesting a server ticket for this completed replay...';
    this.renderCoreRun();
    try {
      const response = await this.api.issueCompetitiveTicket({ actorId: this.coreRunActorId, walletAddress: this.atlasWalletBinding.address, role: this.selectedRole });
      if (response.ok) {
        this.atlasCompetitiveTicket = response.value;
        this.walletBindingNotice = 'Server ticket issued. Submit this completed replay for authoritative verification.';
      } else this.walletBindingNotice = response.error;
    } catch (error) {
      this.walletBindingNotice = error instanceof Error ? error.message : 'The server ticket could not be requested.';
    } finally {
      this.atlasCompetitiveTicketBusy = false;
      this.renderCoreRun();
    }
  };

  private submitCoreRun = async (): Promise<void> => {
    if (!this.atlasCompetitiveTicket || !this.atlasWalletBinding || !this.coreRunActorId) return;
    await this.coreRun.submit({ ticket: this.atlasCompetitiveTicket, runId: this.coreRunId, actorId: this.coreRunActorId, walletAddress: this.atlasWalletBinding.address, role: this.selectedRole, origin: window.location.origin });
    this.renderCoreRun();
  };

  private renderCoreRun(): void {
    this.ui.replaceChildren();
    const view = this.coreRun.state();
    this.canvas.hidden = false;
    this.renderer.drawDistrict('genesis-garden', view.phase === 'completed');
    const panel = this.screenPanel('atlas-core-run');
    panel.setAttribute('aria-label', 'Atlas verified core run');
    panel.append(
      this.screenNav('Core run'),
      element('p', 'atlas-eyebrow', 'VERIFIED CORE RUN / GENESIS GARDEN'),
      element('h1', '', view.phase === 'completed' ? 'The district is alive.' : 'Restore the relay line.'),
      element('p', 'atlas-trial-copy', 'Use the right Nimiq action at each landmark. Your inputs are recorded and replayed through the same rules the server will verify.'),
      element('p', 'atlas-book-sequence', `STEP ${Math.min(view.actions + 1, 22)} OF 22 / ${view.actions} ACTIONS / LOCAL SCORE ${view.score}`),
    );

    const objective = element('section', 'atlas-core-objective');
    objective.setAttribute('aria-label', 'Current core run objective');
    objective.append(
      element('strong', '', coreRunObjective(view)),
      element('p', '', coreRunDetail(view)),
    );
    panel.append(objective);

    const rail = element('ol', 'atlas-core-rail');
    for (const step of coreRunSteps(view)) {
      const item = element('li', `atlas-core-step${step.complete ? ' is-complete' : step.current ? ' is-current' : ''}`);
      item.append(element('span', 'atlas-core-step-mark', step.complete ? '✓' : step.current ? '→' : '·'), element('span', '', step.label));
      rail.append(item);
    }
    panel.append(rail);

    const actions = element('div', 'atlas-core-actions');
    const next = actionButton(view.phase === 'completed' ? 'Run complete' : coreRunActionLabel(view), this.advanceCoreRun, coreRunActionLabel(view));
    next.disabled = view.phase !== 'running';
    next.classList.add('atlas-start');
    const reset = ghostButton('Restart run', () => { this.coreRun.reset(); this.renderCoreRun(); }, 'Restart the Atlas core run');
    actions.append(next, reset);
    panel.append(actions);

    if (view.phase === 'completed') {
      const proof = element('section', 'atlas-core-proof');
      proof.append(
        element('strong', '', view.submission === 'verified' ? 'SERVER VERIFIED' : 'LOCAL RUN COMPLETE'),
        element('p', '', view.submission === 'verified' ? view.notice : 'The replay is complete on this device. Bind a wallet identity before a score can enter the verified board or qualify for rewards.'),
      );
      if (view.result) proof.append(element('p', 'atlas-core-proof-score', `VERIFIED SCORE ${view.result.run.score} / ${view.result.run.role.toUpperCase()}`));
      if (this.atlasWalletBinding) {
        proof.append(element('p', 'atlas-builder-success', `WALLET BOUND / ${this.atlasWalletBinding.address}`));
        if (this.atlasCompetitiveTicket) {
          proof.append(element('p', 'atlas-quiet', `SERVER TICKET READY / ${this.atlasCompetitiveTicket.ticketId.slice(0, 12)}…`));
          const submit = actionButton(view.submission === 'submitting' ? 'Submitting replay...' : view.submission === 'verified' ? 'Replay verified' : 'Submit completed replay', this.submitCoreRun, 'Submit the completed core replay for server verification');
          submit.disabled = view.submission === 'submitting' || view.submission === 'verified';
          proof.append(submit);
        } else {
          const ticket = actionButton(this.atlasCompetitiveTicketBusy ? 'Requesting server ticket...' : 'Request competitive ticket', this.requestCoreRunTicket, 'Request a server ticket for the completed core replay');
          ticket.disabled = this.atlasCompetitiveTicketBusy;
          proof.append(ticket);
        }
      } else {
        const bind = actionButton(this.walletBindingBusy ? 'Waiting for wallet...' : 'Connect Nimiq wallet identity', this.bindCoreRunWallet, 'Connect Nimiq Pay and sign the Atlas identity challenge');
        bind.disabled = this.walletBindingBusy;
        proof.append(bind);
      }
      if (this.walletBindingNotice) {
        const noticeIsSuccess = this.walletBindingNotice.includes('bound') || this.walletBindingNotice.includes('issued') || this.walletBindingNotice.includes('verified');
        proof.append(element('p', noticeIsSuccess ? 'atlas-builder-success' : 'atlas-quiet', this.walletBindingNotice));
      }
      panel.append(proof);
    }
    this.ui.append(panel);
  }

  /**
   * What the day's pot is worth, read from the server.
   *
   * Failure is quiet on purpose: the daily puzzle is playable offline and a
   * standing that cannot be read should cost the player the reward panel, not
   * the puzzle. `dailyStanding` staying null is what the render treats as
   * "unknown", and it never invents a number to fill the gap.
   */
  private async refreshDailyStanding(): Promise<void> {
    if (this.dailyStandingBusy) return;
    this.dailyStandingBusy = true;
    try {
      this.dailyStanding = await this.api.getDailyStanding();
    } catch {
      this.dailyStanding = null;
    } finally {
      this.dailyStandingBusy = false;
      if (this.screen === 'daily') this.renderDailyPuzzle();
    }
  }

  /**
   * Ask the server whether today's answer qualifies this wallet.
   *
   * The body is the player's claim; eligibility is the server's finding. A
   * refusal comes back as a normal 200 with a reason, so it is rendered as an
   * answer rather than as a failure.
   */
  private async submitDailyToServer(challenge: AtlasDailyChallenge, answer: string): Promise<void> {
    const walletAddress = this.atlasWalletBinding?.address;
    if (!walletAddress) {
      this.dailyNotice = 'Correct. Connect your Nimiq wallet to claim a share of today’s pool — the answer alone cannot be paid to anyone.';
      this.renderDailyPuzzle();
      return;
    }
    if (this.dailySubmitBusy) return;
    this.dailySubmitBusy = true;
    this.dailyNotice = 'Correct. Asking the server to verify today’s run...';
    this.renderDailyPuzzle();
    try {
      const result = await this.api.submitDaily({
        actorId: this.sessionActorId,
        walletAddress,
        challengeId: challenge.id,
        answer,
        replayComplete: true,
        assistance: 'none',
      });
      this.dailyServerResult = result;
      this.dailyNotice = describeDailyResult(result);
      if (result.eligible) {
        // Re-read both, because this submission may have changed the split.
        this.dailyObligation = await this.api
          .getDailyObligation({ actorId: this.sessionActorId, walletAddress, challengeId: challenge.id })
          .catch(() => null);
        void this.refreshDailyStanding();
      }
    } catch {
      this.dailyNotice = 'Your answer is correct, but the server could not be reached. Your local progress is kept; try again to claim a share.';
    } finally {
      this.dailySubmitBusy = false;
      if (this.screen === 'daily') this.renderDailyPuzzle();
    }
  }

  private renderDailyPuzzle(): void {
    this.ui.replaceChildren();
    const challenge = selectDailyChallenge(new Date());
    const dispatch = selectAtlasHubDispatch(new Date());
    const today = dailyDateKey(new Date());
    const completedToday = this.dailyCompletedDate === today;
    const panel = this.screenPanel('atlas-daily');
    panel.setAttribute('aria-label', 'Daily Atlas puzzle');
    panel.append(
      this.screenNav('Daily puzzle'),
      element('p', 'atlas-eyebrow', 'DAILY ATLAS PUZZLE'),
      element('h1', '', challenge.title),
      element('p', 'atlas-story-kicker', `${ATLAS_STORY.hubName.toUpperCase()} / FIELD JOB`),
      element('p', 'atlas-story-hook', dispatch.hook),
      element('p', 'atlas-trial-copy', dispatch.objective),
      element('p', 'atlas-quiet', dispatch.lesson),
      element('p', 'atlas-book-sequence', `DAY ${challenge.day} OF 28 / ${challenge.theme.toUpperCase()} / LEARN / SOLVE / VERIFY`),
      element('p', 'atlas-trial-copy', challenge.prompt),
      element('p', 'atlas-lantern-mode', dispatch.rewardCopy),
      element('p', completedToday ? 'atlas-builder-success' : 'atlas-lantern-mode', completedToday
        ? 'TODAY\'S DISPATCH COMPLETE / COME BACK TOMORROW FOR A NEW FIELD JOB'
        : 'ONE DAILY DISPATCH / LEARN ONE RULE / RETURN TOMORROW'),
      element('p', 'atlas-lantern-mode', 'FREE CORE / LOCAL PRACTICE / SERVER VERIFICATION REQUIRED FOR REWARDS'),
    );
    const choices = element('div', 'atlas-daily-choices');
    for (const answer of dailyChallengeChoices(challenge)) {
      const choice = actionButton(formatDailyChoice(answer), () => {
        if (this.dailyCompletedDate === today) return;
        if (answer !== challenge.answer) {
          this.dailyNotice = dailyRetryHint(challenge);
          this.renderDailyPuzzle();
          return;
        }
        this.dailyCompletedDate = today;
        writeDailyCompletedDate(today);
        const dispatch = selectAtlasHubDispatch(new Date());
        const chapter = getAtlasStoryChapter(dispatch.chapterId);
        if (chapter) this.audio.narrateLine(chapter.voice.completion);
        // The screen promised a reward "after server verification" and never
        // asked the server. Now it does.
        void this.submitDailyToServer(challenge, answer);
      }, `Answer ${formatDailyChoice(answer)}`);
      choice.disabled = completedToday || this.dailySubmitBusy;
      choices.append(choice);
    }
    panel.append(choices);
    if (this.dailyNotice) panel.append(element('p', dailyNoticeTone(this.dailyNotice), this.dailyNotice));
    /*
     * The claim is a separate affordance from the answer.
     *
     * Answering correctly disables the choices for the rest of the day, so a
     * player who answered before connecting a wallet — or who answered while
     * the server was unreachable — would otherwise have no way to ever claim
     * the share the screen just promised them. This is that way.
     */
    const verified = this.dailyServerResult?.eligible === true;
    if (completedToday && !verified) {
      const claim = actionButton(
        this.dailySubmitBusy ? 'Checking with the server...' : this.atlasWalletBinding ? 'Claim today’s share' : 'Connect wallet to claim today’s share',
        () => {
          if (this.atlasWalletBinding) void this.submitDailyToServer(challenge, challenge.answer);
          else void this.bindCoreRunWallet();
        },
        'Claim a share of today’s pool',
      );
      claim.disabled = this.dailySubmitBusy || this.walletBindingBusy;
      panel.append(claim);
    }
    panel.append(this.dailyRewardPanel());
    this.ui.append(panel);
  }

  /**
   * The day's pot, as the server reports it.
   *
   * Every number here is live mainnet: this is the one place a judge can see
   * real money before playing to the lantern. It says "unavailable" rather
   * than guessing, and it never shows a share when the treasury cannot pay it.
   */
  private dailyRewardPanel(): HTMLElement {
    const panel = element('div', 'atlas-daily-reward');
    panel.append(element('p', 'atlas-eyebrow', 'TODAY’S POOL / NIMIQ MAINNET'));
    const standing = this.dailyStanding;
    if (!standing) {
      panel.append(element('p', 'atlas-quiet', this.dailyStandingBusy
        ? 'Reading today’s pool from the network...'
        : 'Today’s pool is unavailable right now. The puzzle still plays; the share cannot be quoted until the server answers.'));
      return panel;
    }
    if (!standing.rewardsEnabled) {
      panel.append(element('p', 'atlas-quiet', 'No pool is funded today, so no share is owed. Atlas says so rather than showing a number nothing can pay.'));
      return panel;
    }
    panel.append(
      element('p', 'atlas-lantern-mode', `POOL ${formatLuna(standing.poolLuna)} / ${standing.eligibleCount} QUALIFIED TODAY`),
      element('p', 'atlas-trial-copy', standing.shareLuna === null
        ? 'No wallet has qualified yet today. Answer correctly with a connected wallet and the pool is yours to share.'
        : `If the day closed now, each qualifying wallet receives ${formatLuna(standing.shareLuna)}.`),
    );
    /*
     * Shown only when the treasury is the binding constraint. Telling a player
     * the pot shrank without telling them why reads as the product losing
     * money; telling them the treasury balance is the cap is the honest version.
     */
    const configured = standing.configuredPoolLuna;
    if (typeof configured === 'number' && standing.poolLuna !== null && configured > standing.poolLuna) {
      panel.append(element('p', 'atlas-quiet', `Today’s pool is capped by the treasury balance: ${formatLuna(standing.poolLuna)} of a ${formatLuna(configured)} target.`));
    }
    if (this.dailyObligation?.status === 'pending-close' && this.dailyObligation.amountLuna !== null) {
      panel.append(element('p', 'atlas-builder-success', `You qualified. ${formatLuna(this.dailyObligation.amountLuna)} is owed to your wallet at the close of the day.`));
    }
    if (!this.atlasWalletBinding) {
      panel.append(element('p', 'atlas-quiet', 'A share is paid to a wallet, so a wallet has to be connected before the answer counts.'));
    }
    return panel;
  }

  private openEvergreen = (): void => {
    void this.stopLivingCity();
    this.screen = 'evergreen';
    this.evergreenAdventure = ATLAS_EVERGREEN_ADVENTURES[0]!;
    this.evergreenActions = [];
    this.evergreenState = replayEvergreenAdventure(this.evergreenAdventure, []);
    this.evergreenNotice = '';
    const chapter = getAtlasStoryChapter(this.evergreenAdventure.districtId);
    if (chapter) {
      this.audio.unlock();
      this.audio.narrateLine(chapter.voice.arrival);
    }
    this.renderEvergreen();
  };

  private chooseEvergreen = (adventure: EvergreenAdventure): void => {
    this.evergreenAdventure = adventure;
    this.evergreenActions = [];
    this.evergreenState = replayEvergreenAdventure(adventure, []);
    this.evergreenNotice = '';
    const chapter = getAtlasStoryChapter(adventure.districtId);
    if (chapter) {
      this.audio.unlock();
      this.audio.narrateLine(chapter.voice.arrival);
    }
    this.renderEvergreen();
  };

  private advanceEvergreen = (action: EvergreenAction): void => {
    try {
      const actions = [...this.evergreenActions, action];
      this.evergreenState = replayEvergreenAdventure(this.evergreenAdventure, actions);
      this.evergreenActions = actions;
      this.evergreenNotice = '';
      if (this.evergreenState.phase === 'completed' && this.evergreenActions.length > 0) {
        const chapter = getAtlasStoryChapter(this.evergreenAdventure.districtId);
        if (chapter) this.audio.narrateLine(chapter.voice.completion);
      }
    } catch (error) {
      this.evergreenNotice = action.type === 'teach-back'
        ? 'That rule does not explain this consequence yet. Revisit what changed in the district and try again.'
        : error instanceof Error ? error.message : 'That district step could not continue.';
    }
    this.renderEvergreen();
  };

  private renderEvergreen(): void {
    this.ui.replaceChildren();
    this.renderer.drawDistrict(this.evergreenAdventure.districtId, this.evergreenState.phase === 'completed');
    const panel = this.screenPanel('atlas-evergreen');
    panel.setAttribute('aria-label', 'Evergreen District Atlas');
    const chapter = getAtlasStoryChapter(this.evergreenAdventure.districtId);
    panel.append(
      this.screenNav('District Atlas'),
      element('p', 'atlas-eyebrow', 'DISTRICT ATLAS / EVERGREEN ADVENTURES'),
      element('h1', '', 'Walk the living network'),
      ...(chapter ? [element('p', 'atlas-story-kicker', `CHAPTER ${chapter.chapter} / ${chapter.title.toUpperCase()}`), element('p', 'atlas-story-hook', chapter.storyBeat)] : []),
      element('p', 'atlas-trial-copy', 'Meet a human need, use a Nimiq concept in the world, see the consequence, then teach the rule back without the Book.'),
      element('p', 'atlas-book-sequence', 'ENCOUNTER / ACT / CONSEQUENCE / TRANSFER / TEACH-BACK'),
    );
    const map = element('div', 'atlas-district-tabs');
    for (const adventure of ATLAS_EVERGREEN_ADVENTURES) {
      const selected = adventure.id === this.evergreenAdventure.id;
      const tab = actionButton(adventure.districtId.replace(/-/g, ' '), () => this.chooseEvergreen(adventure), `Enter ${adventure.title}`);
      tab.className = `atlas-district-tab${selected ? ' is-selected' : ''}`;
      tab.setAttribute('aria-pressed', String(selected));
      map.append(tab);
    }
    panel.append(map);
    const adventure = this.evergreenAdventure;
    const journey = element('div', 'atlas-evergreen-journey');
    journey.append(element('p', 'atlas-trial-context', `${adventure.title.toUpperCase()} / ${this.evergreenState.phase.toUpperCase()}`), element('p', 'atlas-human-need', adventure.humanNeed), element('p', 'atlas-trial-copy', chapter?.mission ?? adventure.problem), element('p', 'atlas-quiet', chapter?.clue ?? ''), element('p', 'atlas-builder-boundary', `VISIBLE CONSEQUENCE: ${this.evergreenState.consequence} ${adventure.consequence.visible}`));
    if (this.evergreenState.phase === 'arrival') {
      journey.append(actionButton('Observe the problem', () => this.advanceEvergreen({ type: 'observe' }), 'Observe the district problem'));
    } else if (this.evergreenState.phase === 'observed') {
      journey.append(element('p', 'atlas-evergreen-role', this.selectedRole === 'builder' ? `BUILDER MIRROR: ${adventure.builderMirror}` : `EXPLORER ACTION: ${adventure.explorerAction}`));
      journey.append(actionButton(this.selectedRole === 'builder' ? 'Run Builder repair' : 'Take Explorer action', () => this.advanceEvergreen({ type: 'act', role: this.selectedRole }), `Run ${this.selectedRole} action`));
    } else if (this.evergreenState.phase === 'acted') {
      const step = this.evergreenState.teachBack.length + 1;
      journey.append(element('p', 'atlas-evergreen-role', `TRANSFER / TEACH-BACK ${step} OF ${adventure.teachBack.length}: choose the rule the consequence demonstrated.`));
      const choices = element('div', 'atlas-evergreen-choices');
      for (const choice of evergreenTeachBackChoices(adventure, this.evergreenState.teachBack.length)) {
        choices.append(actionButton(choice.toUpperCase(), () => this.advanceEvergreen({ type: 'teach-back', answer: choice }), `Teach back ${choice}`));
      }
      journey.append(choices);
    } else {
      journey.append(element('div', 'atlas-builder-success', `DISTRICT RESTORED / ${adventure.consequence.after}`), element('p', 'atlas-story-reveal', chapter?.reveal ?? ''), element('p', 'atlas-quiet', 'This local seal records learning only. Server verification is required before any score, rank, or reward claim.'));
    }
    if (this.evergreenNotice) journey.append(element('p', 'atlas-lantern-error', this.evergreenNotice));
    panel.append(journey, actionButton('Open Living Knowledge Book', this.openKnowledgeBook, 'Open Living Knowledge Book'));
    this.ui.append(panel);
  }

  private closeBookForTeachBack = (): void => {
    this.bookOpen = false;
    this.teachBackStep = 0;
    this.teachBackNotice = '';
    this.renderKnowledgeBook();
  };

  private collectKnowledge = (id: string): void => {
    this.knowledgeState = unlockKnowledgeFragment(this.knowledgeState, id);
    this.renderKnowledgeBook();
  };

  private answerTeachBack = (id: string): void => {
    const expected = ATLAS_KNOWLEDGE_BOOK.teachBackOrder[this.teachBackStep];
    if (id !== expected) {
      this.teachBackNotice = 'That answer skips an authority boundary. The Book is closed, so reason from the harbor journey.';
      this.renderKnowledgeBook();
      return;
    }
    this.teachBackStep += 1;
    this.teachBackNotice = '';
    if (this.teachBackStep === ATLAS_KNOWLEDGE_BOOK.teachBackOrder.length) {
      const result = gradeKnowledgeTeachBack([...ATLAS_KNOWLEDGE_BOOK.teachBackOrder]);
      if (result.correct) this.progress.completeTrial('knowledge-teach-back');
      this.teachBackNotice = 'Teach-back complete. You rebuilt Ask, Check, Approve, Confirm, Unlock without the Book.';
    }
    this.renderKnowledgeBook();
  };

  private renderKnowledgeBook(): void {
    this.ui.replaceChildren();
    const bookView = createAtlasKnowledgeBookView(ATLAS_KNOWLEDGE_BOOK, this.knowledgeState, this.bookOpen ? 'open' : 'closed');
    const panel = this.screenPanel('atlas-book');
    panel.setAttribute('aria-label', 'Living Knowledge Book');
    panel.append(
      this.screenNav('Knowledge Book'),
      element('p', 'atlas-eyebrow', 'LIVING KNOWLEDGE BOOK'),
      element('h1', '', 'Carry the rules, not the jargon'),
      element('p', 'atlas-trial-copy', 'Fragments are tools for the adventure. Learn a rule, use it in a route, then close the Book and teach it back.'),
      element('p', 'atlas-book-sequence', 'ASK / CHECK / APPROVE / CONFIRM / UNLOCK'),
      element('p', 'atlas-lantern-mode', this.bookOpen ? 'FREE CORE / NO PRIZE ADVANTAGE' : 'BOOK CLOSED / TEACH-BACK'),
    );
    if (this.bookOpen) {
      panel.append(element('p', 'atlas-book-progress', `${bookView.carriedFragmentIds.length} OF ${ATLAS_KNOWLEDGE_BOOK.fragments.length} FRAGMENTS CARRIED / ${bookView.availableReferenceIds.length} READY FOR LATER PUZZLES`));
      const list = element('div', 'atlas-book-list');
      for (const fragment of ATLAS_KNOWLEDGE_BOOK.fragments) {
        const card = document.createElement('details');
        card.className = 'atlas-book-card atlas-fragment-details';
        const collected = this.knowledgeState.fragmentIds.includes(fragment.id);
        card.append(element('summary', '', `${fragment.title}${collected ? ' / COLLECTED' : ''}`), element('p', '', fragment.summary), element('p', 'atlas-book-example', `TRY IT: ${fragment.example}`), element('p', 'atlas-book-failure', `IF MISSED: ${fragment.failure}`));
        card.append(actionButton(collected ? 'Fragment carried' : 'Carry fragment', () => this.collectKnowledge(fragment.id), `Carry ${fragment.title} fragment`));
        list.append(card);
      }
      panel.append(list, actionButton('Close Book and start teach-back', this.closeBookForTeachBack, 'Close Book and start teach-back'));
    } else if (this.teachBackStep >= ATLAS_KNOWLEDGE_BOOK.teachBackOrder.length) {
      panel.append(element('div', 'atlas-builder-success', 'TEACH-BACK COMPLETE / KNOWLEDGE ACTIVE'), element('p', 'atlas-quiet', this.teachBackNotice), actionButton('Open Book again', this.openKnowledgeBook, 'Open Living Knowledge Book again'), actionButton('Return to Mara', this.startLantern, 'Return to Mara'));
    } else {
      const stepId = ATLAS_KNOWLEDGE_BOOK.teachBackOrder[this.teachBackStep]!;
      panel.append(element('p', 'atlas-builder-progress', `TEACH-BACK STEP ${this.teachBackStep + 1} OF 5 / NAME THE NEXT MOVE`), element('p', 'atlas-trial-copy', knowledgeTeachBackPrompt(stepId)));
      const choices = element('div', 'atlas-book-choices');
      for (const choice of ATLAS_KNOWLEDGE_BOOK.teachBackOrder) choices.append(actionButton(choice.toUpperCase(), () => this.answerTeachBack(choice), `Answer ${choice}`));
      panel.append(choices);
      if (this.teachBackNotice) panel.append(element('p', 'atlas-lantern-error', this.teachBackNotice));
    }
    this.ui.append(panel);
  }

  private advanceLantern = (action: LastLanternAction): void => {
    try {
      replayLastLantern([action], this.lanternState);
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      if (this.lanternState.phase === 'tower-lit') {
        this.progress.completeDistrict('pay-harbor');
        this.progress.completeTrial('last-lantern');
      }
    } catch (error) {
      this.audio.setState({ phase: this.lanternState.phase, evidenceSource: action.type === 'receive-evidence' ? action.source : undefined });
      this.renderLantern(error instanceof Error ? error.message : 'The practice step could not continue.');
      return;
    }
    this.renderLantern();
  };

  private renderLantern(notice = ''): void {
    this.ui.replaceChildren();
    this.renderer.drawHarbor(this.lanternState.phase, this.selectedRole);
    if (this.maraConversation) {
      this.ui.append(dialogueSheet({
        display: this.maraConversation,
        speakerName: 'Mara',
        onChoose: (choiceId) => {
          this.maraConversation = this.conversations.choose(choiceId);
          this.renderLantern();
        },
        onContinue: () => {
          this.maraConversation = null;
          this.renderLantern();
        },
        continueLabel: 'Help her',
      }));
      return;
    }
    const panel = this.screenPanel('atlas-lantern');
    panel.setAttribute('aria-label', 'The Last Lantern local practice');
    panel.append(
      this.screenNav('Pay Harbor'),
      // This is the screen a player approves a transfer on, so it carries the
      // full lockup rather than the signet alone.
      createAtlasCrest(),
      createNimiqPoweredBy(),
      element('p', 'atlas-eyebrow', 'PAY HARBOR / THE LAST LANTERN'),
      element('h1', '', 'Keep the harbor open'),
      element('p', 'atlas-trial-copy', this.selectedRole === 'builder' ? 'Repair Mara\'s payment route: provider request, exact Lunas, then authoritative confirmation.' : 'Walk through Mara\'s shop, review a NIM payment, and carry the lantern to the harbor tower.'),
       element('p', 'atlas-lantern-mode', this.paymentConfig.enabled ? 'LIVE TESTNET MODE / NIMIQ PAY + SERVER CONFIRMATION' : 'PRACTICE MODE / PLAYABLE WITHOUT A WALLET'),
       element('p', 'atlas-payment-path', this.paymentConfig.enabled ? 'NIMIQ PAY IS THE LIVE PAYMENT GATE. Review the exact TestAlbatross request, approve it in Nimiq Pay, then ask Atlas to confirm canonical chain evidence before the harbor unlocks.' : 'This browser build is safe practice mode. Nimiq Pay is configured only when the deployment supplies a real TestAlbatross recipient and RPC-backed reconciliation.'),
    );
    const status = element('div', 'atlas-lantern-status');
    status.setAttribute('role', 'status');
    status.append(element('strong', '', lanternHeading(this.lanternState.phase)), element('p', '', lanternDetail(this.lanternState.phase)));
    panel.append(status);
    if (notice) panel.append(element('p', 'atlas-lantern-error', notice));
    if (this.paymentNotice) panel.append(element('p', this.paymentNotice.startsWith('Confirmed') ? 'atlas-builder-success' : 'atlas-quiet', this.paymentNotice));
    if (this.lanternState.phase === 'review' || this.lanternState.phase === 'confirming') {
      const requestValue = this.currentLanternRequest();
      const request = element('dl', 'atlas-payment-review');
      request.append(
        element('dt', '', 'NETWORK'), this.networkValueCell(requestValue.network),
        element('dt', '', 'RECIPIENT'), element('dd', '', requestValue.recipient),
        element('dt', '', 'AMOUNT'), element('dd', '', formatLanternAmount(requestValue.valueLuna)),
      );
      panel.append(request);
    }
    const action = this.lanternActionButton();
    if (action) panel.append(action);
    if (this.lanternState.phase === 'tower-lit') {
      panel.append(element('p', 'atlas-quiet', 'The verified lantern event changed the world: lights on, ferries moving, market open.'));
      panel.append(actionButton('Continue to Genesis Garden', this.startGarden, 'Continue to Genesis Garden'));
    }
    this.ui.append(panel);
  }

  private lanternActionButton(): HTMLButtonElement | null {
    const phase = this.lanternState.phase;
    if (phase === 'street') return actionButton('Enter Pay Harbor shop', () => this.advanceLantern({ type: 'enter-shop' }), 'Enter Pay Harbor shop');
    if (phase === 'shop') return actionButton('Inspect the harbor lantern', () => this.advanceLantern({ type: 'select-lantern' }), 'Inspect the harbor lantern');
    if (phase === 'selected' && this.selectedRole === 'builder') return actionButton('Open provider workshop', this.startBuilderRepair, 'Open the Pay Harbor provider workshop');
    if (phase === 'selected') return actionButton('Review payment request', () => this.advanceLantern({ type: 'review-request', request: this.currentLanternRequest() }), 'Review payment request');
    if (phase === 'review' && this.lanternState.mode === 'live') return this.paymentButton('Pay with Nimiq Pay', this.payWithNimiqPay, 'Pay with Nimiq Pay on TestAlbatross');
    if (phase === 'confirming' && this.lanternState.mode === 'live') return this.paymentButton('Check authoritative confirmation', this.reconcileLiveOrder, 'Check authoritative payment confirmation');
    if (phase === 'review' || phase === 'confirming') return actionButton('Simulate verified confirmation', () => this.advanceLantern({ type: 'receive-evidence', source: 'local-simulation', evidence: { txHash: 'practice-only', network: LAST_LANTERN.request.network, recipient: LAST_LANTERN.recipient, valueLuna: LAST_LANTERN.priceLuna, canonical: true, success: true, confirmations: LAST_LANTERN.minimumConfirmations } }), 'Simulate verified confirmation');
    if (phase === 'verified') return actionButton('Carry lantern to tower', () => this.advanceLantern({ type: 'fulfill-lantern' }), 'Carry lantern to tower');
    if (phase === 'fulfilled') return actionButton('Light the harbor tower', () => this.advanceLantern({ type: 'reach-tower' }), 'Light the harbor tower');
    return null;
  }

  private currentLanternRequest() {
    return this.lanternState.request ?? (this.paymentConfig.enabled
      ? { itemId: 'harbor-lantern' as const, network: 'testalbatross' as const, recipient: this.paymentConfig.recipient!, valueLuna: this.paymentConfig.valueLuna }
      : { ...LAST_LANTERN.request });
  }

  private paymentButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
    const button = actionButton(label, action, ariaLabel);
    button.disabled = this.paymentBusy;
    return button;
  }

  private payWithNimiqPay = async (): Promise<void> => {
    if (this.paymentBusy || !this.paymentConfig.enabled) return;
    this.paymentBusy = true;
    this.paymentNotice = 'Opening Nimiq Pay after your explicit approval action...';
    this.renderCurrentLanternSurface();
    try {
      const controller = this.paymentController ?? (this.paymentController = this.createPaymentController());
      const result = await controller.start();
      this.liveOrderId = result.orderId;
      this.liveLookup = result.lookup;
      if (result.status === 'confirming') {
        if (this.lanternState.phase === 'review') this.advanceCurrentLantern({ type: 'await-evidence' });
        this.paymentNotice = 'Approval received. The provider lookup is submitted; it is not payment proof. Ask Atlas to confirm the chain.';
        await this.reconcileLiveOrder();
      } else {
        this.paymentNotice = result.error ?? `Payment flow is ${result.status}. Review the request before retrying.`;
        this.renderCurrentLanternSurface();
      }
    } catch (error) {
      this.paymentNotice = error instanceof Error ? error.message : 'The mobile payment could not continue. Review the request and retry.';
      this.renderCurrentLanternSurface();
    } finally {
      this.paymentBusy = false;
      this.renderCurrentLanternSurface();
    }
  };

  private reconcileLiveOrder = async (): Promise<void> => {
    if (!this.liveOrderId || !this.paymentController) {
      this.paymentNotice = 'Approve the reviewed request first; no order is waiting for confirmation.';
      this.renderCurrentLanternSurface();
      return;
    }
    try {
      const result = await this.paymentController.reconcile();
      if (result.status === 'confirming') {
        this.paymentNotice = 'Still waiting for canonical confirmation. The lantern stays locked until the server observes it.';
        this.renderCurrentLanternSurface();
        return;
      }
      if (result.status !== 'verified' || !result.evidence || !this.liveLookup) {
        /* A refusal is the product working, so it is counted rather than
         * treated as an error we would rather not see in the numbers. */
        this.usage.record('payment-refused');
        this.paymentNotice = 'The server returned fulfillment without usable evidence. The harbor remains locked.';
        this.renderCurrentLanternSurface();
        return;
      }
      this.paymentController.fulfill();
      this.usage.record('payment-verified');
      this.paymentNotice = 'Confirmed by canonical chain evidence. The harbor can unlock.';
      this.advanceCurrentLantern({ type: 'receive-evidence', source: 'server-verified', evidence: { txHash: this.liveLookup, network: result.evidence.network, recipient: result.evidence.recipient, valueLuna: result.evidence.valueLuna, canonical: result.evidence.canonical, success: result.evidence.success, confirmations: result.evidence.confirmations } });
    } catch (error) {
      this.paymentNotice = error instanceof Error ? error.message : 'The server could not reconcile the payment yet.';
      this.renderCurrentLanternSurface();
    }
  };

  private renderCurrentLanternSurface(): void {
    if (this.screen === 'pay-harbor' && this.livingCity) {
      this.presentPayHarborWorld();
      this.renderPayHarbor();
      return;
    }
    this.renderLantern();
  }

  private advanceCurrentLantern(action: LastLanternAction): void {
    if (this.screen === 'pay-harbor' && this.livingCity) {
      this.advancePhysicalLantern(action);
      return;
    }
    this.advanceLantern(action);
  }

  private startBuilderRepair = (): void => {
    this.screen = 'trial';
    this.builderStep = 0;
    this.builderNotice = '';
    this.renderBuilderRepair();
  };

  private renderBuilderRepair(): void {
    this.ui.replaceChildren();
    const panel = this.screenPanel('atlas-builder-repair');
    panel.setAttribute('aria-label', 'Builder repair practice');
    panel.append(
      this.screenNav('Provider workshop'),
      element('p', 'atlas-eyebrow', 'BUILDER REPAIR / PAYMENT PATH'),
      element('p', 'atlas-trial-context', 'Builder Trial 1 of 6 / YOU ARE HERE: MARA\'S PAY HARBOR WORKSHOP'),
      element('h1', '', 'Repair the route Mara can trust'),
      element('p', 'atlas-trial-copy', 'Predict each observation before running the repair. Each tile is a typed operation, never executable code.'),
      element('p', 'atlas-lantern-mode', 'SIMULATED LOOKUP / NO PAYMENT'),
    );
    const boundary = element('p', 'atlas-builder-boundary', 'No arbitrary code runs here. The server grades the same allowlisted sequence for competitive proof.');
    panel.append(boundary);
    if (this.builderStep >= BUILDER_REPAIR_STEPS.length) {
      panel.append(element('div', 'atlas-builder-success', 'REPAIR COMPLETE / LOCAL RECIPE UNLOCKED'));
      const recipe = document.createElement('pre');
      recipe.className = 'atlas-builder-recipe';
      recipe.textContent = 'provider-init \u2192 user intent \u2192 accounts \u2192 exact payment \u2192 lookup \u2192 chain confirmation \u2192 one fulfillment';
      panel.append(recipe, element('p', 'atlas-quiet', 'This local seal does not create a wallet proof, score, rank, or reward claim.'));
      panel.append(actionButton('Install repair and reopen route', this.finishBuilderRepairIntoHarbor, 'Install the local Builder repair and return to Pay Harbor'));
      this.ui.append(panel);
      return;
    }
    const current = BUILDER_REPAIR_STEPS[this.builderStep]!;
    const progress = element('p', 'atlas-builder-progress', `REPAIR STEP ${this.builderStep + 1} OF ${BUILDER_REPAIR_STEPS.length}`);
    const card = element('div', 'atlas-builder-step');
    card.append(element('strong', '', current.title), element('p', '', current.prompt));
    const choices = document.createElement('div');
    choices.className = 'atlas-builder-choices';
    for (const choice of current.choices) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'builder-prediction';
      input.value = choice;
      label.append(input, document.createTextNode(choice));
      choices.append(label);
    }
    const feedback = element('p', this.builderNotice ? 'atlas-lantern-error' : 'atlas-quiet', this.builderNotice);
    const submit = actionButton('Lock prediction and run tile', () => {
      const selected = card.querySelector<HTMLInputElement>('input:checked')?.value;
      if (selected !== current.answer) {
        this.builderNotice = 'That prediction would cross the wrong authority boundary. Read the tile and try again.';
        this.renderBuilderRepair();
        return;
      }
      this.builderNotice = '';
      this.builderStep += 1;
      this.renderBuilderRepair();
    }, `Lock prediction for ${current.title}`);
    card.append(choices, feedback, submit);
    panel.append(progress, card);
    this.ui.append(panel);
  }

  private finishBuilderRepairIntoHarbor = (): void => {
    this.progress.completeDistrict('pay-harbor');
    this.progress.completeTrial('harbor-repair-v1');
    replayLastLantern([{ type: 'review-request', request: this.currentLanternRequest() }], this.lanternState);
    if (this.lanternState.mode === 'practice') {
      replayLastLantern([{
        type: 'receive-evidence',
        source: 'local-simulation',
        evidence: {
          txHash: 'builder-practice-only',
          network: LAST_LANTERN.request.network,
          recipient: LAST_LANTERN.recipient,
          valueLuna: LAST_LANTERN.priceLuna,
          canonical: true,
          success: true,
          confirmations: LAST_LANTERN.minimumConfirmations,
        },
      }], this.lanternState);
      this.paymentNotice = 'Workshop repair passed locally. The route is safe to fulfill in practice mode; no payment, score, or reward proof was created.';
    } else {
      this.paymentNotice = 'Workshop repair passed. Review and approve the exact TestAlbatross request in Nimiq Pay before the lantern can unlock.';
    }
    if (this.livingCity && this.beaconScene?.districtId === 'pay-harbor') {
      this.screen = 'pay-harbor';
      this.input.setSystem('active');
      this.presentPayHarborWorld();
      this.renderPayHarbor();
      return;
    }
    this.screen = 'lantern';
    this.maraConversation = this.conversations.start('mara-lantern', 'arrival');
    this.renderLantern();
  };

  private togglePause = (): void => {
    if (this.suspended) this.resume();
    else this.suspend('paused');
  };

  private suspend(system: 'paused' | 'hidden'): void {
    if (!this.isLivingCityScreen() || this.suspended) return;
    this.input.setSystem(system);
    this.suspended = true;
    this.livingCity?.pause();
    const pause = this.ui.querySelector<HTMLButtonElement>('.atlas-pause');
    if (pause) { pause.textContent = 'Resume'; pause.setAttribute('aria-label', 'Resume city adventure'); }
    this.toolkit?.setDetail(system === 'hidden' ? 'Paused while NIM Atlas is hidden.' : 'Paused. Press Pause again to continue.');
  }

  private resume = (): void => {
    this.suspended = false;
    this.livingCity?.resume();
    this.input.setSystem('active');
    if (this.screen === 'beacon-commons') this.renderBeaconCommons();
    if (this.screen === 'pay-harbor') this.renderPayHarbor();
  };

  private visibility = (): void => {
    if (document.hidden) this.suspend('hidden');
    else this.resume();
  };

  private resize = (): void => {
    this.renderer.resize();
    if (this.isLivingCityScreen()) this.resizeLivingCity();
    else if (this.screen === 'core-run') this.renderer.drawDistrict('genesis-garden', this.coreRun.state().phase === 'completed');
    else if (this.screen === 'evergreen') this.renderer.drawDistrict(this.evergreenAdventure.districtId, this.evergreenState.phase === 'completed');
    else this.renderer.drawHarbor(this.lanternState.phase, this.selectedRole);
  };

  private isLivingCityScreen(): boolean {
    return this.screen === 'beacon-commons' || this.screen === 'pay-harbor';
  }

  private resizeLivingCity(): void {
    const visualViewport = window.visualViewport;
    const width = Math.ceil(visualViewport?.width ?? window.innerWidth);
    const height = Math.ceil(visualViewport?.height ?? window.innerHeight);
    this.livingCity?.resize(width, height, 1);
  }

  private movementButton(label: string, direction: AtlasDirection, glyph: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `atlas-move atlas-move-${direction}`;
    button.textContent = glyph;
    button.setAttribute('aria-label', `Move ${label.toLowerCase()}`);
    let pressedAt = 0;
    const press = (event: PointerEvent): void => { pressedAt = performance.now(); event.preventDefault(); button.setPointerCapture?.(event.pointerId); this.input.setDirection(direction, true); };
    const release = (): void => this.input.setDirection(direction, false);
    button.addEventListener('pointerdown', press);
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', release);
    /*
     * A tap has to move you somewhere.
     *
     * These arrows are the only way to move for a player using a keyboard or
     * assistive technology, and the pulse was 120 ms — measured at 0.00 m over
     * twenty taps, because the city ramps a walk up from standing and the pulse
     * ended before it had gone anywhere. A step long enough to clear that ramp
     * makes one tap worth roughly half a metre, so a player can cross the
     * street in a sensible number of presses.
     *
     * Repeated taps extend the same step rather than stacking their own
     * releases, which previously let an early timer stop a later press.
     */
    button.addEventListener('click', (event) => {
      if (!shouldHandleDirectionalClick(event.detail) && performance.now() - pressedAt > 180) return;
      this.input.setDirection(direction, true);
      window.clearTimeout(this.directionalTapTimers.get(direction));
      this.directionalTapTimers.set(direction, window.setTimeout(() => {
        this.input.setDirection(direction, false);
        this.directionalTapTimers.delete(direction);
      }, DIRECTIONAL_TAP_MILLISECONDS));
    });
    return button;
  }

  private createCitySprint(): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'atlas-tool atlas-sprint';
    button.textContent = 'RUN';
    button.setAttribute('aria-label', 'Hold to run');
    button.setAttribute('aria-pressed', 'false');
    const press = (event: PointerEvent): void => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture?.(event.pointerId);
      this.input.setRun(true);
      button.classList.add('is-held');
      button.setAttribute('aria-pressed', 'true');
    };
    const release = (): void => {
      this.input.setRun(false);
      button.classList.remove('is-held');
      button.setAttribute('aria-pressed', 'false');
    };
    button.onpointerdown = press;
    button.onpointerup = release;
    button.onpointercancel = release;
    button.onlostpointercapture = release;
    button.onkeydown = (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      this.input.setRun(true);
      button.classList.add('is-held');
      button.setAttribute('aria-pressed', 'true');
    };
    button.onkeyup = (event) => {
      if (event.key !== ' ' && event.key !== 'Enter') return;
      event.preventDefault();
      release();
    };
    return button;
  }

  private createCityJoystick(): HTMLElement {
    const pad = element('div', 'atlas-joystick');
    pad.setAttribute('role', 'application');
    pad.setAttribute('aria-label', 'Movement joystick. Drag gently to walk or hold at the edge to run. Keyboard players may use arrows or WASD.');
    const thumb = element('span', 'atlas-joystick-thumb');
    const label = element('span', 'atlas-joystick-label', 'READY');
    this.cityPaceLabel = label;
    pad.append(thumb, label);
    let activePointer: number | null = null;
    const update = (event: PointerEvent): void => {
      const bounds = pad.getBoundingClientRect();
      const radius = Math.max(1, Math.min(bounds.width, bounds.height) * 0.5 - 22);
      const rawX = event.clientX - (bounds.left + bounds.width * 0.5);
      const rawY = event.clientY - (bounds.top + bounds.height * 0.5);
      const distance = Math.hypot(rawX, rawY);
      const scale = distance > radius ? radius / distance : 1;
      const x = rawX * scale;
      const y = rawY * scale;
      thumb.style.transform = `translate(${x}px, ${y}px)`;
      this.input.setJoystick({ x: x / radius, y: y / radius });
    };
    const release = (event?: PointerEvent): void => {
      if (event && activePointer !== null && event.pointerId !== activePointer) return;
      activePointer = null;
      thumb.style.transform = 'translate(0, 0)';
      this.input.clearJoystick();
    };
    const handlePointer = (event: PointerEvent): void => {
      if (event.type === 'pointerdown') {
        if (activePointer !== null || (event.pointerType === 'mouse' && event.button !== 0)) return;
        event.preventDefault();
        activePointer = event.pointerId;
        pad.setPointerCapture?.(event.pointerId);
        update(event);
      } else if (event.type === 'pointermove') {
        if (event.pointerId === activePointer) update(event);
      } else {
        release(event);
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      pad.addEventListener(type, handlePointer);
    }
    return pad;
  }

  private createCameraLookZone(): HTMLElement {
    const zone = element('div', 'atlas-camera-look-zone');
    zone.setAttribute('role', 'application');
    zone.setAttribute('aria-label', 'Camera look area. Drag left or right to turn the camera around the player.');
    zone.append(element('span', 'atlas-camera-look-hint', 'DRAG TO LOOK'));
    const look = new AtlasCameraLookController();
    const release = (event: PointerEvent): void => {
      if (!look.end(event.pointerId)) return;
      zone.classList.remove('is-looking');
      this.livingCity?.setCameraControlActive(false);
    };
    const handlePointer = (event: PointerEvent): void => {
      if (event.type === 'pointerdown') {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        look.begin(event.pointerId, event.clientX);
        zone.setPointerCapture?.(event.pointerId);
        zone.classList.add('is-looking');
        this.livingCity?.setCameraControlActive(true);
      } else if (event.type === 'pointermove') {
        const yawRadians = look.move(event.pointerId, event.clientX);
        if (yawRadians !== 0) this.livingCity?.orbitCamera(yawRadians);
      } else {
        release(event);
      }
    };
    for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      zone.addEventListener(type, handlePointer);
    }
    zone.oncontextmenu = (event) => { event.preventDefault(); };
    return zone;
  }

  private createCityWaypoint(): HTMLElement {
    const panel = element('aside', 'atlas-city-waypoint');
    panel.setAttribute('aria-label', 'Current city waypoint');
    const kicker = element('span', 'atlas-city-waypoint-kicker', 'NEXT TARGET');
    const label = element('strong', 'atlas-city-waypoint-label', 'LOADING');
    const distance = element('span', 'atlas-city-waypoint-distance', 'FOLLOW THE MAP');
    panel.append(kicker, label, distance);
    this.cityWaypointLabel = label;
    this.cityWaypointDistance = distance;
    return panel;
  }

  private updateCityWaypoint(player: AtlasCityPlayerState, target: readonly [number, number, number]): void {
    if (!this.cityWaypointLabel || !this.cityWaypointDistance) return;
    const guidance = getAtlasWaypointGuidance({ ...player, headingRadians: player.cameraHeadingRadians }, { x: target[0], z: target[2] });
    this.cityWaypointLabel.textContent = `${guidance.arrow} ${guidance.direction === 'ready' ? 'ACT NOW' : guidance.direction.toUpperCase()}`;
    this.cityWaypointDistance.textContent = guidance.direction === 'ready' ? 'WITHIN REACH' : `${guidance.distanceMeters.toFixed(1)}M AWAY`;
    this.cityWaypointLabel.dataset.direction = guidance.direction;
  }

  /*
   * Feeds the first-run sequence from the frame that already runs.
   *
   * Distance walked is measured from where the run started rather than summed
   * per frame, so nudging the stick back and forth cannot satisfy the step that
   * exists to prove the player found the joystick.
   */
  private observeFreePlay(player: AtlasCityPlayerState | undefined): void {
    if (this.freePlayDone || !player || this.screen !== 'beacon-commons') return;
    if (!this.freePlayOrigin) {
      this.freePlayOrigin = { x: player.x, z: player.z };
      this.freePlayStartedAt = performance.now();
    }
    const run = this.routeRun;
    const complete = atlasFreePlayComplete({
      metresExplored: Math.hypot(player.x - this.freePlayOrigin.x, player.z - this.freePlayOrigin.z),
      secondsElapsed: (performance.now() - this.freePlayStartedAt) / 1_000,
      chapter: run?.chapter ?? null,
      stage: run?.stage ?? null,
      actionsTaken: run?.actions.length ?? 0,
    });
    if (!complete) return;
    this.freePlayDone = true;
    this.renderBeaconCommons();
  }

  private observeTutorial(player: AtlasCityPlayerState | undefined): void {
    if (this.routeRun && this.screen === 'beacon-commons') return;
    if (!player || this.tutorial.isComplete()) return;
    if (!this.tutorialOrigin) this.tutorialOrigin = { x: player.x, z: player.z };
    const guide = this.beaconScene?.anchors.find((anchor) => anchor.id === 'mission-guide');
    const changed = this.tutorial.observe({
      metresWalked: Math.hypot(player.x - this.tutorialOrigin.x, player.z - this.tutorialOrigin.z),
      metresToGuide: guide ? Math.hypot(guide.position[0] - player.x, guide.position[2] - player.z) : Number.POSITIVE_INFINITY,
      hasTalked: this.cityQuestStep !== 'meet-guide',
    });
    if (!changed) return;
    if (this.tutorial.isComplete()) writeTutorialDone();
    if (this.screen === 'beacon-commons') this.renderBeaconCommons();
  }

  /*
   * Dims the play screen down to the one control the current step teaches.
   *
   * The scrim is a sibling that swallows every tap; the spotlighted control is
   * lifted above it and keeps its own handlers, so the player performs the real
   * action rather than a rehearsal of it. There is no close button by design —
   * a tutorial a confused player can dismiss by accident is not a tutorial.
   */
  /*
   * Refuses to run the city upright, and repaints when the phone turns.
   *
   * A gate rather than a lock: iOS Safari does not implement
   * screen.orientation.lock, and Android Chrome only honours it in fullscreen,
   * which a wallet Mini App is not. The listener is torn down whenever the gate
   * is not showing so a screen that stopped caring stops listening.
   */
  private gateForLandscape(): boolean {
    if (!shouldGateForLandscape(this.screen, isPortraitNow())) {
      this.stopWatchingOrientation?.();
      this.stopWatchingOrientation = null;
      return false;
    }
    this.ui.replaceChildren(rotateGate({
      isPortrait: isPortraitNow,
      reducedMotion: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    }));
    this.stopWatchingOrientation ??= watchOrientation(() => {
      if (this.screen === 'beacon-commons') this.renderBeaconCommons();
      else if (this.screen === 'pay-harbor') this.renderPayHarbor();
    });
    return true;
  }

  private applyTutorialStep(shell: HTMLElement, joystick: HTMLElement, interact: HTMLElement): void {
    const step = this.tutorial.step();
    this.livingCityHost?.classList.toggle('is-tutorial-dimmed', step !== null);
    if (!step) return;
    shell.classList.add('is-tutorial');
    const target = step.spotlight === 'joystick' ? joystick : interact;
    target.classList.add('atlas-spotlight');
    /*
     * Mark the ancestors between the spotlight and the shell so the dimming
     * rule can skip them. Without this the control is dimmed by its own parent,
     * and opacity on a parent cannot be undone by a child.
     */
    for (let node = target.parentElement; node && node !== shell; node = node.parentElement) {
      node.classList.add('atlas-spotlight-path');
    }
    const prompt = element('div', 'atlas-tutorial-prompt');
    prompt.setAttribute('role', 'status');
    prompt.append(element('span', '', step.prompt), element('small', '', `STEP ${this.tutorialStepNumber()} OF 3`));
    shell.append(prompt);
  }

  /** Takes the first-run treatment off the stage, which outlives the shell. */
  private clearTutorialChrome(): void {
    this.livingCityHost?.classList.remove('is-tutorial-dimmed');
  }

  private tutorialStepNumber(): number {
    const step = this.tutorial.step();
    return step === null ? 3 : ['walk', 'approach', 'talk'].indexOf(step.id) + 1;
  }

  private isNearBeaconAnchor(player: { readonly x: number; readonly z: number }, anchorId: string, fallbackRadius: number): boolean {
    const anchor = this.beaconScene?.anchors.find((candidate) => candidate.id === anchorId);
    if (!anchor) return false;
    return Math.hypot(player.x - anchor.position[0], player.z - anchor.position[2]) <= Math.max(anchor.radius, fallbackRadius);
  }
}

function nextCoreRunAction(view: AtlasCoreRunView): AtlasAction {
  const actionNumber = view.actions;
  if (actionNumber === 0) return { moveX: 127, moveY: 0, tool: 'shield-pulse', interact: false };
  if (actionNumber < 8) return { moveX: 127, moveY: 0, tool: 'none', interact: false };
  if (actionNumber === 8) return { moveX: 127, moveY: 0, tool: 'scanner', interact: false };
  if (actionNumber === 9) return { moveX: 127, moveY: 0, tool: 'relay-tether', interact: false };
  if (actionNumber < 15) return { moveX: 127, moveY: 0, tool: 'none', interact: false };
  if (actionNumber === 15) return { moveX: 0, moveY: 0, tool: 'none', interact: true };
  if (actionNumber < 21) return { moveX: 127, moveY: 0, tool: 'none', interact: false };
  return { moveX: 0, moveY: 0, tool: 'none', interact: true };
}

function coreRunActionLabel(view: AtlasCoreRunView): string {
  if (view.phase === 'completed') return 'Run complete';
  if (view.phase === 'failed') return 'Restart the run';
  if (view.actions === 0) return 'Shield the stale route';
  if (view.actions < 8) return 'Move to the relay';
  if (view.actions === 8) return 'Scan the relay';
  if (view.actions === 9) return 'Connect the relay';
  if (view.actions < 15) return 'Move to Courier Ada';
  if (view.actions === 15) return 'Rescue Courier Ada';
  if (view.actions < 21) return 'Move to the garden gate';
  return 'Open the garden gate';
}

function coreRunObjective(view: AtlasCoreRunView): string {
  if (view.phase === 'completed') return 'MISSION COMPLETE';
  if (view.phase === 'failed') return 'REPLAY FAILED';
  return coreRunActionLabel(view).toUpperCase();
}

function coreRunDetail(view: AtlasCoreRunView): string {
  if (view.phase === 'completed') return 'The courier is safe and the district gate is open. You just learned the Nimiq loop: protect the route, inspect the relay, connect it, then confirm the outcome.';
  if (view.phase === 'failed') return 'The run did not survive the route. Restart and follow the objective rail one move at a time.';
  if (view.actions === 0) return 'A stale route is ahead. Shield first so the fault cannot damage the delivery path.';
  if (view.actions <= 9) return 'Move right through the district. The relay must be scanned before it can be connected.';
  if (view.actions <= 15) return 'The relay is live. Keep moving to Courier Ada, then interact when you arrive.';
  return 'The courier is safe. Walk to the gate and interact only after the route has been unlocked.';
}

function coreRunSteps(view: AtlasCoreRunView): Array<{ label: string; complete: boolean; current: boolean }> {
  const completed = view.phase === 'completed';
  const steps = [
    { label: 'Shield the stale route', complete: view.actions >= 1, current: view.actions === 0 },
    { label: 'Scan and connect the relay', complete: view.actions >= 10, current: view.actions >= 8 && view.actions < 10 },
    { label: 'Rescue Courier Ada', complete: view.actions >= 16, current: view.actions >= 10 && view.actions < 16 },
    { label: 'Open the garden gate', complete: completed, current: view.actions >= 16 && !completed },
  ];
  return steps.map((step) => ({ ...step, current: completed ? false : step.current }));
}

const RECEIPT_STATE_NAMES = ['LOOKUP RECEIVED', 'INCLUSION SEEN', 'CONFIRMATIONS GROWING', 'FINALITY READY'] as const;

function routeObjective(run: RouteRun): { depth: 'glance'; objective: string; detail: string; status: string } {
  if (run.chapter === 0) {
    const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
      arrive: { objective: 'HELP THE PARCEL FIND ITS HOME', detail: 'Move to Mara and open the request table.' },
      request: { objective: 'BUILD THE REQUEST', detail: 'Scan the destination and amount, then assemble the parcel.' },
      signal: { objective: 'FOLLOW THE PARCEL SIGNAL', detail: 'Approval opened the route. Find the current record.' },
      refused: { objective: 'FIND THE CURRENT RECORD', detail: 'A permission message is not delivery evidence.' },
      evidence: { objective: 'CHOOSE THE LIVING ROUTE', detail: 'Pick the record that matches the destination and amount.' },
      verified: { objective: 'DELIVER THE CHECKED PARCEL', detail: 'Carry the verified route to the garden gate.' },
      restored: { objective: 'LIGHT THE FIRST THREAD', detail: 'Place the parcel route on the Beacon post.' },
      complete: { objective: 'FIRST THREAD RESTORED', detail: 'The parcel found its home. Continue toward Pay Harbor.' },
    };
    return { depth: 'glance', ...stages[run.stage], status: 'CHAPTER 1 / GENESIS GARDEN / PRACTICE MODE' };
  }
  if (run.chapter === 1) {
    const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
      arrive: { objective: 'FIND NIA / LIGHT FOREST', detail: 'The clinic path is fading. Move to Nia and open the canopy relay.' },
      request: { objective: 'READ THE LIVING VIEW', detail: 'Read provider status, consensus signal and latest block.' },
      signal: { objective: 'FOLLOW THE FRESH TRAIL', detail: `Follow signal node ${Math.min(3, run.trailNode + 1)} of 3 before the canopy fades.` },
      refused: { objective: 'FIND THE CURRENT VIEW', detail: 'A bright cached branch is not a living network view.' },
      evidence: { objective: 'CHOOSE THE FRESH RECORD', detail: 'Pick the record that agrees with the current provider, consensus and block.' },
      verified: { objective: 'RESTORE THE CLINIC PATH', detail: 'Carry the checked view to the forest relay.' },
      restored: { objective: 'LIGHT THE CLINIC CANOPY', detail: 'Make the safe route visible for the families waiting at home.' },
      complete: { objective: 'FOREST RELAY RESTORED', detail: 'The clinic path is lit. Continue toward Pay Harbor.' },
    };
     return { depth: 'glance', ...stages[run.stage], status: 'FRESH VIEW / LIGHT FOREST / CHAPTER 2 / PRACTICE MODE' };
   }
   if (run.chapter === 2) {
     const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
       arrive: { objective: 'FIND IVO / PAY HARBOR', detail: 'Two lantern requests are waiting. Move to Ivo and open the harbor ledger.' },
       request: { objective: 'READ BOTH REQUESTS', detail: 'Open the original and the replay before releasing a lantern.' },
       signal: { objective: 'COMPARE THE TWO REQUESTS', detail: 'One request is exact. One is a duplicate with a changed route.' },
       refused: { objective: 'FIND THE CURRENT RECORD', detail: 'The harbor needs evidence before it releases cargo.' },
       evidence: { objective: run.duplicateRejected ? 'ACCEPT THE EXACT REQUEST' : 'REJECT THE DUPLICATE', detail: run.duplicateRejected ? 'Release one lantern from the original request only.' : 'Block the replay first, then review the original again.' },
       verified: { objective: 'DELIVER ONE VERIFIED LANTERN', detail: 'Carry the checked request to the harbor tower.' },
       restored: { objective: 'REOPEN THE NIGHT HARBOR', detail: 'Release one lantern and keep the duplicate closed.' },
       complete: { objective: 'PAY HARBOR RESTORED', detail: 'One exact request reopened the harbor. Continue toward Albatross Causeway.' },
     };
     return { depth: 'glance', ...stages[run.stage], status: 'DUPLICATE REQUEST / PAY HARBOR / CHAPTER 3 / PRACTICE MODE' };
   }
   if (run.chapter === 3) {
     const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
       arrive: { objective: 'FIND SANA / ALBATROSS CAUSEWAY', detail: 'Medicine is waiting. Move to Sana and open the receipt clock.' },
       request: { objective: 'READ THE MEDICINE ORDER', detail: 'Check sender, recipient and amount before starting the clock.' },
       signal: { objective: 'MOVE THE RECEIPT CLOCK', detail: `Current state: ${RECEIPT_STATE_NAMES[Math.min(3, run.receiptStep)]}. Do not release medicine early.` },
       refused: { objective: 'WAIT FOR THE RIGHT PROOF', detail: 'A hash or fast inclusion is not finality.' },
       evidence: { objective: 'CHOOSE FINALITY', detail: 'Select the record that proves the medicine route is safe.' },
       verified: { objective: 'RELEASE THE MEDICINE', detail: 'Carry the final receipt to the ferry gate.' },
       restored: { objective: 'OPEN THE MEDICINE FERRY', detail: 'The route is safe and the family can be told the truth.' },
       complete: { objective: 'CAUSEWAY RESTORED', detail: 'The medicine crossed safely. Continue toward Validator Peaks.' },
     };
     return { depth: 'glance', ...stages[run.stage], status: 'RECEIPT CLOCK / ALBATROSS CAUSEWAY / CHAPTER 4 / PRACTICE MODE' };
   }
   if (run.chapter === 4) {
     const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
       arrive: { objective: 'FIND TAVI / VALIDATOR PEAKS', detail: 'The route is paused on one report. Move to Tavi and start the consensus climb.' },
       request: { objective: 'READ THE ROUTE CLAIM', detail: 'Check the route scope and who is allowed to support the claim.' },
       signal: { objective: 'GATHER VALIDATOR AGREEMENT', detail: `Consensus signal: ${run.validatorVotes} of 3 validators agree. One voice is not enough.` },
       refused: { objective: 'DO NOT TRUST ONE VOICE', detail: 'A single validator can be delayed or wrong. Gather independent agreement.' },
       evidence: { objective: 'CHOOSE CONSENSUS', detail: 'Select the record that represents independent validators agreeing on the same route.' },
       verified: { objective: 'REOPEN THE SHARED ROUTE', detail: 'Carry the consensus record to the peak relay.' },
       restored: { objective: 'TEACH THE MANY-HANDS RULE', detail: 'The route is open. Explain why one confident report is not consensus.' },
       complete: { objective: 'CONSENSUS RESTORED', detail: 'Independent agreement reopened the route. Continue toward Builder City.' },
     };
     return { depth: 'glance', ...stages[run.stage], status: 'CONSENSUS SIGNAL / VALIDATOR PEAKS / CHAPTER 5 / PRACTICE MODE' };
   }
   if (run.chapter === 5) {
     const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
       arrive: { objective: 'FIND NOOR / BUILDER CITY', detail: 'The kiosk is showing a green badge. Move to Noor and inspect the unlock request.' },
       request: { objective: 'READ THE KIOSK REQUEST', detail: 'Check the exact order before the client presents any payment result.' },
       signal: { objective: 'PROTECT THE UNLOCK', detail: run.browserClaimSeen ? 'Browser claim inspected. Send the exact order for server verification.' : 'The browser says paid. Inspect the claim before trusting the client.' },
       refused: { objective: 'KEEP THE KIOSK CLOSED', detail: 'A browser display is not fulfillment authority. Find the server record.' },
       evidence: { objective: 'CHOOSE SERVER PROOF', detail: 'Select the record where the server verified canonical evidence for the exact order.' },
       verified: { objective: 'UNLOCK THE KIOSK', detail: 'Carry the server authority record to Noor\'s terminal.' },
       restored: { objective: 'TEACH THE AUTHORITY RULE', detail: 'The kiosk is open. Explain why the browser presents and the server verifies.' },
       complete: { objective: 'BUILDER CITY RESTORED', detail: 'The authority boundary is clear. Continue to Beacon Core.' },
     };
     return { depth: 'glance', ...stages[run.stage], status: 'SERVER VERIFICATION / BUILDER CITY / CHAPTER 6 / PRACTICE MODE' };
   }
   if (run.chapter === 6) {
     const stages: Record<RouteRun['stage'], { objective: string; detail: string }> = {
       arrive: { objective: 'FIND THE BEACON KEEPER', detail: 'Six routes are repaired. Move to the core terminal and begin the final assembly.' },
       request: { objective: 'READ THE FINAL REQUEST', detail: 'Keep consent, verification and fulfillment separate before joining the six seals.' },
       signal: { objective: 'ASSEMBLE THE SIX SEALS', detail: `${run.beaconSeals} of 6 connected. Next: ${BEACON_SEALS[Math.min(5, run.beaconSeals)] ?? 'complete'}.` },
       refused: { objective: 'DO NOT COLLAPSE THE CHAIN', detail: 'One green signal is not six independent responsibilities.' },
       evidence: { objective: 'CHECK THE COMPLETE CHAIN', detail: 'Choose the record that links the same request while keeping each authority distinct.' },
       verified: { objective: 'RESTORE THE BEACON CORE', detail: 'Carry the assembled record to the core terminal.' },
       restored: { objective: 'TEACH THE COMPLETE LOOP', detail: 'Explain Ask, Check, Approve, Confirm, Verify and Unlock.' },
       complete: { objective: 'BEACON CORE RESTORED', detail: 'All six routes now reinforce one another. Atlas is alive.' },
     };
     return { depth: 'glance', ...stages[run.stage], status: 'SIX SEALS / BEACON CORE / CHAPTER 7 / PRACTICE MODE' };
   }
   return {
    depth: 'glance',
    objective: `${routeLesson(run).name.toUpperCase()} / ${run.stage.toUpperCase()}`,
    detail: routeLesson(run).need,
    status: `CHAPTER ${run.chapter + 1} / PRACTICE MODE / NO NIM SENT`,
  };
}

function livingCityNavigation(scene: AtlasCitySceneV1): AtlasLivingCityNavigation {
  const player = scene.instances.find((instance) => instance.modelId === 'atlas-walker-player');
  if (!player) throw new Error('Beacon Commons is missing its player arrival point.');
  if (scene.navigation) {
    return {
      initial: { x: scene.navigation.safeSpawn[0], z: scene.navigation.safeSpawn[2], facing: 'up' },
      bounds: scene.navigation.bounds,
      colliders: scene.colliders,
      cameraHeadingRadians: scene.navigation.cameraHeadingRadians,
    };
  }
  const points = [
    ...scene.anchors.filter((anchor) => !anchor.id.startsWith('npc-spawn-')).map((anchor) => anchor.position),
    ...scene.paths.filter((path) => path.id !== 'walk-outer-ring').flatMap((path) => path.points),
  ];
  const xValues = points.map((point) => point[0]);
  const zValues = points.map((point) => point[2]);
  return {
    initial: { x: player.position[0], z: player.position[2], facing: 'up' },
    bounds: {
      minX: Math.min(...xValues) - 1.2,
      maxX: Math.max(...xValues) + 1.2,
      minZ: Math.min(...zValues) - 1.2,
      maxZ: Math.max(...zValues) + 1.2,
    },
    colliders: scene.colliders,
  };
}

/*
 * Whether the first run has already happened.
 *
 * Kept in its own key rather than in the progress store so that clearing game
 * progress does not force an experienced player back through the tutorial, and
 * so a storage failure degrades to showing it again rather than to a crash.
 */
const TUTORIAL_DONE_KEY = 'sface.atlas.tutorial.v1';
const LAST_LANTERN_STORAGE_PREFIX = 'sface.atlas.last-lantern.v1';
const DAILY_COMPLETED_KEY = 'sface.atlas.daily-completed.v1';

function dailyDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function readDailyCompletedDate(): string | null {
  try {
    const value = globalThis.localStorage?.getItem(DAILY_COMPLETED_KEY);
    return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writeDailyCompletedDate(value: string): void {
  try {
    globalThis.localStorage?.setItem(DAILY_COMPLETED_KEY, value);
  } catch {
    // A private browsing storage failure must not block the daily mission.
  }
}

/**
 * Luna is an integer unit; 1 NIM is 100,000 Luna.
 *
 * Both are shown because the pot is small in NIM terms and a bare Luna figure
 * reads as larger than it is, while a bare NIM figure rounds the real amount
 * away. Neither alone is honest.
 */
function formatLuna(luna: number | null): string {
  if (luna === null) return 'unavailable';
  const nim = luna / 100_000;
  return `${luna.toLocaleString('en-US')} Luna (${nim.toLocaleString('en-US', { maximumFractionDigits: 5 })} NIM)`;
}

/** Plain language for the server's refusal reasons. */
function describeDailyResult(result: AtlasDailySubmitResult): string {
  if (result.duplicate) return 'Already counted today. One wallet earns one share a day, however many times it answers.';
  if (result.eligible) return 'Verified by the server. Your wallet is in today’s pool.';
  const reasons: Record<string, string> = {
    identity_required: 'A wallet is needed before a share can be owed to anyone.',
    unknown_challenge: 'That is not today’s challenge. Reopen the daily run for the current one.',
    wrong_answer: 'The server did not accept that answer.',
    assistance_used: 'Answers revealed by a hint cannot earn a share.',
    replay_incomplete: 'The run was not finished. Play it through and submit again.',
    payment_mismatch: 'Today’s challenge needs a payment matching the posted recipient and amount.',
    payment_unverified: 'Your payment is on the network but not confirmed deeply enough yet. Try again shortly.',
    consensus_stale: 'The network reading was too old to trust. Try again once consensus is fresh.',
    validator_concentration: 'The validator spread was too narrow to count.',
  };
  return reasons[result.reason ?? ''] ?? 'The server did not count this run today.';
}

function dailyNoticeTone(notice: string): string {
  if (notice.startsWith('Verified') || notice.startsWith('Already counted')) return 'atlas-builder-success';
  if (notice.startsWith('Correct')) return 'atlas-quiet';
  return 'atlas-lantern-error';
}

function lastLanternStorageKey(actorId: string, role: AtlasRole, mode: LastLanternState['mode']): string {
  return `${LAST_LANTERN_STORAGE_PREFIX}:${actorId}:${role}:${mode}`;
}

function builderStationStorageKey(actorId: string, role: AtlasRole, mode: LastLanternState['mode']): string {
  return `${LAST_LANTERN_STORAGE_PREFIX}:builder-station:${actorId}:${role}:${mode}`;
}

function readTutorialDone(): boolean {
  try {
    return globalThis.localStorage?.getItem(TUTORIAL_DONE_KEY) === 'done';
  } catch {
    return false;
  }
}

function writeTutorialDone(): void {
  try {
    globalThis.localStorage?.setItem(TUTORIAL_DONE_KEY, 'done');
  } catch {
    // A player in private browsing sees the tutorial again. That is a far
    // better failure than refusing to play.
  }
}

function formatLanternAmount(valueLuna: number): string {
  const nim = valueLuna === LAST_LANTERN.priceLuna ? ATLAS_LANTERN_PRICE_NIM : `${valueLuna / ATLAS_LUNAS_PER_NIM}`;
  return `${nim} NIM (${valueLuna.toLocaleString()} Lunas)`;
}

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const value = document.createElement(tag);
  if (className) value.className = className;
  if (text) value.textContent = text;
  return value;
}

function lanternHeading(phase: LastLanternState['phase']): string {
  return {
    street: 'Walk to the shop',
    shop: 'Inspect the lantern',
    selected: 'Check what the shop is asking',
    review: 'Review before approval',
    confirming: 'Waiting for confirmation',
    verified: 'Payment verified',
    fulfilled: 'Carry the lantern',
    'tower-lit': 'Harbor reopened',
  }[phase];
}

function lanternDetail(phase: LastLanternState['phase']): string {
  return {
    street: 'Mara is waiting at the Pay Harbor shop.',
    shop: 'The lantern is a real item in this practice scene. Inspect it to see the request.',
    selected: 'NIM is the payment. Lunas are the smaller units. Check the network, recipient, and exact amount before approving.',
    review: 'Confirm the three lines before a wallet would ever be asked to approve.',
    confirming: 'A transaction hash alone is not proof. Atlas is checking the network record before delivery.',
    verified: 'The simulated evidence matches. Now the lantern is yours to carry.',
    fulfilled: 'Take the item to the tower. This is the first functional inventory item.',
    'tower-lit': 'One verified event changed the harbor state.',
  }[phase];
}

function knowledgeTeachBackPrompt(stepId: string): string {
  const prompts: Record<string, string> = {
    ask: 'A route needs wallet access to continue. What must happen before the wallet opens?',
    check: 'Mara can see a network, recipient, and amount. What should she do before any approval?',
    approve: 'The request is exact and readable. Who must make the next decision?',
    confirm: 'The provider returned a transaction lookup. What must Atlas wait for before delivery?',
    unlock: 'Canonical evidence matches the approved request. What may safely happen once?',
  };
  return prompts[stepId] ?? 'Which authority boundary should the route apply next?';
}

function actionButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
  return createSemanticWorldControl({ label, ariaLabel, onActivate: action });
}

/**
 * A secondary action: same shape and same tap target, without the signal
 * colour. Orange means "this is the next thing to do", so it can only be worn
 * by one control on a screen.
 */
function ghostButton(label: string, action: () => void, ariaLabel: string): HTMLButtonElement {
  const button = actionButton(label, action, ariaLabel);
  button.classList.add('atlas-ghost');
  return button;
}

function externalLink(label: string, href: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = 'atlas-guide-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  try {
    const key = 'sface-atlas-storage-check';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return localStorage;
  } catch {
    const values = new Map<string, string>();
    return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); } };
  }
}

function getAtlasSessionActorId(storage: Pick<Storage, 'getItem' | 'setItem'>): string {
  const key = 'sface-atlas-checkout-session';
  const existing = storage.getItem(key);
  if (existing && /^atlas-session-[a-z0-9-]{8,80}$/.test(existing)) return existing;
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const value = `atlas-session-${suffix}`;
  storage.setItem(key, value);
  return value;
}

function createAtlasClientRunId(): string {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `atlas-core-${suffix}`;
}

function createPaymentPersistence(storage: Pick<Storage, 'getItem' | 'setItem'>, key: string): { load: () => import('./payment-controller').AtlasPaymentControllerSnapshot | null; save: (snapshot: import('./payment-controller').AtlasPaymentControllerSnapshot) => void } {
  return {
    load: () => {
      try {
        const raw = storage.getItem(key);
        return raw ? JSON.parse(raw) as import('./payment-controller').AtlasPaymentControllerSnapshot : null;
      } catch {
        return null;
      }
    },
    save: (snapshot) => {
      try { storage.setItem(key, JSON.stringify(snapshot)); } catch { /* A failed browser cache must never change payment authority. */ }
    },
  };
}
