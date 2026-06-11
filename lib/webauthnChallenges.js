// Almacén en memoria de los retos (challenges) de WebAuthn.
// La app tiene un único admin, así que basta con una entrada por flujo
// (login / registro) con un TTL corto.
const TTL_MS = 5 * 60 * 1000;
const challenges = new Map();

export function setChallenge(key, challenge) {
  challenges.set(key, { challenge, expires: Date.now() + TTL_MS });
}

export function takeChallenge(key) {
  const entry = challenges.get(key);
  challenges.delete(key);
  if (!entry || entry.expires < Date.now()) return null;
  return entry.challenge;
}
