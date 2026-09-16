import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { formatCents } from "@/lib/format/currency";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ContactDialog } from "../contact-dialog";

const STATUS_LABEL: Record<string, string> = {
  open: "em aberto",
  won: "ganho",
  lost: "perdido",
};

export default async function ContatoPerfilPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const { contactId } = await params;
  const supabase = await createClient();

  const { data: contact } = await supabase
    .from("contacts")
    .select("id, name, phone_e164, opted_in, opted_out_at, created_at")
    .eq("id", contactId)
    .eq("org_id", membership.orgId)
    .single();

  if (!contact) {
    notFound();
  }

  const { data: leadsData } = await supabase
    .from("leads")
    .select(
      "id, title, value_cents, status, created_at, pipeline_stages(name), lead_tags(tags(id, name, color))",
    )
    .eq("contact_id", contact.id)
    .order("created_at", { ascending: false });

  const leads = (leadsData ?? []).map((lead) => {
    const stage = Array.isArray(lead.pipeline_stages) ? lead.pipeline_stages[0] : lead.pipeline_stages;
    const tags = (lead.lead_tags ?? [])
      .map((lt) => (Array.isArray(lt.tags) ? lt.tags[0] : lt.tags))
      .filter((t): t is { id: string; name: string; color: string } => Boolean(t));
    return { ...lead, stageName: stage?.name ?? "—", tags };
  });

  const totalValueCents = leads.reduce((sum, l) => sum + (l.value_cents ?? 0), 0);
  const allTags = new Map<string, { name: string; color: string }>();
  for (const lead of leads) {
    for (const tag of lead.tags) allTags.set(tag.id, tag);
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/contatos"
        className="flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Voltar para Contatos
      </Link>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">{contact.phone_e164}</p>
        </div>
        <ContactDialog contact={contact} trigger={<Button variant="outline">Editar</Button>} />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Opt-in</CardDescription>
            <CardTitle className="text-lg">
              <Badge variant={contact.opted_in ? "default" : "secondary"}>
                {contact.opted_in ? "sim" : "não"}
              </Badge>
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Leads no total</CardDescription>
            <CardTitle className="text-2xl">{leads.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Valor somado</CardDescription>
            <CardTitle className="text-2xl">{formatCents(totalValueCents)}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {allTags.size > 0 && (
        <div className="flex flex-wrap gap-1">
          {[...allTags.values()].map((tag) => (
            <Badge
              key={tag.name}
              variant="outline"
              style={{ backgroundColor: `${tag.color}1a`, color: tag.color, borderColor: `${tag.color}40` }}
            >
              {tag.name}
            </Badge>
          ))}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Histórico de leads</CardTitle>
          <CardDescription>Todos os negócios envolvendo este contato.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {leads.map((lead) => (
            <div
              key={lead.id}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <div className="flex flex-col">
                <span className="font-medium">{lead.title}</span>
                <span className="text-xs text-muted-foreground">{lead.stageName}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={lead.status === "open" ? "secondary" : "outline"}>
                  {STATUS_LABEL[lead.status]}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatCents(lead.value_cents)}</span>
              </div>
            </div>
          ))}
          {leads.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhum lead ainda para este contato.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
