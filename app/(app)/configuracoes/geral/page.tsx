import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneralForm } from "./general-form";

export default async function ConfiguracoesGeralPage() {
  // Só admin/owner acessa — checado no servidor (lib/auth/require-role.ts),
  // não só escondendo o link na sidebar.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("name, slug, created_at")
    .eq("id", membership.orgId)
    .single();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Dados gerais da organização.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Organização</CardTitle>
          <CardDescription>
            Identificador: <span className="font-mono">{org?.slug}</span> · criada em{" "}
            {org?.created_at ? new Date(org.created_at).toLocaleDateString("pt-BR") : "—"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneralForm orgName={org?.name ?? ""} />
        </CardContent>
      </Card>
    </div>
  );
}
