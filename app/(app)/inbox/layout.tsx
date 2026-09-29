import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { Button } from "@/components/ui/button";
import { InboxShell } from "./inbox-shell";
import InboxLoading from "./loading";

export default async function InboxLayout({ children }: { children: React.ReactNode }) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();

  const { data: channel } = await supabase
    .from("channels")
    .select("id, status")
    .eq("org_id", membership.orgId)
    .eq("status", "connected")
    .maybeSingle();

  if (!channel) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <h1 className="text-xl font-semibold">Nenhum número conectado</h1>
        <p className="max-w-sm text-sm text-muted-foreground">
          Conecte o número oficial do WhatsApp (Meta Cloud API) para começar a receber e responder
          conversas por aqui.
        </p>
        <Button asChild>
          <Link href="/configuracoes/whatsapp">Conectar WhatsApp</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* useSearchParams (filtros na URL) pede um Suspense acima. */}
      <Suspense fallback={<InboxLoading />}>
        <InboxShell orgId={membership.orgId}>{children}</InboxShell>
      </Suspense>
    </div>
  );
}
