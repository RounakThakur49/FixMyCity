// =============================================================================
// Aadhaar (India national ID) offline format validation.
//
// This is FORMAT validation, NOT identity proof: it confirms a 12-digit number
// is mathematically well-formed (so typos / random fakes are rejected), the way
// most government portals gate the field. Genuine identity verification requires
// UIDAI's OTP-consented API (AUA/KUA licensed) and is intentionally out of scope.
//
// Rules enforced:
//   1. Exactly 12 digits (unchanged from the previous /^\d{12}$/ contract).
//   2. First digit in 2-9 — UIDAI reserves leading 0 and 1 for internal numbers
//      and never issues a citizen Aadhaar starting with them.
//   3. Verhoeff checksum — the 12th digit is a Verhoeff check digit over the
//      first 11. Catches all single-digit errors and most adjacent transpositions.
// =============================================================================

// Verhoeff dihedral-group multiplication table.
const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

// Verhoeff permutation table (position-dependent).
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * Verhoeff checksum verification. Returns true when the digit string (check
 * digit included) is self-consistent, i.e. the running product collapses to 0.
 */
function verhoeffValid(numStr) {
  let c = 0;
  const rev = numStr.split('').reverse();
  for (let i = 0; i < rev.length; i++) {
    const digit = parseInt(rev[i], 10);
    if (Number.isNaN(digit)) return false;
    c = D[c][P[i % 8][digit]];
  }
  return c === 0;
}

/**
 * Validate an Aadhaar number.
 * @param {*} value - candidate (only strings can be valid).
 * @returns {{valid: boolean, message: string}}
 */
function validateAadhaar(value) {
  if (typeof value !== 'string') {
    return { valid: false, message: 'Aadhar number must be exactly 12 digits.' };
  }
  const aadhar = value.trim();
  if (!/^\d{12}$/.test(aadhar)) {
    return { valid: false, message: 'Aadhar number must be exactly 12 digits.' };
  }
  if (aadhar[0] === '0' || aadhar[0] === '1') {
    return { valid: false, message: 'Invalid Aadhar number — cannot start with 0 or 1.' };
  }
  if (!verhoeffValid(aadhar)) {
    return { valid: false, message: 'Invalid Aadhar number — checksum failed. Please re-check the number.' };
  }
  return { valid: true, message: '' };
}

module.exports = { validateAadhaar, verhoeffValid };
