"use client";

import * as React from "react";
import { usePathname } from "next/navigation";

type AuthState = { authenticated?: unknown };

async function getAuthenticated(): Promise<boolean> {
  const response = await fetch("/api/auth/me", { cache: "no-store" });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => ({}))) as AuthState;
  return body.authenticated === true;
}

export function CloudflareAuthGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [allowed, setAllowed] = React.useState(false);
  const cloudflareMode = process.env.NEXT_PUBLIC_SUBBOOST_CLOUDFLARE === "true";

  React.useEffect(() => {
    if (!cloudflareMode) {
      setAllowed(true);
      return;
    }

    let active = true;
    setAllowed(false);
    void getAuthenticated()
      .then((authenticated) => {
        if (!active) return;
        if (pathname === "/login") {
          if (authenticated) window.location.replace("/dashboard");
          else setAllowed(true);
          return;
        }
        if (!authenticated) {
          const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
          window.location.replace(`/login?next=${encodeURIComponent(next)}`);
          return;
        }
        setAllowed(true);
      })
      .catch(() => {
        if (!active) return;
        if (pathname === "/login") setAllowed(true);
        else window.location.replace(`/login?next=${encodeURIComponent(pathname || "/dashboard")}`);
      });

    return () => {
      active = false;
    };
  }, [cloudflareMode, pathname]);

  if (!cloudflareMode || allowed) return children;

  return (
    <div className="flex min-h-screen items-center justify-center text-sm text-white/60" role="status">
      正在验证访问权限…
    </div>
  );
}
