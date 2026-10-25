// W's gas float. Rents are read live because devnet rent differs from the fork's mainnet rent (Pitfall 7).
import type { Connection, PublicKey } from "@solana/web3.js";

// Pitfall 3: W must stay rent-exempt and pays rent for its child ATA, a buyback Q ATA and the volume
// accumulator (137 bytes). Any excess stays in W as its gas float (PROJECT.md item 9).
export async function wFloat(conn: Connection, w: PublicKey, bytes = [0, 170, 170, 137]): Promise<number> {
  const rents = await Promise.all(bytes.map((b) => conn.getMinimumBalanceForRentExemption(b)));
  const need = rents.reduce((a, b) => a + b, 0) - (await conn.getBalance(w));
  return Math.max(0, need);
}
