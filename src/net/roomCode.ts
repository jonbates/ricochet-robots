// No 0/O/1/I -- avoids read-aloud/typed ambiguity when a host reads a code
// out to friends over voice chat.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5; // 33^5 ~= 39M combinations, plenty for a casual-party room code

export function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

/**
 * The literal string passed to joinRoom() -- prefixed so this app's rooms
 * never collide with another Trystero app's rooms reusing the same short
 * code space (defense in depth on top of Trystero's own appId namespacing).
 */
export function toRoomId(code: string): string {
  return `rr-${code.toUpperCase()}`;
}

export function normalizeCodeInput(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}
