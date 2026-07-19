import { NextResponse } from "next/server";
import { getReflectorStatus } from "../../../lib/p25";

export const dynamic = "force-dynamic";

export async function GET() {
  const status = await getReflectorStatus();
  return NextResponse.json(status, {
    headers: { "Cache-Control": "public, max-age=5, stale-while-revalidate=10" },
  });
}
