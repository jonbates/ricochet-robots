import type { RobotColor } from './board/Board';

/** Single source of truth for each robot color's display value, shared by the Three.js renderer (numeric hex) and the HTML HUD (CSS hex string). */
export const ROBOT_HEX: Record<RobotColor, number> = {
  red: 0xe74c3c,
  blue: 0x2f8fdc,
  green: 0x2ecc71,
  yellow: 0xf1c40f,
};

export function robotCssColor(color: RobotColor): string {
  return `#${ROBOT_HEX[color].toString(16).padStart(6, '0')}`;
}
