import { withCurrentAdmin } from "@local/lib/api-auth";
import { apiError, json, jsonBodyError, LOCAL_JSON_BODY_LIMITS, readJsonBody } from "@local/lib/http";
import { fetchPublicSubscriptionText } from "@local/lib/cloudflare-source-import";
import { isCloudflareDeployment } from "@local/lib/cloudflare-bindings";

function getStringField(body: unknown, key: string): string {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "";
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: Request) {
  return withCurrentAdmin(async () => {
    const parsedBody = await readJsonBody(request, LOCAL_JSON_BODY_LIMITS.small);
    if (!parsedBody.ok) return jsonBodyError(parsedBody);
    const body = parsedBody.value;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid JSON body.", "BAD_REQUEST", 400);
    }

    const sourceUrl = getStringField(body, "url");
    let content: string;
    let headers: Record<string, string>;
    let parseResult: unknown;
    let failure: { error: string; status: number; code?: string; errorInfo?: unknown } | null = null;

    if (isCloudflareDeployment()) {
      const result = await fetchPublicSubscriptionText(sourceUrl);
      if (!result.ok) {
        failure = {
          error: result.error,
          status: result.status,
          code: result.status === 400 || result.status === 310 ? "BAD_REQUEST" : "INTERNAL_ERROR",
        };
      }
      content = result.ok ? result.content : "";
      headers = result.ok ? result.headers : {};
      const userinfoUrl = getStringField(body, "userinfoUrl");
      if (!failure && userinfoUrl) {
        const userinfo = await fetchPublicSubscriptionText(userinfoUrl);
        if (userinfo.ok) headers = { ...headers, ...userinfo.headers };
      }
    } else {
      const [{ importSourceUrlDirect }, { buildSourceImportParseResult }] = await Promise.all([
        import("@local/lib/source-import"),
        import("@subboost/server-core/subscription"),
      ]);
      const result = await importSourceUrlDirect({
        url: sourceUrl,
        userinfoUrl: getStringField(body, "userinfoUrl") || undefined,
        userinfoUserAgent: getStringField(body, "userinfoUserAgent") || undefined,
      });
      if (!result.ok) {
        failure = {
          error: result.error,
          status: result.responseStatus && result.responseStatus >= 400 ? result.responseStatus : 400,
          code: result.errorInfo.category === "format" ? "BAD_REQUEST" : "INTERNAL_ERROR",
          errorInfo: result.errorInfo,
        };
      }
      content = result.ok ? result.content : "";
      headers = result.ok ? result.headers : {};
      if (result.ok) parseResult = buildSourceImportParseResult(result);
    }

    if (failure) {
      return json(
        {
          error: failure.error,
          code: failure.code ?? (failure.status === 400 ? "BAD_REQUEST" : "INTERNAL_ERROR"),
          ...(failure.errorInfo ? { errorInfo: failure.errorInfo } : {}),
        },
        failure.status
      );
    }

    return json({ content, headers, ...(parseResult ? { parseResult } : {}) });
  });
}
