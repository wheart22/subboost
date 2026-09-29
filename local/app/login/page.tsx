import { CloudflarePasswordLogin } from "@local/components/cloudflare-password-login";
import { LocalLogin } from "@local/components/local-login";

export default function LoginPage() {
  if (process.env.NEXT_PUBLIC_SUBBOOST_CLOUDFLARE === "true") return <CloudflarePasswordLogin />;
  return <LocalLogin />;
}
