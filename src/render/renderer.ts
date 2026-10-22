// Canvas 2D renderer. Composes the layers back to front:
//   water → rain ripples → wake → banks/jungle → storm veil + vignette → fireflies →
//   100 m markers → best flag → obstacles → leaf → ant → drop telegraphs →
//   effects → rain → floating text → lightning/scrims → hit vignette.
// Drop telegraphs sit above the leaf and ant on purpose: a drop aimed at the ant
// must never be hidden under the leaf it is about to hit.

import type { Viewport } from '../engine/viewport';
import type { GameEvent, Settings, World } from '../types';
import { AntArt } from './ant';
import { AttractDemo } from './attract-demo';
import { Banks } from './banks';
import { drawDrops } from './drops';
import { Effects } from './effects';
import { FlagArt } from './flag';
import { buildFoliage, buildJungleTile } from './foliage';
import { Gfx } from './gfx';
import { LeafArt } from './leaf';
import { ObstacleArt } from './obstacles';
import { Water } from './water';
import { Weather } from './weather';

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private g: Gfx;
  private banks = new Banks();
  private water = new Water();
  private obstacles = new ObstacleArt();
  private leaf = new LeafArt();
  private ant = new AntArt();
  private fx = new Effects();
  private weather = new Weather();
  private flag = new FlagArt();
  private attract = new AttractDemo();
  private builtPpu = 0;
  private lastWorld: World | null = null;
  private lastTime = 0;
  private bubbleAcc = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private viewport: Viewport,
    private getSettings: () => Settings,
  ) {
    // Opaque canvas: every pixel is painted each frame, and it lets the browser skip alpha compositing.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Canvas 2D not supported');
    this.ctx = ctx;
    this.g = new Gfx(ctx);
    this.fx.build(ctx);
    this.resize();
  }

  /** Viewport changed (size / dpr): re-render sprites at the new device scale. */
  resize(): void {
    const v = this.viewport;
    const ppu = v.scale * v.dpr;
    if (Math.abs(ppu - this.builtPpu) < 1e-3) return;
    this.builtPpu = ppu;
    const foliage = buildFoliage(ppu);
    this.banks.build(this.ctx, foliage, buildJungleTile(ppu));
    this.water.build(this.ctx, ppu, foliage);
    this.obstacles.build(ppu);
    this.leaf.build(ppu);
    this.weather.build(ppu);
    this.flag.build(ppu);
  }

  /** Spawn transient effects (splashes, floating text, shake…) for a game event. */
  onEvent(e: GameEvent, world: World): void {
    const reduced = this.getSettings().reducedMotion;
    this.fx.onEvent(e, world, reduced);
    if (e.type === 'storm' && world.state !== 'attract') this.weather.onStorm(e.phase, reduced);
  }

  /** Clear transient effects (new run / back to menu). */
  reset(): void {
    this.fx.reset();
    this.leaf.reset();
    this.ant.reset();
    this.weather.reset();
    this.attract.reset();
    this.bubbleAcc = 0;
  }

  /**
   * `veil` (0..1) darkens everything but a pool of light around the leaf:
   * full while paused, fading out over the last resume-countdown tick, so a
   * pause cannot be used to study the frozen hazards ahead.
   */
  render(world: World, frameDt: number, veil = 0): void {
    const { g, viewport: v, fx } = this;
    if (world !== this.lastWorld) {
      this.lastWorld = world;
      this.lastTime = world.time;
      this.leaf.reset();
      this.ant.reset();
    }
    const dt = Math.min(0.1, Math.max(0, frameDt));
    // Gameplay effects run on simulation time: frozen while paused or counting
    // down, and exact on high-refresh screens where some frames run no step.
    // Ambience (rain, shimmer) keeps the frame clock.
    const simDt = Math.min(0.1, Math.max(0, world.time - this.lastTime));
    this.lastTime = world.time;

    g.reduced = this.getSettings().reducedMotion;
    g.dt = dt;
    g.edt = simDt;
    g.t += dt;
    g.dpr = v.dpr;
    g.k = v.dpr * v.scale;
    g.ppu = g.k;
    g.cw = this.canvas.width;
    g.ch = this.canvas.height;
    g.safeTop = v.safe.top;
    g.safeBottom = v.safe.bottom;
    g.viewL = -v.originX / v.scale;
    g.viewR = g.viewL + v.viewW;
    g.viewH = v.viewH;

    fx.update(g.edt, dt);
    this.attract.update(world, g.edt, fx, g.reduced);
    const sx = g.reduced ? 0 : fx.shakeX();
    const sy = g.reduced ? 0 : fx.shakeY();
    g.ox = v.dpr * v.originX + sx * g.k;
    g.oy = sy * g.k;
    g.sampleRiver(world, 48);

    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';

    this.water.draw(g, world);
    this.weather.update(g, world);
    this.weather.drawRipples(g);
    this.leaf.update(g, world);
    this.leaf.drawWake(g);
    this.banks.draw(g, world);
    this.weather.drawTint(g, world);
    this.weather.drawFireflies(g, world);
    this.flag.drawMarkers(g, world);
    this.flag.drawBest(g, world);
    this.obstacles.draw(g, world);
    const pose = this.leaf.draw(g, world);
    this.ant.draw(g, world, pose);
    drawDrops(g, world, world.state === 'attract' ? this.attract.drops : world.drops);

    // Bubbles rise where the leaf went down.
    if (pose.sink > 0.6) {
      this.bubbleAcc += g.edt;
      if (this.bubbleAcc > 0.3) {
        this.bubbleAcc = 0;
        fx.bubble(world.player.x, world.player.y);
      }
    }
    fx.draw(g);
    this.weather.drawRain(g, world);
    fx.drawTexts(g);
    this.weather.drawOverlay(g);
    fx.drawVignette(g);
    if (veil > 0) this.drawVeil(g, world, Math.min(1, veil));
  }

  private drawVeil(g: Gfx, world: World, veil: number): void {
    const { ctx } = g;
    const p = world.player;
    g.world();
    // Allocated only while veiled (paused / counting down), never during play.
    const shade = ctx.createRadialGradient(p.x, p.y, VEIL_CLEAR_R, p.x, p.y, VEIL_DARK_R);
    shade.addColorStop(0, 'rgba(4, 14, 20, 0)');
    shade.addColorStop(1, 'rgba(4, 14, 20, 0.92)');
    ctx.globalAlpha = veil;
    ctx.fillStyle = shade;
    ctx.fillRect(g.viewL - 60, -60, g.viewR - g.viewL + 120, g.viewH + 120);
    ctx.globalAlpha = 1;
  }
}

/** Veil: clear around the leaf out to this radius (units)... */
const VEIL_CLEAR_R = 46;
/** ...and fully dark beyond this one. */
const VEIL_DARK_R = 130;
