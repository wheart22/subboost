"use client";

import * as React from "react";
import Image from "next/image";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { Button } from "@subboost/ui/components/ui/button";
import { PasswordField } from "@subboost/ui/components/ui/password-field";

async function readJson(response: Response): Promise<{ error?: string }> {
  return (await response.json().catch(() => ({}))) as { error?: string };
}

function getSafeNextPath(): string {
  const candidate = new URLSearchParams(window.location.search).get("next") || "/dashboard";
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.startsWith("/api/")) return "/dashboard";
  return candidate;
}

export function CloudflarePasswordLogin() {
  const [password, setPassword] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState("");

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const body = await readJson(response);
      if (!response.ok) throw new Error(body.error || "登录失败，请重试");
      window.location.replace(getSafeNextPath());
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "登录失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link href="/login" className="inline-flex items-center gap-2">
            <Image src="/logo.png" alt="SubBoost" width={64} height={64} className="rounded-2xl shadow-lg shadow-blue-500/25" />
          </Link>
          <h1 className="mt-4 text-2xl font-bold text-white">SubBoost 管理端</h1>
          <p className="mt-2 text-white/50">输入管理密码继续</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur-sm">
          <PasswordField
            label="管理密码"
            autoComplete="current-password"
            placeholder="管理密码"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12"
          />
          {error ? <p className="text-sm text-red-400" aria-live="polite">{error}</p> : null}
          <Button type="submit" disabled={loading || password.length === 0} className="h-12 w-full">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            登录
          </Button>
        </form>
      </div>
    </div>
  );
}
