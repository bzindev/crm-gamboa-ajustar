import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { MfaChallengeForm } from "./mfa-challenge-form";

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string }>;
}) {
  const { redirectTo } = await searchParams;
  return <MfaChallengeForm redirectTo={safeRedirectPath(redirectTo)} />;
}
