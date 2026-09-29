"use client";
import {
  SubscriptionDashboardSurface,
  type DashboardSurfaceAdapter,
} from "@subboost/ui/dashboard/subscription-dashboard-surface";
import { readJsonResponse } from "@subboost/ui/product/client-response";
import type { RefreshSubscriptionResponse, Subscription } from "@subboost/ui/dashboard/dashboard-types";
import { LOCAL_AUTO_UPDATE_POLICY } from "@local/lib/auto-update-policy";
import { parseSubscription } from "@subboost/core/parser";
import { prepareRefreshCacheResult } from "@subboost/server-core/subscription/refresh-cache-result";
import { refreshNodeSnapshot } from "@subboost/server-core/subscription/refresh-node-snapshot";

function resolveLocalDashboardDownloadUrl(subscription: Subscription): string {
  try {
    const url = new URL(subscription.subscriptionUrl, window.location.href);
    if (url.pathname.includes("/api/subscriptions/")) {
      return `${window.location.origin}${url.pathname}${url.search}`;
    }
  } catch {}
  return subscription.subscriptionUrl;
}

async function refreshSubscriptionInBrowser(id: string): Promise<RefreshSubscriptionResponse> {
  const detailResponse = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, { cache: "no-store" });
  const detailData = await detailResponse.json().catch(() => ({})) as {
    error?: string;
    subscription?: { id: string; name: string; urls: string[]; nodes: Parameters<typeof refreshNodeSnapshot>[0]["storedNodes"]; config: Record<string, unknown> };
  };
  if (!detailResponse.ok || !detailData.subscription) {
    throw new Error(detailData.error || "读取订阅失败");
  }

  const subscription = detailData.subscription;
  const snapshot = await refreshNodeSnapshot({
    config: subscription.config,
    urls: subscription.urls,
    storedNodes: subscription.nodes,
    fetchUrlNodes: async (source) => {
      const response = await fetch("/api/source-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: source.content,
          userinfoUrl: source.userinfoUrl,
          userinfoUserAgent: source.userinfoUserAgent,
        }),
      });
      const data = await response.json().catch(() => ({})) as {
        content?: string;
        headers?: Record<string, string>;
        error?: string;
      };
      if (!response.ok) {
        return { ok: false, nodes: [], responseStatus: response.status, error: data.error || "获取订阅失败" };
      }
      const parsed = parseSubscription(typeof data.content === "string" ? data.content : "");
      return {
        ok: parsed.nodes.length > 0,
        nodes: parsed.nodes,
        errors: parsed.errors,
        headers: data.headers || {},
        responseStatus: response.status,
      };
    },
    fetchUrlUserInfo: async (source) => {
      if (!source.userinfoUrl) return undefined;
      const response = await fetch("/api/source-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: source.userinfoUrl, userinfoUserAgent: source.userinfoUserAgent }),
      });
      if (!response.ok) return undefined;
      const data = await response.json().catch(() => ({})) as { headers?: Record<string, string> };
      return data.headers;
    },
  });

  const prepared = prepareRefreshCacheResult({
    config: subscription.config,
    snapshot,
    maxNodesPerSubscription: 10_000,
  });
  if (!prepared.ok) {
    const message = prepared.reason === "all_sources_failed"
      ? "刷新失败：所有导入源均不可用，已保留旧快照。"
      : prepared.reason === "empty_result"
        ? "无可用节点：导入源不可用或解析失败。"
        : `已超过节点数量上限 (${prepared.maxNodesPerSubscription ?? 10_000})`;
    throw new Error(message);
  }

  const saveResponse = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: subscription.name,
      nodes: prepared.cacheEntry.nodes,
      config: prepared.refreshedConfig,
      subscriptionInfo: prepared.cacheEntry.subscriptionInfo,
      generatedYaml: prepared.generatedYaml,
    }),
  });
  const savedData = await saveResponse.json().catch(() => ({})) as { error?: string };
  if (!saveResponse.ok) throw new Error(savedData.error || "保存刷新结果失败");

  return {
    nodeCount: prepared.nodeCount,
    attemptedUrlFetch: snapshot.attemptedUrlFetch,
    usedUrlFetch: snapshot.usedUrlFetch,
    refreshableSourceCount: snapshot.refreshableSourceCount,
    refreshedSourceCount: snapshot.refreshedSourceCount,
    refreshedUrlSourceCount: snapshot.refreshedUrlSourceCount,
    refreshedStaticSourceCount: snapshot.refreshedStaticSourceCount,
    failedSourceCount: snapshot.failedSourceCount,
  };
}

const localDashboardAdapter: DashboardSurfaceAdapter = {
  loginHref: "/login",
  newSubscriptionHref: "/?newSubscription=1",
  templatesHref: "/templates",
  settingsHref: "/dashboard/settings",
  settingsDescription: "查看本地管理员和运行状态",
  autoUpdateIntervalPolicy: LOCAL_AUTO_UPDATE_POLICY,
  fetchSubscriptions: async () => {
    const response = await fetch("/api/subscriptions");
    const data = await readJsonResponse<{ subscriptions?: Subscription[]; error?: string }>(response, "获取订阅失败");
    return Array.isArray(data.subscriptions) ? data.subscriptions : [];
  },
  deleteSubscription: async (id) => {
    const response = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" });
    await readJsonResponse<{ error?: string }>(response, "删除失败");
  },
  refreshSubscription: async (id) => {
    return refreshSubscriptionInBrowser(id);
  },
  updateSubscriptionSettings: async (id, payload) => {
    const response = await fetch(`/api/subscriptions/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    await readJsonResponse<{ error?: string }>(response, "保存失败");
  },
  resolveDownloadUrl: resolveLocalDashboardDownloadUrl,
};

export default function DashboardPage() {
  return <SubscriptionDashboardSurface adapter={localDashboardAdapter} />;
}
