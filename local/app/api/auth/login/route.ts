import bcrypt from "bcryptjs";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { apiError, getStringField, jsonBodyError, LOCAL_JSON_BODY_LIMITS, readJsonBody } from "@local/lib/http";
import { prisma } from "@local/lib/prisma";
import { isCloudflareDeployment } from "@local/lib/cloudflare-bindings";
import { sessionCookieOptions, signSession, SESSION_COOKIE } from "@local/lib/session";
import {
  consumeLocalRateLimit,
  getTrustedClientRateLimitKey,
  hashLocalRateLimitKey,
  localRateLimitResponse,
  resetLocalRateLimit,
} from "@local/lib/rate-limit";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const CLOUDFLARE_PASSWORD_MIN_LENGTH = 12;

async function loginWithCloudflarePassword(request: Request): Promise<Response> {
  const clientKey = getTrustedClientRateLimitKey(request) || hashLocalRateLimitKey("cloudflare-unknown-client");
  const clientLimit = consumeLocalRateLimit("auth-login-client", clientKey, {
    limit: 20,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!clientLimit.allowed) {
    return localRateLimitResponse("Too many login attempts. Try again later.", clientLimit.retryAfterSeconds);
  }

  const configuredPassword = process.env.APP_PASSWORD || "";
  if (configuredPassword.length < CLOUDFLARE_PASSWORD_MIN_LENGTH) {
    return apiError("APP_PASSWORD must be configured with at least 12 characters.", "CONFIGURATION_ERROR", 503);
  }

  const parsedBody = await readJsonBody(request, LOCAL_JSON_BODY_LIMITS.small);
  if (!parsedBody.ok) return jsonBodyError(parsedBody);
  const value = parsedBody.value;
  const password =
    value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).password === "string"
      ? (value as Record<string, string>).password
      : "";
  const suppliedDigest = createHash("sha256").update(password).digest();
  const configuredDigest = createHash("sha256").update(configuredPassword).digest();
  if (!timingSafeEqual(suppliedDigest, configuredDigest)) {
    return apiError("Invalid password.", "UNAUTHORIZED", 401);
  }

  const admin = await prisma.localAdmin.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, username: true },
  });
  if (!admin) {
    return apiError("The owner record is not initialized. Run the deployment setup step.", "CONFIGURATION_ERROR", 503);
  }

  resetLocalRateLimit("auth-login-client", clientKey);
  const response = NextResponse.json({ success: true, user: { id: admin.id, username: admin.username } });
  response.cookies.set(SESSION_COOKIE, await signSession({ adminId: admin.id, username: admin.username }), sessionCookieOptions());
  return response;
}

export async function POST(request: Request) {
  if (isCloudflareDeployment()) return loginWithCloudflarePassword(request);

  const clientKey = getTrustedClientRateLimitKey(request);
  if (clientKey) {
    const clientLimit = consumeLocalRateLimit("auth-login-client", clientKey, {
      limit: 30,
      windowMs: LOGIN_WINDOW_MS,
    });
    if (!clientLimit.allowed) {
      return localRateLimitResponse("Too many login attempts. Try again later.", clientLimit.retryAfterSeconds);
    }
  }

  const parsedBody = await readJsonBody(request, LOCAL_JSON_BODY_LIMITS.small);
  if (!parsedBody.ok) return jsonBodyError(parsedBody);
  const body = parsedBody.value;

  const username = getStringField(body, "username");
  const password = getStringField(body, "password");
  const usernameLimitKey = hashLocalRateLimitKey(username.toLowerCase() || "missing");
  const usernameLimit = consumeLocalRateLimit("auth-login-username", usernameLimitKey, {
    limit: 8,
    windowMs: LOGIN_WINDOW_MS,
  });
  if (!usernameLimit.allowed) {
    return localRateLimitResponse("Too many login attempts. Try again later.", usernameLimit.retryAfterSeconds);
  }
  const admin = username
    ? await prisma.localAdmin.findUnique({ where: { username }, select: { id: true, username: true, passwordHash: true } })
    : null;
  const valid = admin ? await bcrypt.compare(password, admin.passwordHash) : false;
  if (!admin || !valid) {
    return apiError("Invalid username or password.", "UNAUTHORIZED", 401);
  }

  resetLocalRateLimit("auth-login-username", usernameLimitKey);

  await prisma.localAdmin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
  const response = NextResponse.json({ success: true, user: { id: admin.id, username: admin.username } });
  response.cookies.set(SESSION_COOKIE, await signSession({ adminId: admin.id, username: admin.username }), sessionCookieOptions());
  return response;
}
