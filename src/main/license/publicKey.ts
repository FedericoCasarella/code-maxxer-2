/**
 * Chiave PUBBLICA Ed25519 che firma i token di licenza (server licenze su federicocasarella.com).
 *
 * Coppia di produzione: la privata sta nel secret LICENSE_PRIVATE_KEY_B64 del repository del sito (e nel .env del server).
 * Se la cambi, cambia anche qui (GET https://federicocasarella.com/api/licenze/chiave-pubblica). Formati accettati:
 * PEM («-----BEGIN PUBLIC KEY-----…»), base64/base64url dei 32 byte grezzi, base64 del DER SPKI.
 * Finché è vuota la build protetta di produzione non parte (scripts/build-protected.mjs si ferma).
 * La chiave privata NON deve mai stare in questo repository.
 */
export const LICENSE_PUBLIC_KEY = 'MCowBQYDK2VwAyEA0YDrcweoda3G3/w48vnt7fjeEal3KbfkiX8p7u4Xm0s=';
