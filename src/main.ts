// Bootstraps the game and wires the modules together: input → simulation →
// events → (renderer, UI, audio, haptics). Scene flow:
//   menu → run ⇄ paused → over → run (retry) | menu

import { registerSW } from 'virtual:pwa-register';
import { AudioManager } from './audio/audio';
import { UNITS_PER_METER } from './config';
import { setHapticsEnabled, vibrate } from './engine/haptics';
import { Input } from './engine/input';
import { startLoop } from './engine/loop';
import { QualityGovernor } from './engine/quality';
import { dailyInfo, randomSeed } from './engine/rng';
import { SimInput } from './engine/sim-input';
import { createViewport } from './engine/viewport';
import { createWorld, setDropHold, setViewHeight, stepWorld, summarize } from './game/world';
import { Renderer } from './render/renderer';
import * as storage from './storage';
import type { DailyInfo, GameEvent, InputFrame, Mode, Settings, TitleInfo, TutorialHint, World } from './types';
import { RESTART_CONFIRM_AFTER } from './ui/screens/pause';
import { UI } from './ui/ui';

type Scene = 'menu' | 'run' | 'paused' | 'over';

/** Resume countdown: 3 ticks of this many seconds. */
const COUNTDOWN_TICK = 0.5;
const IDLE_INPUT: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };
/** First-run tutorial: leaf travel (units) that counts as "has steered"... */
const TUTORIAL_STEER_MOVE = 80;
/** ...or this long (s) with the steering hint up, whichever comes first (before the first rock arrives). */
const TUTORIAL_STEER_MAX = 6;
/** The shadows hint stays this long (s) once the first drop is on screen. */
const TUTORIAL_SHADOWS_TIME = 5;

const canvas = document.getElementById('game') as HTMLCanvasElement;
const uiRoot = document.getElementById('ui') as HTMLElement;

let settings: Settings = storage.loadSettings();
setHapticsEnabled(settings.haptics);

const viewport = createViewport(canvas, () => {
  renderer.resize();
  setViewHeight(world, viewport.viewH);
});
const renderer = new Renderer(canvas, viewport, () => settings);
const audio = new AudioManager(settings);
const input = new Input(canvas, viewport, () => settings.sensitivity);
const simInput = new SimInput();
const quality = new QualityGovernor((cap) => viewport.setDprCap(cap));

let scene: Scene = 'menu';
let world: World = makeAttractWorld();
let runDaily: DailyInfo | null = null;
/** The current run's result is on the boards (exactly once per run). */
let runRecorded = false;
let countdown = 0;
let countdownShown: number | null = null;
let tutorial: { stage: TutorialHint; t: number; moved: number; lastX: number; sawDrop: boolean } | null = null;
let fps = 60;
let fpsAcc = 0;
let fpsFrames = 0;
/** Daily id shown on the title, to refresh the card when the day rolls over. */
let titleDailyId = '';
/** PWA notices wait for the title screen: never mid-run (thumb zone), never over the game-over panel. */
let pendingUpdate: (() => void) | null = null;
let offlineReadyPending = false;

const ui = new UI(
  uiRoot,
  {
    onPlay: (mode) => startRun(mode),
    onPause: () => pause(),
    onResume: () => resume(),
    // The pause screen has already asked for confirmation where it matters.
    onRetry: () => startRun(world.mode),
    onMenu: () => toMenu(),
    onSettings: (s) => applySettings(s),
    onName: (name) => storage.setName(name),
    onToggleMute: () => toggleMute(),
    onUserGesture: () => audio.unlock(),
    onSfx: (sfx) => audio.play(sfx),
  },
  { getSettings: () => settings, getDevice: () => input.lastDevice },
);

function makeAttractWorld(): World {
  return createWorld({
    mode: 'endless',
    seed: randomSeed(),
    dailyId: null,
    bestDistance: 0,
    viewH: viewport.viewH,
    attract: true,
  });
}

function titleInfo(): TitleInfo {
  const daily = dailyInfo();
  return {
    name: storage.getName(),
    endlessBest: storage.getBest('endless', null),
    daily: {
      ...daily,
      best: storage.getBest('daily', daily.id),
      attempts: storage.getDailyAttempts(daily.id),
    },
    stats: storage.getStats(),
  };
}

function showTitle(): void {
  const info = titleInfo();
  titleDailyId = info.daily.id;
  ui.showTitle(info);
  showIdleNotices();
}

/**
 * Saves a finished run to the boards, once. A run counts from the moment the
 * ant dies, so retrying or quitting during the death animation (before the
 * game-over screen) still records it. Abandoned live runs are not recorded.
 */
function recordRunOnce(): storage.RecordResult | null {
  if (runRecorded || (world.state !== 'dying' && world.state !== 'over')) return null;
  runRecorded = true;
  return storage.recordRun(summarize(world));
}

/** Called before a run is replaced: keeps a run that already ended from vanishing. */
function saveEndedRun(): void {
  const result = recordRunOnce();
  if (result?.isBest) ui.toast(`New best saved · ${result.entry.score.toLocaleString()} pts`, { ms: 2200 });
}

function startRun(mode: Mode): void {
  audio.unlock();
  saveEndedRun();
  ui.clearActionToasts();
  runRecorded = false;
  runDaily = mode === 'daily' ? dailyInfo() : null;
  const dailyId = runDaily?.id ?? null;
  const best = storage.getBest(mode, dailyId);
  world = createWorld({
    mode,
    seed: runDaily ? runDaily.seed : randomSeed(),
    dailyId,
    bestScore: best?.score ?? 0,
    bestDistance: storage.getFarthest(mode, dailyId) * UNITS_PER_METER,
    viewH: viewport.viewH,
  });
  renderer.reset();
  simInput.discard();
  scene = 'run';
  countdown = 0;
  countdownShown = null;
  input.steeringEnabled = true;
  ui.showRun();
  ui.showCountdown(0);
  audio.setScene('run');
  audio.play('go');
  tutorial = storage.getFlag('tutorialSeen')
    ? null
    : { stage: 'steer', t: 0, moved: 0, lastX: world.player.x, sawDrop: false };
  // Endless only: holding drops shifts the rain's timing, and the Daily River
  // must be the same river for everyone.
  if (tutorial && mode === 'endless') setDropHold(world, true);
  ui.showTutorial(tutorial?.stage ?? null);
}

function pause(): void {
  // A dying run has nothing to pause: game over is a second away.
  if (scene !== 'run' || world.state !== 'running') return;
  scene = 'paused';
  countdown = 0;
  countdownShown = null;
  input.steeringEnabled = false;
  ui.showCountdown(null);
  ui.showPause();
  audio.setScene('paused');
  audio.play('pause');
}

function resume(): void {
  if (scene !== 'paused') return;
  scene = 'run';
  input.steeringEnabled = true;
  ui.showRun();
  countdown = COUNTDOWN_TICK * 3;
  countdownShown = null;
  audio.setScene('run');
}

/**
 * R / gamepad Y. Instant on the game-over screen, in the first seconds of a
 * run and during the death animation (nothing left to lose). A run with real
 * progress pauses and asks for a second press instead of vanishing.
 */
function requestRestart(): void {
  if (scene === 'over') {
    startRun(world.mode);
    return;
  }
  if (scene !== 'run' && scene !== 'paused') return;
  if (world.state !== 'running' || world.time < RESTART_CONFIRM_AFTER) {
    startRun(world.mode);
    return;
  }
  if (scene === 'run') pause();
  if (ui.requestRestart()) startRun(world.mode);
}

function finishRun(): void {
  scene = 'over';
  input.steeringEnabled = false;
  if (tutorial) endTutorial();
  const summary = summarize(world);
  // game-over fires once per world and a replaced world never reaches it, so this is the first record.
  runRecorded = true;
  const result = storage.recordRun(summary);
  ui.showGameOver({
    summary,
    rank: result.rank,
    isBest: result.isBest,
    prevBest: result.prevBest,
    board: result.board,
    daily: runDaily,
  });
  audio.setScene('over');
}

function toMenu(): void {
  saveEndedRun();
  scene = 'menu';
  input.steeringEnabled = false;
  countdown = 0;
  simInput.discard();
  if (tutorial) {
    tutorial = null;
    ui.showTutorial(null);
  }
  world = makeAttractWorld();
  renderer.reset();
  showTitle();
  audio.setScene('menu');
}

function endTutorial(): void {
  tutorial = null;
  ui.showTutorial(null);
  storage.setFlag('tutorialSeen');
}

function updateTutorial(frameDt: number): void {
  if (!tutorial || scene !== 'run' || countdown > 0) return;
  tutorial.moved += Math.abs(world.player.x - tutorial.lastX);
  tutorial.lastX = world.player.x;
  if (tutorial.stage === 'steer') {
    tutorial.t += frameDt;
    if (tutorial.moved > TUTORIAL_STEER_MOVE || tutorial.t > TUTORIAL_STEER_MAX) {
      // The player can steer: now let the rain come, and explain it as it does.
      tutorial.stage = 'shadows';
      tutorial.t = 0;
      setDropHold(world, false);
      ui.showTutorial('shadows');
    }
    return;
  }
  // The shadows hint is timed from the first telegraph on screen, so it explains what the player is looking at.
  if (!tutorial.sawDrop) tutorial.sawDrop = world.drops.length > 0;
  if (tutorial.sawDrop) tutorial.t += frameDt;
  if (tutorial.t > TUTORIAL_SHADOWS_TIME) endTutorial();
}

function applySettings(next: Settings): void {
  settings = { ...next };
  storage.saveSettings(settings);
  audio.applySettings(settings);
  setHapticsEnabled(settings.haptics);
  ui.syncSettings(settings);
}

function toggleMute(): void {
  applySettings({ ...settings, muted: !settings.muted });
  ui.toast(settings.muted ? 'Sound off' : 'Sound on', { ms: 1200 });
}

/** Update and offline notices, held back until the player is on the title screen. */
function showIdleNotices(): void {
  if (scene !== 'menu') return;
  if (offlineReadyPending) {
    offlineReadyPending = false;
    ui.toast('Ready to play offline', { ms: 2500 });
  }
  // Re-offered on every visit to the title until taken; startRun() clears it from the dock.
  if (pendingUpdate) ui.toast('A new version is ready', { actionLabel: 'Update', onAction: pendingUpdate, ms: 20000 });
}

const panOf = (x: number) => Math.max(-1, Math.min(1, (x - 200) / 200));

function dispatch(e: GameEvent): void {
  renderer.onEvent(e, world);
  if (world.state === 'attract') return;
  ui.onEvent(e, world);
  switch (e.type) {
    case 'drop-impact':
      audio.play('splash', { pan: panOf(e.x), volume: e.onLeaf ? 0.9 : 0.4 });
      break;
    case 'near-miss':
      audio.play('near-miss', { combo: e.combo, pan: panOf(e.x) });
      vibrate(8);
      break;
    case 'hit':
      audio.play('hit', { pan: panOf(e.x) });
      vibrate([40, 30, 60]);
      break;
    case 'bank-bump':
      audio.play('bump', { pan: e.side, volume: 0.6 });
      vibrate(10);
      break;
    case 'combo-lost':
      audio.play('combo-lost');
      break;
    case 'milestone':
      audio.play('milestone');
      break;
    case 'new-best':
      audio.play('new-best');
      vibrate([20, 40, 20]);
      break;
    case 'storm':
      if (e.phase !== 'calm') audio.play('thunder');
      break;
    case 'death':
      audio.play('death');
      vibrate(180);
      break;
    case 'game-over':
      finishRun();
      break;
    case 'zone':
      audio.play('zone');
      break;
    case 'pickup':
      // Crumb plucks climb in pitch along a trail (streak); power-ups whoosh.
      if (e.kind === 'crumb') audio.play('crumb', { combo: e.streak, pan: panOf(e.x) });
      else audio.play('power', { pan: panOf(e.x) });
      vibrate(e.kind === 'crumb' ? 4 : 14);
      break;
    case 'trail-complete':
      audio.play('trail', { pan: panOf(e.x) });
      vibrate([10, 20, 10]);
      break;
    case 'power-end':
      audio.play('power-end');
      break;
    case 'shield-block':
      audio.play('shield', { pan: panOf(e.x) });
      vibrate(30);
      break;
    case 'heal':
      audio.play('heart-up');
      break;
    case 'pad-bump':
      audio.play('pad', { pan: panOf(e.x), volume: 0.7 });
      vibrate(8);
      break;
    case 'power-start':
    case 'start':
      break;
  }
}

input.onAction((action) => {
  audio.unlock();
  switch (action) {
    case 'confirm':
      if (ui.isModalOpen()) return;
      if (scene === 'menu') startRun('endless');
      else if (scene === 'over') startRun(world.mode);
      else if (scene === 'paused') resume();
      break;
    case 'pause':
      // P / gamepad Start. Outside a run it is the gamer's "go" button:
      // play from the title, instant retry from the game-over screen.
      if (ui.handleBack()) return;
      if (scene === 'run') pause();
      else if (scene === 'paused') resume();
      else if (ui.isModalOpen()) return;
      else if (scene === 'menu') startRun('endless');
      else if (scene === 'over') startRun(world.mode);
      break;
    case 'back':
      // Esc / gamepad B: close the top modal, else step back one screen.
      if (ui.handleBack()) return;
      if (scene === 'run') pause();
      else if (scene === 'paused') resume();
      else if (scene === 'over') toMenu();
      break;
    case 'retry':
      if (ui.isModalOpen()) return;
      requestRestart();
      break;
    case 'mute':
      toggleMute();
      break;
  }
});

/** The Daily card names today's river; at midnight it must not keep offering yesterday's. */
function refreshTitleIfStale(): void {
  if (scene === 'menu' && !ui.isModalOpen() && dailyInfo().id !== titleDailyId) showTitle();
}

function scheduleMidnightRefresh(): void {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 2);
  window.setTimeout(() => {
    refreshTitleIfStale();
    scheduleMidnightRefresh();
  }, next.getTime() - now.getTime());
}
scheduleMidnightRefresh();

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio.suspend();
  } else {
    audio.resume();
    refreshTitleIfStale();
  }
});
window.addEventListener('blur', () => pause());

// Another tab (or the installed app) saved a run or a name: keep this title current.
storage.onExternalChange(() => {
  if (scene === 'menu' && !ui.isModalOpen()) showTitle();
});

// Phones turned sideways get a "turn upright" overlay (CSS); a live run waits behind it.
try {
  const sideways = matchMedia('(orientation: landscape) and (max-height: 500px) and (pointer: coarse)');
  sideways.addEventListener?.('change', () => {
    if (sideways.matches) pause();
  });
} catch {
  // No media queries: nothing to watch.
}

startLoop({
  update(frameDt) {
    simInput.feed(input.frame());

    fpsAcc += frameDt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }
    quality.sample(frameDt, scene === 'run' && countdown === 0 && !document.hidden);

    if (scene === 'run' && countdown > 0) {
      countdown = Math.max(0, countdown - frameDt);
      const n = Math.ceil(countdown / COUNTDOWN_TICK);
      if (n !== countdownShown) {
        countdownShown = n;
        ui.showCountdown(n);
        audio.play(n > 0 ? 'countdown' : 'go');
      }
    }

    updateTutorial(frameDt);
  },
  step(dt) {
    if (scene === 'paused' || (scene === 'run' && countdown > 0)) {
      // Drag made while frozen must not land all at once on the first live step.
      simInput.discard();
      return;
    }
    if (scene === 'run') {
      // Drag is handed to exactly one step: frames that run no step (120+ Hz
      // screens) keep theirs pending instead of losing it.
      stepWorld(world, simInput.take(), dt);
    } else {
      simInput.discard();
      stepWorld(world, IDLE_INPUT, dt);
    }
    const events = world.events;
    if (events.length) {
      // Index loop + truncate: no array allocated per step. A handler may
      // replace `world`, so drain the array that was stepped.
      for (let i = 0; i < events.length; i++) dispatch(events[i]);
      events.length = 0;
    }
  },
  render(frameDt) {
    // Paused: the field ahead is veiled; on resume it fades back in over the last countdown tick.
    const veil = scene === 'paused' ? 1 : scene === 'run' && countdown > 0 ? Math.min(1, countdown / COUNTDOWN_TICK) : 0;
    renderer.render(world, frameDt, veil);
    if (scene === 'run' || scene === 'paused') ui.updateHUD(world, fps);
    audio.setIntensity(world.state === 'attract' ? 0.15 : world.intensity);
  },
});

// Install prompt (Chrome/Android/desktop). iOS users install via Share → Add to Home Screen.
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}
let installEvent: BeforeInstallPromptEvent | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installEvent = e as BeforeInstallPromptEvent;
  ui.setInstallAvailable(true, async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    await installEvent.userChoice;
    installEvent = null;
    ui.setInstallAvailable(false, () => {});
  });
});
window.addEventListener('appinstalled', () => ui.setInstallAvailable(false, () => {}));

if (import.meta.env.PROD) {
  const updateSW = registerSW({
    onNeedRefresh() {
      pendingUpdate = () => void updateSW(true);
      showIdleNotices();
    },
    onOfflineReady() {
      offlineReadyPending = true;
      showIdleNotices();
    },
  });
}

// Debug / test hook (used by the e2e tests and for QA in the console).
declare global {
  interface Window {
    __ant: unknown;
  }
}
window.__ant = {
  get world() {
    return world;
  },
  get scene() {
    return scene;
  },
  get settings() {
    return settings;
  },
  viewport,
  quality,
  get ui() {
    return ui;
  },
  play: startRun,
  pause,
  resume,
  menu: toMenu,
  storage,
};

/** ?mode=daily / ?mode=endless: the manifest shortcut and shared Daily links. */
function launchModeOf(url: string | null | undefined): Mode | null {
  if (!url) return null;
  try {
    const m = new URL(url, location.href).searchParams.get('mode');
    return m === 'daily' || m === 'endless' ? m : null;
  } catch {
    return null;
  }
}

// Launch links jump straight into the run. The query is dropped so a reload lands on the title.
const launchMode = launchModeOf(location.href);
if (new URLSearchParams(location.search).has('mode')) history.replaceState(history.state, '', location.pathname + location.hash);
if (launchMode) {
  startRun(launchMode);
} else {
  showTitle();
  audio.setScene('menu');
}

// An installed app that is already open receives shortcut launches here
// (manifest launch_handler: focus-existing) instead of reloading.
interface LaunchParams {
  targetURL?: string;
}
const launchQueue = (window as unknown as { launchQueue?: { setConsumer(cb: (p: LaunchParams) => void): void } }).launchQueue;
launchQueue?.setConsumer((params) => {
  const mode = launchModeOf(params.targetURL);
  if (mode && scene !== 'run') startRun(mode);
});
