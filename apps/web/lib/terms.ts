// One date for the terms page and every consent row, so the two never drift. Change it with the wording.
export const TERMS_VERSION = "2026-10-19";

/**
 * The text Phantom signs at consent. The browser builds it to sign and the server rebuilds it to verify, so
 * both import this one function. The nonce and expiry come from GET /api/consent.
 */
export const consentMessage = (wallet: string, nonce: string, expires: string): string =>
  [
    "BONDR consent",
    "",
    `I have read the BONDR terms (version ${TERMS_VERSION}) and I am 18 or older. I agree that BONDR stores this wallet address and the time I accepted.`,
    "",
    "Signing this message is not a transaction and costs nothing.",
    "",
    `Wallet: ${wallet}`,
    `Nonce: ${nonce}`,
    `Expires: ${expires}`,
  ].join("\n");
