/**
 * Blockscout public REST API helpers.
 *
 * Used for two purposes:
 *  1. Contract verification checks (this file)
 *  2. Vault deposit history (lib/erc4626.ts, which has its own copy of BLOCKSCOUT_BASE)
 */

export const BLOCKSCOUT_BASE: Record<number, string> = {
  1:      "https://eth.blockscout.com",
  8453:   "https://base.blockscout.com",
  42161:  "https://arbitrum.blockscout.com",
  10:     "https://optimism.blockscout.com",
  56:     "https://bsc.blockscout.com",
  43114:  "https://avalanche.blockscout.com",
  137:    "https://polygon.blockscout.com",
};

/**
 * For each ERC-20 token, checks Blockscout's /api/v2/addresses/{address} endpoint
 * and returns a Set of `${chainId}:${address}` keys for contracts whose source code
 * is NOT verified.
 *
 * - Native tokens are skipped (always considered valid).
 * - Tokens on chains not supported by Blockscout are skipped (fail open).
 * - Any network/timeout error is treated as unknown → token is kept (fail open).
 * - EOAs (is_contract: false) are also skipped — Ankr shouldn't return those,
 *   but if it does we leave them to other filters.
 */
export async function fetchUnverifiedContracts(
  tokens: { address: string; chainId: number }[]
): Promise<Set<string>> {
  const unverified = new Set<string>();

  const erc20s = tokens.filter((t) => t.address && t.address !== "native");
  if (erc20s.length === 0) return unverified;

  await Promise.allSettled(
    erc20s.map(async (t) => {
      const explorer = BLOCKSCOUT_BASE[t.chainId];
      if (!explorer) return; // chain not in Blockscout — fail open

      try {
        const res = await fetch(`${explorer}/api/v2/addresses/${t.address}`, {
          signal: AbortSignal.timeout(6000),
          next: { revalidate: 0 },
        } as RequestInit);

        if (!res.ok) return; // network error — fail open

        const data = await res.json();

        // Only flag as unverified when we're certain:
        //   is_contract === true  → it is a smart contract (not an EOA)
        //   is_verified === false → source code has not been published/verified
        if (data.is_contract === true && data.is_verified === false) {
          unverified.add(`${t.chainId}:${t.address.toLowerCase()}`);
        }
      } catch {
        // Timeout or parse error — fail open
      }
    })
  );

  return unverified;
}
