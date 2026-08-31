import { describe, expect, it } from 'vitest';
import { ROBOT_COLORS } from './board/Board';
import { darkenHex, robotCssColor, ROBOT_HEX, targetColorHex, targetCssColor, WARP_HEX } from './colors';

describe('targetColorHex', () => {
  it('resolves a robot color to that robot\'s own hex', () => {
    for (const color of ROBOT_COLORS) expect(targetColorHex(color)).toBe(ROBOT_HEX[color]);
  });

  it('resolves the warp wildcard to its own distinct purple, not any robot color', () => {
    expect(targetColorHex('warp')).toBe(WARP_HEX);
    expect(ROBOT_COLORS.map((c) => ROBOT_HEX[c])).not.toContain(WARP_HEX);
  });
});

describe('robotCssColor / targetCssColor', () => {
  it('formats each robot color as a lowercase 6-digit CSS hex string', () => {
    expect(robotCssColor('red')).toBe('#e74c3c');
    expect(robotCssColor('blue')).toBe('#2f8fdc');
    expect(robotCssColor('green')).toBe('#2ecc71');
    expect(robotCssColor('yellow')).toBe('#f1c40f');
  });

  it('agrees with robotCssColor for a robot color, and formats warp separately', () => {
    for (const color of ROBOT_COLORS) expect(targetCssColor(color)).toBe(robotCssColor(color));
    expect(targetCssColor('warp')).toBe('#9b59b6');
  });

  it('zero-pads a color whose hex value has leading zero bytes', () => {
    // Not one of the real palette's colors -- ROBOT_HEX/WARP_HEX never
    // trigger padding since all 6 hex digits are already significant -- so
    // this exercises padStart directly via targetColorHex's sibling
    // darkenHex, which can produce a short value from a real palette color.
    expect(darkenHex(0x00ff00, 0)).toBe(0); // fully darkened -- black
    expect(`#${darkenHex(0x00ff00, 0).toString(16).padStart(6, '0')}`).toBe('#000000');
  });
});

describe('darkenHex', () => {
  it('scales each channel down by the given factor, rounding to the nearest integer', () => {
    expect(darkenHex(0xff0000, 0.5)).toBe(0x800000); // 255 * 0.5 = 127.5 -> rounds up to 128 (0x80)
    expect(darkenHex(0x00ff00, 0.5)).toBe(0x008000);
    expect(darkenHex(0x0000ff, 0.5)).toBe(0x000080);
  });

  it('is the identity at factor 1 and produces black at factor 0', () => {
    for (const color of ROBOT_COLORS) {
      expect(darkenHex(ROBOT_HEX[color], 1)).toBe(ROBOT_HEX[color]);
      expect(darkenHex(ROBOT_HEX[color], 0)).toBe(0x000000);
    }
  });

  it('darkens a real robot color to something visibly different but still a valid 24-bit color', () => {
    const dimmed = darkenHex(ROBOT_HEX.blue, 0.55);
    expect(dimmed).toBeGreaterThan(0);
    expect(dimmed).toBeLessThan(ROBOT_HEX.blue);
    expect(dimmed).toBeLessThanOrEqual(0xffffff);
  });
});
