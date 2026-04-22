import { NextRequest, NextResponse } from "next/server";
import { fetchDefiPositions } from "@/lib/ankr";
import { SUPPORTED_CHAINS } from "@/lib/chains";

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
    const positions = await fetchDefiPositions(address, chainIds);
    return NextResponse.json({ positions });
  } catch (err) {
    console.error("[/api/defi]", err);
    return NextResponse.json({ error: "Failed to fetch DeFi positions" }, { status: 500 });
  }
}
