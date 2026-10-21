// Bootstraps the game and wires the modules together: input → simulation →
// events → (renderer, UI, audio, haptics). Scene flow:
//   menu → run ⇄ paused → over → run (retry) | menu

import { registerSW } from 'virtual:pwa-register';
import { AudioManager } from './audio/audio';
import { UNITS_PER_METER } from './config';
import { setHapticsEnabled, vibrate } from './engine/haptics';
import { Input } from './engine/input';
import { startLoop } from './engine/loop';
import { dailyInfo, randomSeed } from './engine/rng';
import { createViewport } from './engine/viewport';
import { createWorld, setViewHeight, stepWorld, summarize } from './game/world';
import { Renderer } from './render/renderer';
import * as storage from './storage';
import type {
  DailyInfo,
  GameEvent,
  InputFrame,
  Mode,
  Settings,
  TitleInfo,
  TutorialHint,
  World,
} from './types';
import { UI } from './ui/ui';

type Scene = 'menu' | 'run' | 'paused' | 'over';

/** Resume countdown: 3 ticks of this many seconds. */
const COUNTDOWN_TICK = 0.5;
const IDLE_INPUT: InputFrame = { steerDelta: 0, axis: 0, absoluteX: null };

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

let scene: Scene = 'menu';
let world: World = makeAttractWorld();
let runDaily: DailyInfo | null = null;
/** The current run's result is on the boards (exactly once per run). */
let runRecorded = false;
let countdown = 0;
let countdownShown: number | null = null;
let tutorial: { stage: TutorialHint; t: number; moved: number; lastX: number } | null = null;
let frameInput: InputFrame = IDLE_INPUT;
let firstStepOfFrame = true;
let fps = 60;
let fpsAcc = 0;
let fpsFrames = 0;

const ui = new UI(
  uiRoot,
  {
    onPlay: (mode) => startRun(mode),
    onPause: () => pause(),
    onResume: () => resume(),
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
  runRecorded = false;
  runDaily = mode === 'daily' ? dailyInfo() : null;
  const dailyId = runDaily?.id ?? null;
  const best = storage.getBest(mode, dailyId);
  world = createWorld({
    mode,
    seed: runDaily ? runDaily.seed : randomSeed(),
    dailyId,
    bestDistance: best ? best.distanceM * UNITS_PER_METER : 0,
    viewH: viewport.viewH,
  });
  renderer.reset();
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
    : { stage: 'steer', t: 0, moved: 0, lastX: world.player.x };
  ui.showTutorial(tutorial?.stage ?? null);
}

function pause(): void {
  if (scene !== 'run') return;
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
  if (tutorial) {
    tutorial = null;
    ui.showTutorial(null);
  }
  world = makeAttractWorld();
  renderer.reset();
  ui.showTitle(titleInfo());
  audio.setScene('menu');
}

function endTutorial(): void {
  tutorial = null;
  ui.showTutorial(null);
  storage.setFlag('tutorialSeen');
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
      if (scene === 'run' || scene === 'paused' || scene === 'over') startRun(world.mode);
      break;
    case 'mute':
      toggleMute();
      break;
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    pause();
    audio.suspend();
  } else {
    audio.resume();
  }
});
window.addEventListener('blur', () => pause());

startLoop({
  update(frameDt) {
    frameInput = input.frame();
    firstStepOfFrame = true;

    fpsAcc += frameDt;
    fpsFrames++;
    if (fpsAcc >= 0.5) {
      fps = Math.round(fpsFrames / fpsAcc);
      fpsAcc = 0;
      fpsFrames = 0;
    }

    if (scene === 'run' && countdown > 0) {
      countdown = Math.max(0, countdown - frameDt);
      const n = Math.ceil(countdown / COUNTDOWN_TICK);
      if (n !== countdownShown) {
        countdownShown = n;
        ui.showCountdown(n);
        audio.play(n > 0 ? 'countdown' : 'go');
      }
    }

    if (tutorial && scene === 'run' && countdown === 0) {
      tutorial.t += frameDt;
      tutorial.moved += Math.abs(world.player.x - tutorial.lastX);
      tutorial.lastX = world.player.x;
      if (tutorial.stage === 'steer' && (tutorial.moved > 80 || tutorial.t > 6)) {
        tutorial.stage = 'shadows';
        tutorial.t = 0;
        ui.showTutorial('shadows');
      } else if (tutorial.stage === 'shadows' && tutorial.t > 4.5) {
        endTutorial();
      }
    }
  },
  step(dt) {
    if (scene === 'paused') return;
    if (scene === 'run' && countdown > 0) return;
    stepWorld(world, scene === 'run' ? frameInput : IDLE_INPUT, dt);
    if (firstStepOfFrame) {
      // Relative drag is a delta: apply it once per frame, not once per step.
      frameInput = { ...frameInput, steerDelta: 0 };
      firstStepOfFrame = false;
    }
    if (world.events.length) {
      for (const e of world.events.splice(0)) dispatch(e);
    }
  },
  render(frameDt) {
    renderer.render(world, frameDt);
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
      ui.toast('A new version is ready', {
        actionLabel: 'Update',
        onAction: () => void updateSW(true),
        ms: 20000,
      });
    },
    onOfflineReady() {
      ui.toast('Ready to play offline', { ms: 2500 });
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
  get ui() {
    return ui;
  },
  play: startRun,
  pause,
  resume,
  menu: toMenu,
  storage,
};

// Launch links (the manifest's "Daily River" shortcut): ?mode=daily jumps
// straight into today's river. The query is dropped so a reload lands on the title.
const launchMode = new URLSearchParams(location.search).get('mode');
if (launchMode) history.replaceState(history.state, '', location.pathname + location.hash);
if (launchMode === 'daily' || launchMode === 'endless') {
  startRun(launchMode);
} else {
  ui.showTitle(titleInfo());
  audio.setScene('menu');
}
