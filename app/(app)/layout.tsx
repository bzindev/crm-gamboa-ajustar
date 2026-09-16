import { redirect } from "next/navigation";
import { getActiveOrgMembership, listUserOrganizations } from "@/lib/auth/session";
import { Sidebar } from "@/components/app-shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const membership = await getActiveOrgMembership();

  // Sem organização aceita ainda (usuário novo, ou convite pendente de
  // aceitar) — /onboarding é fora deste layout de propósito, para não
  // entrar em loop de redirecionamento.
  if (!membership) {
    redirect("/onboarding");
  }

  const orgs = await listUserOrganizations();

  return (
    <div className="flex flex-1">
      <Sidebar membership={membership} orgs={orgs} />
      <main className="flex-1 overflow-y-auto bg-muted/30 p-6">{children}</main>
    </div>
  );
}
