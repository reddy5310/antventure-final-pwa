// Rocks, lily pads and twigs. A rock is a warm river stone standing up out of
// the water: a pre-rendered sprite with a soft cast shadow to the lower right, a
// darker side face below and right of the lit top (that crescent is its height),
// a faceted shoulder, cracks, speckles, moss on some and a wet sheen. The water
// around it is drawn live and follows the current, which runs UP the screen: a
// bright bow wave hugs the upstream (lower) side and a V-shaped wake streams
// away from its flanks, so a rock never shows the full pale ring a raindrop
// telegraph uses. In the Rapids they also throw spray and trail long foam
// streaks. Lily pads (Lily Marsh bumpers) are pre-rendered too: big, with a
// notch and a pale raised rim so they read as solid-ish bumpers rather than the
// small decorative pads, plus a soft ripple that swells when the leaf touches
// one. Twigs are drawn live in a local rotated frame.

import { LEAF_HIT_R } from '../config';
import type { Obstacle, World } from '../types';
import { makeSprite, type Gfx, type Sprite } from './gfx';
import { P, ZP } from './palette';
import { TAU, clamp01, frac, hash, makeRand } from './util';
import { PAD_R0, PAD_VARIANTS, ROCK_R0 as R0, ROCK_VARIANTS as VARIANTS, padIndex, padNotch, padSeed, rockIndex, rockSeed, rockShape, traceRock, tracePad } from './silhouettes';
import { frameLook, type ZoneLook } from './zonelook';

/** Spray droplets thrown off each rock in white water. */
const SPRAY_N = 10;

/**
 * A rock's wake is stroked as three nested stretches of the same curve (the
 * whole line, then its first 64% and first 32%), each narrower-to-wider and
 * brighter towards the rock, so the foam thickens at the stone and fades away
 * from it without a gradient (which would allocate every frame).
 */
const WAKE_CUT = [1, 0.64, 0.32];
const WAKE_ALPHA = [0.3, 0.34, 0.4];
const WAKE_WIDTH = [1.8, 2.6, 3.5];

/**
 * Rock variant `i` as a stone seen from above, lit from the upper left. The
 * game turns every rock by `variant * TAU` and the sprite is drawn with that
 * turn, so every light-dependent offset (shadow, side face, highlights, moss,
 * sheen) is authored in screen terms and rotated back by the middle of the
 * variant's turn range: the light stays roughly upper left (within 30 degrees)
 * whatever way the stone is turned, while the outline stays the one
 * `rockShape` gives, matching the collision circle and the night outline.
 */
function rockSprite(ppu: number, i: number): Sprite {
  const seed = rockSeed(i);
  const outline = rockShape(seed);
  const rand = outline.rand;
  const mossy = seed % 2 === 0;
  const turn = ((i + 0.5) / VARIANTS) * TAU;
  const cs = Math.cos(turn);
  const sn = Math.sin(turn);
  // Room for the side face and the blurred shadow (outline reaches ~1.06 R0).
  const size = R0 * 3;
  return makeSprite(size, size, ppu, (c) => {
    // A screen-space offset (wx, wy), in units of R0, as sprite-local coordinates.
    const lx = (wx: number, wy: number) => (wx * cs + wy * sn) * R0;
    const ly = (wx: number, wy: number) => (wy * cs - wx * sn) * R0;
    const shape = (s: number, wx: number, wy: number) => {
      c.beginPath();
      traceRock(c, outline, s, lx(wx, wy), ly(wx, wy));
    };
    // Cast shadow, soft and thrown to the lower right. The shape itself is drawn
    // far outside the canvas and only its offset blurred shadow lands in it, so
    // there is no hard edge and no centred halo.
    const far = size * 4;
    c.shadowColor = 'rgba(0, 14, 24, 0.55)';
    c.shadowBlur = 3.5 * ppu;
    c.shadowOffsetX = far * c.getTransform().a;
    c.fillStyle = '#000';
    c.beginPath();
    traceRock(c, outline, 1, lx(0.12, 0.17) - far, ly(0.12, 0.17));
    c.fill();
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    c.shadowOffsetX = 0;
    // Side face: the stone's flank, down and right of the top, darkening away from the light.
    const flank = c.createLinearGradient(lx(-0.2, -0.3), ly(-0.2, -0.3), lx(0.4, 0.6), ly(0.4, 0.6));
    flank.addColorStop(0, P.rockSide);
    flank.addColorStop(1, P.rockDark);
    c.fillStyle = flank;
    c.strokeStyle = P.rockDark;
    c.lineWidth = 1.3;
    shape(1, 0.04, 0.09);
    c.fill();
    c.stroke();
    // Top face, a touch smaller and shifted up-left, so a crescent of side shows below and right.
    c.fillStyle = P.rock;
    shape(0.93, -0.03, -0.04);
    c.fill();
    // Volume: the top turns away from the light towards the lower right.
    c.save();
    c.clip();
    const turnAway = c.createRadialGradient(lx(0.34, 0.42), ly(0.34, 0.42), 0, lx(0.34, 0.42), ly(0.34, 0.42), R0 * 0.8);
    turnAway.addColorStop(0, 'rgba(46, 32, 22, 0.4)');
    turnAway.addColorStop(1, 'rgba(46, 32, 22, 0)');
    c.fillStyle = turnAway;
    c.fillRect(-R0 * 1.5, -R0 * 1.5, R0 * 3, R0 * 3);
    c.restore();
    // Crisp rim between the top and the flank.
    c.strokeStyle = 'rgba(58, 47, 40, 0.6)';
    c.lineWidth = 0.9;
    shape(0.93, -0.03, -0.04);
    c.stroke();
    // Lit shoulder and the brightest top.
    c.fillStyle = P.rockLight;
    shape(0.6, -0.12, -0.17);
    c.fill();
    c.fillStyle = P.rockTop;
    c.globalAlpha = 0.8;
    shape(0.28, -0.24, -0.3);
    c.fill();
    c.globalAlpha = 1;
    // Cracks.
    c.strokeStyle = P.rockDark;
    c.globalAlpha = 0.8;
    c.lineWidth = 1.3;
    c.beginPath();
    const ca = rand() * TAU;
    c.moveTo(Math.cos(ca) * R0 * 0.15, Math.sin(ca) * R0 * 0.15);
    c.lineTo(Math.cos(ca + 0.3) * R0 * 0.5, Math.sin(ca + 0.3) * R0 * 0.5);
    c.lineTo(Math.cos(ca + 0.1) * R0 * 0.78, Math.sin(ca + 0.1) * R0 * 0.78);
    c.stroke();
    c.globalAlpha = 1;
    // Speckles, warm dark.
    c.fillStyle = 'rgba(52, 38, 28, 0.42)';
    for (let k = 0; k < 7; k++) {
      const a = rand() * TAU;
      const d = rand() * R0 * 0.7;
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d, 0.8 + rand() * 0.9, 0, TAU);
      c.fill();
    }
    if (mossy) {
      // A cluster of soft moss blobs on the lit shoulder, never a single shape.
      const a = Math.PI * (1.05 + rand() * 0.5);
      const mx = lx(Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      const my = ly(Math.cos(a) * 0.42, Math.sin(a) * 0.42);
      c.fillStyle = P.moss;
      for (let k = 0; k < 6; k++) {
        const ba = rand() * TAU;
        const bd = rand() * R0 * 0.2;
        c.beginPath();
        c.arc(mx + Math.cos(ba) * bd, my + Math.sin(ba) * bd * 0.7, R0 * (0.07 + rand() * 0.08), 0, TAU);
        c.fill();
      }
      c.fillStyle = P.mossLight;
      for (let k = 0; k < 4; k++) {
        c.beginPath();
        c.arc(mx + lx(-0.05, -0.05) + (rand() - 0.5) * R0 * 0.3, my + ly(-0.05, -0.05) + (rand() - 0.5) * R0 * 0.2, R0 * (0.03 + rand() * 0.03), 0, TAU);
        c.fill();
      }
    }
    // Wet sheen: a crisp highlight arc on the lit side (screen angles, turned back into the sprite's frame).
    c.strokeStyle = 'rgba(255, 246, 228, 0.6)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(lx(-0.08, -0.1), ly(-0.08, -0.1), R0 * 0.66, Math.PI * 1.08 - turn, Math.PI * 1.42 - turn);
    c.stroke();
    c.fillStyle = 'rgba(255, 248, 235, 0.8)';
    c.beginPath();
    c.arc(lx(-0.42, -0.18), ly(-0.42, -0.18), 1.6, 0, TAU);
    c.fill();
  });
}

/**
 * A big lily pad from above: dark underside rim, glossy lime surface with a
 * lit sheen, radial veins, a wedge notch to the stem, and a pale raised lip all
 * round. The lip and the notch are what tell a player "bumper" at a glance.
 */
function padSprite(ppu: number, seed: number): Sprite {
  const rand = makeRand(seed);
  const notch = padNotch(seed);
  // The notch is the first draw of the stream (padNotch uses the same one).
  rand();
  const size = PAD_R0 * 2.5;
  const R = PAD_R0;
  return makeSprite(size, size, ppu, (c) => {
    const body = (r: number, ox: number, oy: number) => {
      c.beginPath();
      tracePad(c, notch, r, ox, oy);
    };
    // Underside and the soft halo that seats the pad on the water.
    c.shadowColor = 'rgba(1, 26, 20, 0.55)';
    c.shadowBlur = 5 * ppu;
    c.fillStyle = P.lilyDark;
    body(R, 0, 0);
    c.fill();
    c.shadowColor = 'transparent';
    c.shadowBlur = 0;
    // Raised lip: a pale ring just inside the edge, split by the notch.
    c.strokeStyle = ZP.padRim;
    c.lineWidth = R * 0.1;
    c.lineCap = 'butt';
    c.beginPath();
    c.arc(0, 0, R * 0.95, notch / 2 + 0.03, TAU - notch / 2 - 0.03);
    c.stroke();
    // Surface.
    c.fillStyle = seed % 2 ? P.lily : '#43964c';
    body(R * 0.86, -R * 0.015, -R * 0.02);
    c.fill();
    // Lit sheen from the upper left.
    c.save();
    body(R * 0.86, -R * 0.015, -R * 0.02);
    c.clip();
    const sheen = c.createRadialGradient(-R * 0.34, -R * 0.4, 0, -R * 0.2, -R * 0.2, R * 0.95);
    sheen.addColorStop(0, 'rgba(190, 240, 140, 0.75)');
    sheen.addColorStop(0.5, 'rgba(140, 215, 110, 0.3)');
    sheen.addColorStop(1, 'rgba(120, 200, 100, 0)');
    c.fillStyle = sheen;
    c.fillRect(-R, -R, R * 2, R * 2);
    // Shaded lower right.
    const shade = c.createRadialGradient(R * 0.4, R * 0.45, 0, R * 0.3, R * 0.35, R * 0.9);
    shade.addColorStop(0, 'rgba(14, 60, 40, 0.42)');
    shade.addColorStop(1, 'rgba(14, 60, 40, 0)');
    c.fillStyle = shade;
    c.fillRect(-R, -R, R * 2, R * 2);
    c.restore();
    // Veins fan out from the stem point.
    c.strokeStyle = P.lilyDark;
    c.lineWidth = 0.9;
    c.globalAlpha = 0.7;
    c.beginPath();
    const veins = 9 + Math.floor(rand() * 3);
    for (let i = 0; i < veins; i++) {
      const a = notch / 2 + 0.22 + (i / (veins - 1)) * (TAU - notch - 0.44);
      c.moveTo(Math.cos(a) * R * 0.1, Math.sin(a) * R * 0.1);
      c.lineTo(Math.cos(a) * R * 0.8, Math.sin(a) * R * 0.8);
    }
    c.stroke();
    c.globalAlpha = 1;
    // The lip's inner shadow and the notch's cut edges.
    c.strokeStyle = 'rgba(10, 50, 34, 0.5)';
    c.lineWidth = 1.2;
    c.beginPath();
    c.arc(0, 0, R * 0.855, notch / 2 + 0.05, TAU - notch / 2 - 0.05);
    c.stroke();
    c.strokeStyle = ZP.padRim;
    c.lineWidth = 1.3;
    c.beginPath();
    c.moveTo(Math.cos(notch / 2) * R * 0.95, Math.sin(notch / 2) * R * 0.95);
    c.lineTo(0, 0);
    c.lineTo(Math.cos(-notch / 2) * R * 0.95, Math.sin(-notch / 2) * R * 0.95);
    c.stroke();
    // A few dew drops and a nibbled speck or two for character.
    c.fillStyle = 'rgba(255, 255, 255, 0.8)';
    for (let i = 0; i < 3; i++) {
      const a = Math.PI * (0.7 + rand() * 0.9);
      const d = R * (0.25 + rand() * 0.4);
      c.beginPath();
      c.ellipse(Math.cos(a) * d, Math.sin(a) * d, 1.7, 1.2, a, 0, TAU);
      c.fill();
    }
    c.fillStyle = 'rgba(8, 40, 28, 0.55)';
    for (let i = 0; i < 2; i++) {
      const a = Math.PI * (0.2 + rand() * 1.5);
      const d = R * (0.3 + rand() * 0.35);
      c.beginPath();
      c.arc(Math.cos(a) * d, Math.sin(a) * d, 1 + rand() * 0.9, 0, TAU);
      c.fill();
    }
  });
}

export class ObstacleArt {
  private rocks: Sprite[] = [];
  private pads: Sprite[] = [];

  build(ppu: number): void {
    this.rocks = [];
    for (let i = 0; i < VARIANTS; i++) this.rocks.push(rockSprite(ppu, i));
    this.pads = [];
    for (let i = 0; i < PAD_VARIANTS; i++) this.pads.push(padSprite(ppu, padSeed(i)));
  }

  draw(g: Gfx, world: World): void {
    const list = world.obstacles;
    if (!list.length) return;
    const look = frameLook(g);
    // Water effects for all rocks and pads first, so a neighbour's foam never paints over a body.
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!this.visible(g, o)) continue;
      if (o.kind === 'rock') this.rockWater(g, o, look);
      else if (o.kind === 'pad') this.padWater(g, o, world);
    }
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!this.visible(g, o)) continue;
      g.ctx.globalAlpha = o.hit ? 0.42 : 1;
      if (o.kind === 'rock') this.rockBody(g, o);
      else if (o.kind === 'pad') this.padBody(g, o, world);
      else this.twig(g, o);
    }
    g.ctx.globalAlpha = 1;
  }

  private visible(g: Gfx, o: Obstacle): boolean {
    const ext = Math.max(o.r, o.len) * 2.6 + 20;
    return o.y > -ext && o.y < g.viewH + ext;
  }

  private rockWater(g: Gfx, o: Obstacle, look: ZoneLook): void {
    const { ctx, t } = g;
    const { x, y, r } = o;
    const ph = o.id * 1.7;
    // White-water weight at the rock's own spot on the river.
    const wr = look.weightAt('rapids', g.dOfY(y));
    const fade = o.hit ? 0.3 : 1;
    g.world();
    ctx.lineCap = 'round';
    // Slack water in the rock's lee: a tall, narrow shade trailing up the screen.
    // An ellipse well taller than wide, never a disc (a round dark patch read as a rain circle).
    ctx.globalAlpha = fade * 0.15;
    ctx.fillStyle = '#041a24';
    ctx.beginPath();
    ctx.ellipse(x + 1.5, y - r * 1.2, r * 0.5, r * 1.5, 0, 0, TAU);
    ctx.fill();
    // Short ripple arcs on the downstream (upper) side, tucked between the wake's arms.
    ctx.strokeStyle = P.foam;
    ctx.lineWidth = 2;
    ctx.globalAlpha = fade * 0.22;
    ctx.beginPath();
    const wob = Math.sin(t * 3 + ph) * 0.06;
    const r1 = r * 1.42;
    const r2 = r * 1.75;
    ctx.arc(x, y, r1, -Math.PI * 0.7 + wob, -Math.PI * 0.56 + wob);
    ctx.moveTo(x + Math.cos(-Math.PI * 0.44 - wob) * r1, y + Math.sin(-Math.PI * 0.44 - wob) * r1);
    ctx.arc(x, y, r1, -Math.PI * 0.44 - wob, -Math.PI * 0.3 - wob);
    ctx.moveTo(x + Math.cos(-Math.PI * 0.66) * r2, y + Math.sin(-Math.PI * 0.66) * r2);
    ctx.arc(x, y, r2, -Math.PI * 0.66, -Math.PI * 0.34);
    ctx.stroke();
    // V wake: a foam line leaves each flank at the rock's widest point and opens
    // upwards and outwards (~1.6 r long), swaying a little.
    const sway = r * 0.08;
    const swayL = Math.sin(t * 2.3 + ph) * sway;
    const swayR = Math.sin(t * 2.3 + ph + 2.1) * sway;
    const gain = 1 + 0.5 * wr;
    for (let pass = 0; pass < 3; pass++) {
      const u = WAKE_CUT[pass];
      ctx.globalAlpha = fade * WAKE_ALPHA[pass] * gain;
      ctx.lineWidth = WAKE_WIDTH[pass];
      ctx.beginPath();
      for (let side = -1; side <= 1; side += 2) {
        const w = side < 0 ? swayL : swayR;
        // Starts just outside the widest point, where the bow wave's ends sweep round to meet it.
        const p0x = x + side * r * 1.1;
        const p0y = y + r * 0.12;
        const cx = x + side * r * 1.2 + w * 0.5;
        const cy = y - r * 0.75;
        const p2x = x + side * r * 1.78 + w;
        const p2y = y - r * 1.4;
        // The first `u` of the quadratic: its control point and end (de Casteljau).
        const a = (1 - u) * (1 - u);
        const b = 2 * u * (1 - u);
        const e = u * u;
        ctx.moveTo(p0x, p0y);
        ctx.quadraticCurveTo(p0x + u * (cx - p0x), p0y + u * (cy - p0y), a * p0x + b * cx + e * p2x, a * p0y + b * cy + e * p2y);
      }
      ctx.stroke();
    }
    // Bow wave: a bright crescent on the upstream (lower) side, thickest in the
    // middle (three arcs, each shorter and bolder) and wobbling a little.
    const bw = Math.sin(t * 2.6 + ph) * 0.05;
    ctx.globalAlpha = fade * (0.36 + Math.sin(t * 4 + ph) * 0.08);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.2 + Math.sin(t * 3.3 + ph) * 0.8, Math.PI * (0.02 + bw), Math.PI * (0.98 + bw));
    ctx.stroke();
    ctx.globalAlpha = fade * 0.82;
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08 + 1.2 + Math.sin(t * 5 + ph) * 1.2, Math.PI * (0.1 + bw), Math.PI * (0.9 + bw));
    ctx.stroke();
    ctx.globalAlpha = fade * 0.4;
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.08 + 1.2 + Math.sin(t * 5 + ph) * 1.2, Math.PI * (0.34 + bw), Math.PI * (0.66 + bw));
    ctx.stroke();
    if (wr > 0.02 && !o.hit) this.rapidsSpray(g, o, wr);
    ctx.globalAlpha = 1;
  }

  /**
   * Rocks in white water: a fatter bow wave, long foam streaks pulled out
   * downstream and spray flung off the upstream face. Spray is a pure function
   * of time and the rock's id, so there is no state to keep.
   */
  private rapidsSpray(g: Gfx, o: Obstacle, wr: number): void {
    const { ctx, t } = g;
    const { x, y, r } = o;
    ctx.strokeStyle = ZP.spray;
    ctx.lineCap = 'round';
    // Fatter bow wave.
    ctx.globalAlpha = 0.5 * wr;
    ctx.lineWidth = 3 + 2.4 * wr;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.16 + 2.6, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
    // Foam streaks trailing past the rock.
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = 0.3 * wr;
    ctx.beginPath();
    for (let i = -1; i <= 1; i++) {
      const sx = x + i * r * 0.62;
      const len = r * (1.6 + 0.7 * hash(o.id, i + 1) + 0.25 * Math.sin(t * 3 + o.id + i));
      ctx.moveTo(sx, y - r * 0.95);
      ctx.quadraticCurveTo(sx + i * 3, y - r * 0.95 - len * 0.5, sx + i * 6, y - r * 0.95 - len);
    }
    ctx.stroke();
    // Spray: two passes (young droplets bright, old ones faint) so the alpha is per batch.
    ctx.fillStyle = ZP.spray;
    for (let pass = 0; pass < 2; pass++) {
      ctx.globalAlpha = (pass ? 0.35 : 0.8) * wr;
      ctx.beginPath();
      for (let i = 0; i < SPRAY_N; i++) {
        const life = frac(t * (1.5 + hash(o.id, i) * 0.7) + hash(o.id, i + 31));
        if ((life > 0.5 ? 1 : 0) !== pass) continue;
        const a = Math.PI * (0.06 + 0.88 * hash(o.id, i + 7));
        const dist = r * (1.12 + 0.95 * life);
        const px = x + Math.cos(a) * dist;
        const py = y + Math.sin(a) * dist - Math.sin(life * Math.PI) * 7;
        const rr = 0.9 + (1 - life) * 1.3;
        ctx.moveTo(px + rr, py);
        ctx.arc(px, py, rr, 0, TAU);
      }
      ctx.fill();
    }
  }

  /** The water around a lily pad: a soft shadow and ripples that swell when the leaf touches it. */
  private padWater(g: Gfx, o: Obstacle, world: World): void {
    const { ctx, t } = g;
    const { x, y, r } = o;
    const touch = padTouch(o, world);
    g.world();
    // Shade the water beneath the pad.
    ctx.fillStyle = 'rgba(2, 40, 30, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x + 2, y + 3, r * 1.2, r * 1.14, 0, 0, TAU);
    ctx.fill();
    // Two ripples radiating outward, out of phase, so the pad always looks afloat.
    ctx.strokeStyle = P.foam;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      const u = g.reduced ? 0.4 + i * 0.35 : frac(t * 0.4 + o.id * 0.37 + i * 0.5);
      ctx.globalAlpha = (1 - u) * (0.26 + 0.3 * touch);
      ctx.beginPath();
      ctx.arc(x, y, r * (1.08 + u * (0.42 + 0.3 * touch)), 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  private padBody(g: Gfx, o: Obstacle, world: World): void {
    const s = this.pads[padIndex(o.variant)];
    if (!s) return;
    // The pad bobs a little on the water (not with reduced motion) and dips a
    // hair under the leaf's weight.
    const bob = g.reduced ? 0 : 0.012 * Math.sin(g.t * 1.4 + o.id * 2.1);
    g.sprite(s, o.x, o.y, o.angle, (o.r / PAD_R0) * (1 + bob - 0.05 * padTouch(o, world)));
  }

  private rockBody(g: Gfx, o: Obstacle): void {
    const s = this.rocks[rockIndex(o.variant)];
    if (!s) return;
    g.sprite(s, o.x, o.y, o.angle, o.r / R0);
  }

  private twig(g: Gfx, o: Obstacle): void {
    const { ctx, t } = g;
    const { len, r } = o;
    const half = r;
    const cosA = Math.cos(o.angle);
    const sinA = Math.sin(o.angle);
    // World-space offsets expressed in the twig's local frame.
    const shX = 2.5 * cosA + 3.5 * sinA;
    const shY = -2.5 * sinA + 3.5 * cosA;
    // Which local side faces the light (top-left in world space).
    const lit = -0.6 * -sinA + -0.8 * cosA < 0 ? -1 : 1;
    const baseAlpha = ctx.globalAlpha;

    g.local(o.x, o.y, o.angle);
    ctx.lineCap = 'round';

    // Water: shadow and the foam pushed up at both ends.
    ctx.globalAlpha = baseAlpha * 0.32;
    ctx.strokeStyle = P.waterShade;
    ctx.lineWidth = half * 2 + 2;
    ctx.beginPath();
    ctx.moveTo(-len + shX, shY);
    ctx.lineTo(len + shX, shY);
    ctx.stroke();
    if (!o.hit) {
      ctx.globalAlpha = baseAlpha * (0.45 + Math.sin(t * 4 + o.id) * 0.12);
      ctx.strokeStyle = P.foam;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(-len, 0, half + 3, Math.PI * 0.6, Math.PI * 1.4);
      ctx.moveTo(len + Math.cos(-Math.PI * 0.4) * (half + 3), Math.sin(-Math.PI * 0.4) * (half + 3));
      ctx.arc(len, 0, half + 3, -Math.PI * 0.4, Math.PI * 0.4);
      ctx.stroke();
    }
    ctx.globalAlpha = baseAlpha;

    // Side branch with two little leaves (drawn first so the trunk overlaps it).
    const bx = (o.variant - 0.5) * len * 1.1;
    const bs = o.variant > 0.5 ? 1 : -1;
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = half * 0.9 + 1.2;
    ctx.beginPath();
    ctx.moveTo(bx, 0);
    ctx.lineTo(bx + len * 0.28, bs * half * 2.6);
    ctx.stroke();
    ctx.strokeStyle = P.bark;
    ctx.lineWidth = half * 0.9;
    ctx.stroke();
    twigLeaf(ctx, bx + len * 0.28, bs * half * 2.6, bs * 0.9, half * 2.4);
    twigLeaf(ctx, bx + len * 0.16, bs * half * 1.6, bs * 2.2 + Math.PI, half * 1.9);

    // Trunk: outline, body, lit edge.
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = half * 2 + 1.8;
    ctx.beginPath();
    ctx.moveTo(-len, 0);
    ctx.lineTo(len, 0);
    ctx.stroke();
    ctx.strokeStyle = P.bark;
    ctx.lineWidth = half * 2;
    ctx.stroke();
    ctx.strokeStyle = P.barkLight;
    ctx.lineWidth = half * 0.55;
    ctx.beginPath();
    ctx.moveTo(-len + half * 0.4, lit * half * 0.45);
    ctx.lineTo(len - half * 0.4, lit * half * 0.45);
    ctx.stroke();
    // Bark grain.
    ctx.strokeStyle = P.barkDark;
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const gx = -len * 0.8 + (i / 4) * len * 1.6 + (o.variant * 37 * (i + 1)) % 5;
      ctx.moveTo(gx, -half * 0.35);
      ctx.lineTo(gx + len * 0.12, -half * 0.15);
    }
    ctx.stroke();
    // Knots.
    for (let i = 0; i < 2; i++) {
      const kx = (i === 0 ? -0.45 : 0.38) * len + o.variant * 4;
      ctx.fillStyle = P.barkDark;
      ctx.beginPath();
      ctx.ellipse(kx, 0, half * 0.55, half * 0.42, 0, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = P.barkLight;
      ctx.lineWidth = 0.7;
      ctx.stroke();
    }
    // Snapped ends show pale wood.
    ctx.fillStyle = P.barkLight;
    ctx.beginPath();
    ctx.ellipse(len, 0, half * 0.45, half * 0.75, 0, 0, TAU);
    ctx.fill();
  }
}

/** 0..1 how far the leaf is pressing into a pad (for the ripple and dip). */
function padTouch(o: Obstacle, world: World): number {
  const p = world.player;
  const dx = p.x - o.x;
  const dy = p.y - o.y;
  const reach = o.r + LEAF_HIT_R;
  const d2 = dx * dx + dy * dy;
  if (d2 >= reach * reach) return 0;
  return clamp01((reach - Math.sqrt(d2)) / 14);
}

function twigLeaf(ctx: CanvasRenderingContext2D, x: number, y: number, ang: number, len: number): void {
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const w = len * 0.42;
  const tx = x + c * len;
  const ty = y + s * len;
  ctx.fillStyle = P.foliage;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + c * len * 0.5 - s * w, y + s * len * 0.5 + c * w, tx, ty);
  ctx.quadraticCurveTo(x + c * len * 0.5 + s * w, y + s * len * 0.5 - c * w, x, y);
  ctx.fill();
  ctx.fillStyle = P.foliageLight;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(x + c * len * 0.5 + s * w, y + s * len * 0.5 - c * w, tx, ty);
  ctx.closePath();
  ctx.fill();
}
