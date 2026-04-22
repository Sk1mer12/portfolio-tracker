import { NextRequest, NextResponse } from "next/server";
import { fetchTokenBalances } from "@/lib/ankr";
import { SUPPORTED_CHAINS } from "@/lib/chains";
import { fetchNativePrices, fetchTokenPricesByAddress, COINGECKO_PLATFORM } from "@/lib/coingecko";
import type { TokenBalance } from "@/types/portfolio";

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;
  const searchParams = request.nextUrl.searchParams;
  const chainsParam = searchParams.get("chains");
  const chainIds = chainsParam
    ? chainsParam.split(",").map(Number).filter(Boolean)
    : SUPPORTED_CHAINS.map((c) => c.id);

  try {
    const tokens = await fetchTokenBalances(address, chainIds);

    // Enrich native tokens with CoinGecko prices
    const nativeSymbols = Array.from(new Set(tokens.filter((t) => t.isNative).map((t) => t.symbol)));
    const nativePrices = await fetchNativePrices(nativeSymbols);

    // Fill in missing prices for native tokens
    for (const token of tokens) {
      if (token.isNative && token.usdPrice == null) {
        const price = nativePrices[token.symbol];
        if (price != null) {
          token.usdPrice = price;
          token.usdValue = token.balanceFormatted * price;
        }
      }
    }

    // Enrich ERC20s missing prices per chain
    const byChain: Record<number, TokenBalance[]> = {};
    for (const token of tokens) {
      if (!token.isNative && token.usdPrice == null) {
        (byChain[token.chainId] ??= []).push(token);
      }
    }

    await Promise.allSettled(
      Object.entries(byChain).map(async ([chainIdStr, chainTokens]) => {
        const chainId = Number(chainIdStr);
        const platform = COINGECKO_PLATFORM[chainId];
        if (!platform) return;
        const addresses = chainTokens.map((t) => t.address).filter((a) => a && a !== "native");
        if (addresses.length === 0) return;
        const prices = await fetchTokenPricesByAddress(platform, addresses);
        for (const token of chainTokens) {
          const price = prices[token.address.toLowerCase()];
          if (price != null) {
            token.usdPrice = price;
            token.usdValue = token.balanceFormatted * price;
          }
        }
      })
    );

    return NextResponse.json({ tokens });
  } catch (err) {
    console.error("[/api/tokens]", err);
    return NextResponse.json({ error: "Failed to fetch token balances" }, { status: 500 });
  }
}
