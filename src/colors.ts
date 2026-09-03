import type { RobotColor } from './board/Board';
import type { TargetColor } from './board/BoardLayout';

/** Single source of truth for each robot color's display value, shared by the Three.js renderer (numeric hex) and the HTML HUD (CSS hex string). */
export const ROBOT_HEX: Record<RobotColor, number> = {
  red: 0xe74c3c,
  blue: 0x2f8fdc,
  green: 0x2ecc71,
  yellow: 0xf1c40f,
};

/** The warp target's color isn't a robot color -- a distinct purple keeps it from blending into the light tile background. */
export const WARP_HEX = 0x9b59b6;

/** A second color woven into the warp target's swirl (see BoardRenderer's buildIconMesh) -- yellow's warmth against the purple's coolness makes the two spiral arms read as distinct strands rather than one flat shape. */
export const WARP_SECONDARY_HEX = 0xf1c40f;

export function targetColorHex(color: TargetColor): number {
  return color === 'warp' ? WARP_HEX : ROBOT_HEX[color];
}

export function robotCssColor(color: RobotColor): string {
  return `#${ROBOT_HEX[color].toString(16).padStart(6, '0')}`;
}

export function targetCssColor(color: TargetColor): string {
  return `#${targetColorHex(color).toString(16).padStart(6, '0')}`;
}

/** Scales a hex color's channels down toward black by `factor` (0-1) -- used for the darker top-down "dome" decal on each robot, a cheap stand-in for the shading a real lit 3D body would show from directly above. */
export function darkenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) * factor);
  const g = Math.round(((hex >> 8) & 0xff) * factor);
  const b = Math.round((hex & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Blends a hex color's channels up toward white by `factor` (0-1) -- used for the lighter ring drawn around each robot, so the ring reads as a highlight on the robot's own color rather than a separate flat tint. */
export function lightenHex(hex: number, factor: number): number {
  const r = Math.round(((hex >> 16) & 0xff) + (0xff - ((hex >> 16) & 0xff)) * factor);
  const g = Math.round(((hex >> 8) & 0xff) + (0xff - ((hex >> 8) & 0xff)) * factor);
  const b = Math.round((hex & 0xff) + (0xff - (hex & 0xff)) * factor);
  return (r << 16) | (g << 8) | b;
}

/** Linearly interpolates each channel between two hex colors -- `amount` of 0 is `from`, 1 is `to`. */
export function mixHex(from: number, to: number, amount: number): number {
  const r = Math.round(((from >> 16) & 0xff) + (((to >> 16) & 0xff) - ((from >> 16) & 0xff)) * amount);
  const g = Math.round(((from >> 8) & 0xff) + (((to >> 8) & 0xff) - ((from >> 8) & 0xff)) * amount);
  const b = Math.round((from & 0xff) + ((to & 0xff) - (from & 0xff)) * amount);
  return (r << 16) | (g << 8) | b;
}
