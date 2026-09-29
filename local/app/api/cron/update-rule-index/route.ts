import { NextRequest, NextResponse } from "next/server";
import { requireLocalCronAuth } from "@local/lib/cron-auth";
import { refreshRuleIndex } from "@local/lib/rule-catalog";
import { isCloudflareDeployment } from "@local/lib/cloudflare-bindings";

export async function POST(request: NextRequest) {
  if (isCloudflareDeployment()) return new Response("Not found", { status: 404 });

  const authError = requireLocalCronAuth(request);
  if (authError) return authError;

  const force = new URL(request.url).searchParams.get("force") === "1";
  const result = await refreshRuleIndex({ force });

  if (result.status === "unavailable") {
    return NextResponse.json(
      {
        success: false,
        status: result.status,
        error: result.error,
        code: "RULE_INDEX_UNAVAILABLE",
      },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    status: result.status,
    source: result.index.source,
    fetchedAt: result.index.fetchedAt,
    expiresAt: result.index.expiresAt,
    diff: result.diff,
    ...(result.error ? { error: result.error } : {}),
  });
}
