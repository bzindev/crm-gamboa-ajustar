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
import { BusinessHoursForm } from "./business-hours-form";
import { DEFAULT_BUSINESS_HOURS, type BusinessHours } from "@/lib/crm/business-hours";

export default async function ConfiguracoesGeralPage() {
  // Só admin/owner acessa — checado no servidor (lib/auth/require-role.ts),
  // não só escondendo o link na sidebar.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("name, slug, created_at, business_hours")
    .eq("id", membership.orgId)
    .single();

  const businessHours: BusinessHours = {
    ...DEFAULT_BUSINESS_HOURS,
    ...((org?.business_hours as Partial<BusinessHours>) ?? {}),
  };

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">Dados gerais da organização.</p>

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

      <Card>
        <CardHeader>
          <CardTitle>Horário de expediente</CardTitle>
          <CardDescription>Usado pelo rodízio automático de vendedores.</CardDescription>
        </CardHeader>
        <CardContent>
          <BusinessHoursForm hours={businessHours} />
        </CardContent>
      </Card>
    </div>
  );
}
