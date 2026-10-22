// Share card: a 1080×1350 PNG (4:5, shown uncropped by feeds and chat apps)
// drawn in code in the game's flat "cozy jungle storm" style: the river, a
// few raindrop telegraphs, the leaf and ant, and the run's numbers. It is
// drawn ahead of time on the game-over screen, because navigator.share() must
// be called while the tap that asked for it still counts as a user gesture.

import { FONT_FAMILY } from '../render/palette';
import type { DailyInfo, RunSummary } from '../types';
import { fmtInt, fmtMeters, fmtTime, plural } from './format';

const W = 1080;
const H = 1350;
const RIVER_L = 250;
const RIVER_R = 830;

export interface CardInfo {
  name: string;
  isBest: boolean;
  attempts: number;
}

/** Tiny seeded generator so a run's card always looks the same. */
function rand(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const font = (weight: number, px: number) => `${weight} ${px}px ${FONT_FAMILY}`;

function edgeX(side: -1 | 1, y: number, phase: number): number {
  const base = side < 0 ? RIVER_L : RIVER_R;
  return base + Math.sin(y * 0.006 + phase) * 26 + Math.sin(y * 0.017 + phase * 2) * 9;
}

function drawScene(c: CanvasRenderingContext2D, seed: number): void {
  const r = rand(seed);
  const sky = c.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#12392a');
  sky.addColorStop(1, '#0a2117');
  c.fillStyle = sky;
  c.fillRect(0, 0, W, H);

  // Jungle blobs on both banks.
  for (let i = 0; i < 70; i++) {
    const side = i % 2 ? 1 : -1;
    const y = r() * H;
    const edge = edgeX(side, y, 1.3);
    const x = side < 0 ? edge - 30 - r() * 260 : edge + 30 + r() * 260;
    c.fillStyle = r() < 0.5 ? '#1d4a2a' : '#2a6528';
    c.globalAlpha = 0.55 + r() * 0.35;
    c.beginPath();
    c.ellipse(x, y, 40 + r() * 70, 24 + r() * 40, r() * Math.PI, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;

  // The river with wobbly banks.
  c.beginPath();
  c.moveTo(edgeX(-1, 0, 1.3), 0);
  for (let y = 0; y <= H; y += 30) c.lineTo(edgeX(-1, y, 1.3), y);
  for (let y = H; y >= 0; y -= 30) c.lineTo(edgeX(1, y, 1.3), y);
  c.closePath();
  const water = c.createLinearGradient(RIVER_L, 0, RIVER_R, 0);
  water.addColorStop(0, '#5fcab9');
  water.addColorStop(0.18, '#1d8b98');
  water.addColorStop(0.5, '#0f5f6e');
  water.addColorStop(0.82, '#1d8b98');
  water.addColorStop(1, '#5fcab9');
  c.fillStyle = water;
  c.fill();
  c.strokeStyle = '#6b4a2b';
  c.lineWidth = 12;
  c.stroke();

  // Flow streaks.
  c.strokeStyle = 'rgba(255,255,255,0.12)';
  c.lineWidth = 4;
  c.lineCap = 'round';
  for (let i = 0; i < 14; i++) {
    const x = RIVER_L + 60 + r() * (RIVER_R - RIVER_L - 120);
    const y = r() * H;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x, y + 50 + r() * 60);
    c.stroke();
  }

  // A few raindrop telegraphs: shadow disc + closing ring, like in the game.
  for (let i = 0; i < 5; i++) {
    const x = RIVER_L + 90 + r() * (RIVER_R - RIVER_L - 180);
    const y = 820 + r() * 330;
    if (Math.abs(x - W / 2) < 120 && y > 960) continue;
    const rr = 34 + r() * 14;
    c.fillStyle = 'rgba(4, 22, 30, 0.45)';
    c.beginPath();
    c.arc(x, y, rr, 0, Math.PI * 2);
    c.fill();
    c.lineWidth = 6;
    c.strokeStyle = 'rgba(4, 22, 30, 0.6)';
    c.beginPath();
    c.arc(x, y, rr * (1.15 + r() * 0.4), 0, Math.PI * 2);
    c.stroke();
    c.lineWidth = 3.5;
    c.strokeStyle = '#e6f6ff';
    c.stroke();
  }

  // Rain.
  c.strokeStyle = 'rgba(207, 230, 255, 0.28)';
  c.lineWidth = 3;
  for (let i = 0; i < 90; i++) {
    const x = r() * W;
    const y = r() * H;
    c.beginPath();
    c.moveTo(x, y);
    c.lineTo(x - 10, y + 34);
    c.stroke();
  }
}

function drawLeafAndAnt(c: CanvasRenderingContext2D, x: number, y: number): void {
  c.save();
  c.translate(x, y);
  c.rotate(-0.12);
  c.fillStyle = 'rgba(4, 22, 30, 0.35)';
  c.beginPath();
  c.ellipse(10, 16, 130, 74, 0, 0, Math.PI * 2);
  c.fill();
  // Leaf.
  c.beginPath();
  c.moveTo(-140, 0);
  c.quadraticCurveTo(-40, -92, 132, -6);
  c.quadraticCurveTo(-30, 96, -140, 0);
  c.closePath();
  const leaf = c.createLinearGradient(0, -80, 0, 80);
  leaf.addColorStop(0, '#a6e46b');
  leaf.addColorStop(1, '#4f9a33');
  c.fillStyle = leaf;
  c.fill();
  c.lineWidth = 6;
  c.strokeStyle = '#2a6528';
  c.stroke();
  c.beginPath();
  c.moveTo(-130, 1);
  c.quadraticCurveTo(0, -6, 120, -5);
  c.lineWidth = 5;
  c.strokeStyle = '#d7f5a8';
  c.stroke();
  // Ant: three body segments, legs and antennae.
  c.rotate(0.12);
  c.strokeStyle = '#2b1a14';
  c.lineWidth = 5;
  for (const s of [-1, 1]) {
    for (const k of [-16, 0, 16]) {
      c.beginPath();
      c.moveTo(k, 0);
      c.lineTo(k + s * 4, s * 30);
      c.stroke();
    }
  }
  c.beginPath();
  c.moveTo(32, -6);
  c.lineTo(52, -26);
  c.moveTo(32, 6);
  c.lineTo(52, 26);
  c.stroke();
  c.fillStyle = '#3a2219';
  for (const [bx, br] of [
    [-26, 19],
    [2, 13],
    [28, 15],
  ]) {
    c.beginPath();
    c.arc(bx, 0, br, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.beginPath();
  c.arc(32, -6, 5, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

function pill(c: CanvasRenderingContext2D, cx: number, y: number, text: string, bg: string, fg: string, px: number): void {
  c.font = font(700, px);
  const w = c.measureText(text).width + px * 1.4;
  const h = px * 1.7;
  c.fillStyle = bg;
  c.beginPath();
  c.roundRect(cx - w / 2, y - h / 2, w, h, h / 2);
  c.fill();
  c.fillStyle = fg;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(text, cx, y + px * 0.05);
}

function shadowText(c: CanvasRenderingContext2D, text: string, x: number, y: number, fill: string, depth: number): void {
  c.fillStyle = 'rgba(0, 0, 0, 0.45)';
  c.fillText(text, x, y + depth);
  c.fillStyle = fill;
  c.fillText(text, x, y);
}

export async function renderShareCard(s: RunSummary, daily: DailyInfo | null, info: CardInfo): Promise<Blob | null> {
  try {
    await Promise.all([document.fonts.load(font(700, 64)), document.fonts.load(font(500, 32))]);
  } catch {
    // Fallback fonts are fine.
  }
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const c = canvas.getContext('2d');
  if (!c || typeof c.roundRect !== 'function') return null;

  drawScene(c, s.seed ^ 0x5a17);
  // Dark glass behind the numbers so they read on any part of the scene.
  const glass = c.createLinearGradient(0, 0, 0, 860);
  glass.addColorStop(0, 'rgba(6, 20, 27, 0.88)');
  glass.addColorStop(0.85, 'rgba(6, 20, 27, 0.7)');
  glass.addColorStop(1, 'rgba(6, 20, 27, 0)');
  c.fillStyle = glass;
  c.fillRect(0, 0, W, 860);
  drawLeafAndAnt(c, W / 2, 1040);

  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  c.font = font(700, 76);
  shadowText(c, 'ANTVENTURE', W / 2, 132, '#f4f1e8', 5);
  c.font = font(500, 34);
  c.fillStyle = '#ffc24b';
  c.fillText('Leaf of Fate', W / 2, 182);

  const mode = daily ? `DAILY RIVER #${daily.number}` : 'ENDLESS RIVER';
  pill(c, W / 2, 262, mode, 'rgba(255, 194, 75, 0.18)', '#ffc24b', 34);

  c.textAlign = 'center';
  c.textBaseline = 'alphabetic';
  const score = fmtInt(s.score);
  c.font = font(700, score.length > 7 ? 150 : 200);
  shadowText(c, score, W / 2, 500, '#ffffff', 10);
  c.font = font(600, 38);
  c.fillStyle = '#b7c8c3';
  c.fillText(info.isBest ? 'POINTS · NEW BEST' : 'POINTS', W / 2, 560);

  const stats: [string, string][] = [
    [fmtMeters(s.distanceM), 'distance'],
    [fmtInt(s.nearMisses), 'near-misses'],
    [fmtInt(s.maxCombo), 'best chain'],
    [fmtTime(s.timeS), 'time'],
  ];
  const cw = 222;
  const gap = 18;
  const x0 = (W - (cw * 4 + gap * 3)) / 2;
  for (let i = 0; i < stats.length; i++) {
    const x = x0 + i * (cw + gap);
    c.fillStyle = 'rgba(255, 255, 255, 0.09)';
    c.beginPath();
    c.roundRect(x, 610, cw, 140, 28);
    c.fill();
    c.fillStyle = '#f4f1e8';
    c.font = font(700, 50);
    c.fillText(stats[i][0], x + cw / 2, 685);
    c.fillStyle = '#b7c8c3';
    c.font = font(500, 28);
    c.fillText(stats[i][1], x + cw / 2, 726);
  }

  const who = info.name ? `${info.name}` : '';
  const tries = daily && info.attempts > 1 ? `attempt ${info.attempts}` : '';
  const crumbs = s.crumbs > 0 ? plural(s.crumbs, 'crumb') : '';
  const byline = [who, tries, crumbs].filter(Boolean).join(' · ');
  if (byline) {
    c.font = font(500, 32);
    c.fillStyle = '#e6efe9';
    c.fillText(byline, W / 2, 810);
  }

  c.fillStyle = 'rgba(6, 20, 27, 0.78)';
  c.fillRect(0, H - 150, W, 150);
  c.font = font(700, 48);
  shadowText(c, 'Can you beat it?', W / 2, H - 82, '#a6e46b', 4);
  c.font = font(500, 28);
  c.fillStyle = '#b7c8c3';
  c.fillText(daily ? 'Same river for everyone today' : location.host, W / 2, H - 36);

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
}
