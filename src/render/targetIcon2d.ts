import type { Target, TargetShape } from '../board/BoardLayout';
import { targetCssColor, WARP_SECONDARY_HEX } from '../colors';

/**
 * A 2D canvas rendering of a target icon -- the same "shape on a white
 * circle, ringed in the target's color" look as the on-board/vault icons
 * (see BoardRenderer.buildIconWithRing), for use in plain HTML contexts
 * (the sidebar target panel) that can't drop a Three.js mesh in directly.
 * Shapes are approximated to read the same way at a glance rather than
 * matching BoardRenderer's exact vertex math -- this renders at a handful
 * of fixed pixel sizes, not the varied on-board scale that math was tuned
 * for.
 */
export function buildTargetIconCanvas(target: Target, size = 64): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const cx = size / 2;
  const cy = size / 2;
  const ringOuter = size * 0.46;
  const ringInner = size * 0.37;
  const color = targetCssColor(target.color);

  ctx.beginPath();
  ctx.arc(cx, cy, ringOuter, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, ringInner, 0, Math.PI * 2);
  ctx.fillStyle = '#ffffff';
  ctx.fill();

  drawShape(ctx, target.shape, cx, cy, ringInner, color);
  return canvas;
}

function drawShape(ctx: CanvasRenderingContext2D, shape: TargetShape, cx: number, cy: number, ringInner: number, color: string): void {
  if (shape === 'swirl') {
    drawSwirl(ctx, cx, cy, ringInner * 0.85, color);
    return;
  }
  ctx.beginPath();
  for (const { x, y } of shapePoints(shape, ringInner)) ctx.lineTo(cx + x, cy + y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function shapePoints(shape: Exclude<TargetShape, 'swirl'>, ringInner: number): { x: number; y: number }[] {
  switch (shape) {
    case 'star':
      return starPoints(ringInner * 0.78, ringInner * 0.78 * 0.43, 5);
    case 'square':
      return polygonPoints(ringInner * 0.62, 4, Math.PI / 4);
    case 'diamond':
      return polygonPoints(ringInner * 0.72, 4, 0);
    case 'triangle':
      return polygonPoints(ringInner * 0.78, 3, -Math.PI / 2);
  }
}

function polygonPoints(radius: number, sides: number, rotation: number): { x: number; y: number }[] {
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = rotation + (i / sides) * Math.PI * 2;
    points.push({ x: Math.cos(angle) * radius, y: Math.sin(angle) * radius });
  }
  return points;
}

function starPoints(outerRadius: number, innerRadius: number, points: number): { x: number; y: number }[] {
  const result: { x: number; y: number }[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    result.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
  }
  return result;
}

/** Mirrors BoardRenderer's buildSwirlGeometry -- a two-arm Archimedean spiral ribbon (purple primary, yellow secondary, phase-shifted half a turn), the warp target's own icon. */
function drawSwirl(ctx: CanvasRenderingContext2D, cx: number, cy: number, maxRadius: number, primaryColor: string): void {
  drawSwirlArm(ctx, cx, cy, maxRadius, maxRadius * 0.5, primaryColor, 0);
  drawSwirlArm(ctx, cx, cy, maxRadius, maxRadius * 0.44, `#${WARP_SECONDARY_HEX.toString(16).padStart(6, '0')}`, Math.PI);
}

function drawSwirlArm(ctx: CanvasRenderingContext2D, cx: number, cy: number, maxRadius: number, strokeWidth: number, color: string, phaseOffset: number): void {
  const turns = 1.6;
  const segments = 40;
  const outer: { x: number; y: number }[] = [];
  const inner: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = phaseOffset + t * turns * Math.PI * 2;
    const r = t * maxRadius;
    const px = Math.cos(angle) * r;
    const py = Math.sin(angle) * r;
    const nx = Math.cos(angle + Math.PI / 2);
    const ny = Math.sin(angle + Math.PI / 2);
    const halfWidth = (strokeWidth / 2) * t;
    outer.push({ x: px + nx * halfWidth, y: py + ny * halfWidth });
    inner.push({ x: px - nx * halfWidth, y: py - ny * halfWidth });
  }
  ctx.beginPath();
  ctx.moveTo(cx + outer[0].x, cy + outer[0].y);
  for (const p of outer.slice(1)) ctx.lineTo(cx + p.x, cy + p.y);
  for (const p of inner.slice().reverse()) ctx.lineTo(cx + p.x, cy + p.y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
