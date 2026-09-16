import { redirect } from "next/navigation";
import { getUser, getActiveOrgMembership } from "@/lib/auth/session";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  const user = await getUser();
  if (!user) {
    redirect("/login");
  }

  // Já tem organização? Não faz sentido onboarding de novo.
  const membership = await getActiveOrgMembership();
  if (membership) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-sm">
        <OnboardingForm />
      </div>
    </div>
  );
}
