import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowLeft,
  ArrowRightLeft,
  Briefcase,
  MessageCircle,
  MessagesSquare,
  Send,
  ShieldCheck,
  UserPlus,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { buildContactTimeline, type TimelineKind } from "@/lib/crm/contact-timeline";
import { messagePreview } from "@/lib/inbox/message-preview";
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
import { AnonymizeButton } from "./anonymize-button";

const KIND_ICON: Record<TimelineKind, React.ComponentType<{ className?: string }>> = {
  contact: UserPlus,
  lead: Briefcase,
  stage: ArrowRightLeft,
  conversation: MessagesSquare,
  message_in: MessageCircle,
  message_out: Send,
  consent: ShieldCheck,
};

async function loadTimeline(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
  contact: { id: string; name: string | null; created_at: string },
  leads: { id: string; title: string; created_at: string }[],
) {
  const { data: conversations } = await supabase
    .from("conversations")
    .select("id")
    .eq("org_id", orgId)
    .eq("contact_id", contact.id);
  const conversationIds = (conversations ?? []).map((c) => c.id);
  const resourceIds = [...leads.map((l) => l.id), ...conversationIds];

  const [{ data: messages }, { data: consents }, { data: audit }, { data: stages }, { data: members }] =
    await Promise.all([
      conversationIds.length
        ? supabase
            .from("messages")
            .select("direction, type, content, created_at, sent_by")
            .eq("org_id", orgId)
            .in("conversation_id", conversationIds)
            .order("created_at", { ascending: false })
            .limit(150)
        : Promise.resolve({ data: [] }),
      supabase.from("consents").select("created_at, revoked_at, source").eq("org_id", orgId).eq("contact_id", contact.id),
      resourceIds.length
        ? supabase
            .from("audit_log")
            .select("action, resource_type, resource_id, actor_id, before, after, created_at")
            .eq("org_id", orgId)
            .in("resource_id", resourceIds)
            .order("created_at", { ascending: false })
            .limit(200)
        : Promise.resolve({ data: [] }),
      supabase.from("pipeline_stages").select("id, name").eq("org_id", orgId),
      supabase.from("org_members").select("user_id, profiles(full_name)").eq("org_id", orgId),
    ]);

  return buildContactTimeline({
    contact,
    leads,
    messages: (messages ?? []).map((m) => ({
      direction: m.direction as "inbound" | "outbound",
      body: messagePreview(m.type, m.content),
      created_at: m.created_at,
      sent_by: m.sent_by,
    })),
    consents: consents ?? [],
    audit: (audit ?? []) as Parameters<typeof buildContactTimeline>[0]["audit"],
    stageNames: new Map((stages ?? []).map((s) => [s.id, s.name])),
    userNames: new Map(
      (members ?? []).map((m) => {
        const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
        return [m.user_id, profile?.full_name ?? "(sem nome)"];
      }),
    ),
  });
}

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

  // As duas consultas não dependem uma da outra (leads é filtrado pelo
  // contactId da URL, não por algo que só a consulta do contato revela) —
  // rodar em paralelo em vez de esperar uma terminar pra começar a outra.
  const [{ data: contact }, { data: leadsData }] = await Promise.all([
    supabase
      .from("contacts")
      .select("id, name, phone_e164, email, opted_in, opted_out_at, anonymized_at, created_at")
      .eq("id", contactId)
      .eq("org_id", membership.orgId)
      .single(),
    supabase
      .from("leads")
      .select(
        "id, title, value_cents, status, created_at, pipeline_stages(name), lead_tags(tags(id, name, color))",
      )
      .eq("contact_id", contactId)
      .order("created_at", { ascending: false }),
  ]);

  if (!contact) {
    notFound();
  }

  const timeline = await loadTimeline(supabase, membership.orgId, contact, leadsData ?? []);
  const isAdmin = membership.role === "admin" || membership.role === "owner";

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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{contact.name}</h1>
          <p className="font-mono text-sm text-muted-foreground">
            {contact.anonymized_at ? "dados removidos" : contact.phone_e164}
          </p>
          {contact.anonymized_at && (
            <Badge variant="outline" className="mt-1">
              Anonimizado (LGPD) em {new Date(contact.anonymized_at).toLocaleDateString("pt-BR")}
            </Badge>
          )}
        </div>
        {!contact.anonymized_at && (
          <div className="flex flex-wrap gap-2">
            <ContactDialog contact={contact} trigger={<Button variant="outline">Editar</Button>} />
            {isAdmin && (
              <>
                <Button variant="outline" asChild>
                  <a href={`/contatos/${contact.id}/exportar`}>Exportar dados (LGPD)</a>
                </Button>
                <AnonymizeButton contactId={contact.id} />
              </>
            )}
          </div>
        )}
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

      <Card>
        <CardHeader>
          <CardTitle>Linha do tempo</CardTitle>
          <CardDescription>
            Tudo que aconteceu com este cliente, do mais recente pro mais antigo — mensagens, negócios,
            mudanças de etapa e atendimento.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ol className="relative flex flex-col gap-4 border-l pl-6">
            {timeline.map((event, index) => {
              const Icon = KIND_ICON[event.kind];
              return (
                <li key={`${event.at}-${index}`} className="relative">
                  <span className="absolute -left-[33px] flex size-6 items-center justify-center rounded-full border bg-background">
                    <Icon className="size-3.5 text-primary" />
                  </span>
                  <p className="text-sm font-medium">{event.title}</p>
                  {event.detail && (
                    <p className="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">{event.detail}</p>
                  )}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {new Date(event.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                    {event.actor && ` · ${event.actor}`}
                  </p>
                </li>
              );
            })}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
