/**
 * GoPlus Security API — malicious token detection
 * Docs: https://gopluslabs.io
 *
 * Free, no API key required. Returns security flags per contract address.
 */

const BASE = "https://api.gopluslabs.io/api/v1/token_security";
const BATCH_SIZE = 50;

/**
 * Given a list of ERC-20 tokens, returns a Set of `${chainId}:${address}` keys
 * for any token flagged as a honeypot or blacklisted by GoPlus.
 *
 * Native tokens (address === "native") are skipped.
 * On any network or parse error, silently skips that batch (fail open).
 */
export async function fetchMaliciousTokens(
  tokens: { address: string; chainId: number }[]
): Promise<Set<string>> {
  const malicious = new Set<string>();

  // Only ERC-20s have contract addresses to check
  const erc20s = tokens.filter(
    (t) => t.address && t.address !== "native"
  );
  if (erc20s.length === 0) return malicious;

  // Group by chain
  const byChain: Record<number, string[]> = {};
  for (const t of erc20s) {
    (byChain[t.chainId] ??= []).push(t.address.toLowerCase());
  }

  await Promise.allSettled(
    Object.entries(byChain).map(async ([chainIdStr, addresses]) => {
      const chainId = Number(chainIdStr);

      // Batch into groups of BATCH_SIZE
      for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
        const batch = addresses.slice(i, i + BATCH_SIZE);
        try {
          const res = await fetch(
            `${BASE}/${chainId}?contract_addresses=${batch.join(",")}`,
            { signal: AbortSignal.timeout(8000) }
          );
          if (!res.ok) continue;

          const json = await res.json();
          if (json.code !== 1 || typeof json.result !== "object") continue;

          for (const [addr, info] of Object.entries(json.result as Record<string, any>)) {
            if (info?.is_honeypot === "1" || info?.is_blacklisted === "1") {
              malicious.add(`${chainId}:${addr.toLowerCase()}`);
            }
          }
        } catch {
          // Network error or timeout — skip batch, fail open
        }
      }
    })
  );

  return malicious;
}
