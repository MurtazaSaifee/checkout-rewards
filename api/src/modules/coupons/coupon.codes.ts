import { randomInt } from 'node:crypto';

/**
 * Thirty-one characters: letters and digits with 0, O, 1, I and L removed, so a
 * code read aloud or typed by hand is not mistaken for another.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 10;

/**
 * A new coupon code. Each character is drawn with a cryptographically secure
 * random source, uniformly over the alphabet, so codes cannot be guessed.
 */
export function newCouponCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += ALPHABET[randomInt(ALPHABET.length)];
  }
  return code;
}
