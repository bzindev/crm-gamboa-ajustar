import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CampaignForm } from "./campaign-form";

export default async function NovaCampanhaPage() {
  const membership = await requireRoleOrRedirect("manager");
  const supabase = await createClient();

  const [{ data: templates }, { data: contacts }] = await Promise.all([
    supabase
      .from("message_templates")
      .select("id, name, category, body_text")
      .eq("org_id", membership.orgId)
      .eq("status", "approved")
      .order("name"),
    supabase
      .from("contacts")
      .select("id, name, phone_e164, opted_in")
      .eq("org_id", membership.orgId)
      .order("name"),
  ]);

  if (!templates || templates.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Nenhum template aprovado ainda</CardTitle>
          <CardDescription>
            Crie um template e espere a aprovação da Meta antes de montar uma campanha.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/disparos/templates">Ir para Templates</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <CampaignForm
      templates={templates}
      contacts={(contacts ?? []).map((c) => ({
        id: c.id,
        name: c.name ?? c.phone_e164,
        phone: c.phone_e164,
        optedIn: c.opted_in,
      }))}
    />
  );
}
