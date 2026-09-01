import { describe, expect, it } from 'vitest';
import { generateRoomCode, normalizeCodeInput, toRoomId } from './roomCode';

describe('generateRoomCode', () => {
  it('produces a 5-character code', () => {
    expect(generateRoomCode()).toHaveLength(5);
  });

  it('only uses characters from the unambiguous alphabet (no 0/O/1/I)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateRoomCode();
      expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{5}$/);
      expect(code).not.toMatch(/[01OI]/);
    }
  });

  it('is not the same code every call', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRoomCode()));
    // Astronomically unlikely to collide 50 times in a row over a 33^5 space if this is actually random.
    expect(codes.size).toBeGreaterThan(1);
  });
});

describe('toRoomId', () => {
  it('prefixes the code with the app namespace', () => {
    expect(toRoomId('ABCDE')).toBe('rr-ABCDE');
  });

  it('uppercases a lowercase code', () => {
    expect(toRoomId('abcde')).toBe('rr-ABCDE');
  });
});

describe('normalizeCodeInput', () => {
  it('uppercases lowercase input', () => {
    expect(normalizeCodeInput('abcde')).toBe('ABCDE');
  });

  it('trims surrounding whitespace', () => {
    expect(normalizeCodeInput('  ABCDE  ')).toBe('ABCDE');
  });

  it('strips characters outside A-Z0-9, e.g. a pasted dash separator', () => {
    expect(normalizeCodeInput('AB-CDE')).toBe('ABCDE');
  });

  it('strips whitespace in the middle too', () => {
    expect(normalizeCodeInput('AB CDE')).toBe('ABCDE');
  });

  it('returns an empty string for input with no valid characters', () => {
    expect(normalizeCodeInput('---')).toBe('');
  });
});
