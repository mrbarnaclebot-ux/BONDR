// Ed25519 signature check with node:crypto and bs58 only, so web can verify a wallet's signMessage without
// loading web3.js or the pump SDK.
import { createPublicKey, verify } from "node:crypto";
import bs58 from "bs58";

const SIG = 64;

/** True when sig is the signer's Ed25519 signature over message. signer: a base58 address or a PublicKey. */
export function signatureOk(message: Uint8Array, sig: Uint8Array, signer: { toString(): string }): boolean {
  if (sig.length !== SIG) return false;
  try {
    const raw = bs58.decode(String(signer));
    if (raw.length !== 32) return false;
    const x = Buffer.from(raw).toString("base64url");
    const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x }, format: "jwk" });
    return verify(null, message, key, sig);
  } catch {
    return false;
  }
}
