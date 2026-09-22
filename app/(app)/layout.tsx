import { redirect } from "next/navigation";
import {
  getActiveOrgMembership,
  listUserOrganizations,
  getCurrentProfile,
} from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Sidebar } from "@/components/app-shell/sidebar";
import { Topbar } from "@/components/app-shell/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const membership = await getActiveOrgMembership();

  // Sem organização aceita ainda (usuário novo, ou convite pendente de
  // aceitar) — /onboarding é fora deste layout de propósito, para não
  // entrar em loop de redirecionamento.
  if (!membership) {
    redirect("/onboarding");
  }

  const supabase = await createClient();
  const [orgs, profile, { data: notifications }] = await Promise.all([
    listUserOrganizations(),
    getCurrentProfile(),
    supabase
      .from("notifications")
      .select("id, type, title, body, link, read_at, created_at")
      .eq("user_id", membership.userId)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const userName = profile?.fullName ?? membership.orgName;

  return (
    <div className="flex flex-1">
      <Sidebar membership={membership} orgs={orgs} userName={userName} />
      <div className="flex flex-1 flex-col overflow-hidden print:overflow-visible">
        <Topbar userName={userName} notifications={notifications ?? []} />
        <main className="flex-1 overflow-y-auto bg-background p-6 print:overflow-visible print:bg-white print:p-0">
          {children}
        </main>
      </div>
    </div>
  );
}
