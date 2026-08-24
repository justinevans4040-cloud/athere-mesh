const MINIMUM_BEARER_BYTES = 32;
const MAXIMUM_BEARER_BYTES = 512;
const VISIBLE_PRINTABLE_ASCII = /^[\x21-\x7e]+$/;

export function isValidBearerCredential(value) {
  if (typeof value !== 'string' || !VISIBLE_PRINTABLE_ASCII.test(value)) return false;
  const bytes = Buffer.byteLength(value, 'ascii');
  return bytes >= MINIMUM_BEARER_BYTES && bytes <= MAXIMUM_BEARER_BYTES;
}

export function requireBearerCredential(value, label = 'authToken') {
  if (!isValidBearerCredential(value)) throw new TypeError(`${label} must be a strong bearer credential`);
  return value;
}
