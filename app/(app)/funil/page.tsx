import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership, ROLE_RANK } from "@/lib/auth/session";
import { getDefaultPipelineId } from "@/lib/crm/pipeline";
import { DEFAULT_VOCABULARY, type Vocabulary } from "@/lib/validation/pipelines";
import { KanbanBoard, type LeadCard, type Stage } from "./kanban-board";

export default async function FunilPage() {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const supabase = await createClient();
  const pipelineId = await getDefaultPipelineId(supabase, membership.orgId);

  const [{ data: pipeline }, { data: stages }, { data: leadsData }, { data: contacts }, { data: tags }, { data: members }] =
    await Promise.all([
      supabase.from("pipelines").select("id, vocabulary").eq("id", pipelineId).single(),
      supabase
        .from("pipeline_stages")
        .select("id, name, position, is_won, is_lost")
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true }),
      supabase
        .from("leads")
        .select(
          "id, title, value_cents, status, position, stage_id, contact_id, owner_id, lost_reason, contacts(name, phone_e164), profiles(full_name), lead_tags(tags(id, name, color))",
        )
        .eq("pipeline_id", pipelineId)
        .order("position", { ascending: true }),
      supabase
        .from("contacts")
        .select("id, name, phone_e164")
        .eq("org_id", membership.orgId)
        .order("name", { ascending: true }),
      supabase
        .from("tags")
        .select("id, name, color")
        .eq("org_id", membership.orgId)
        .order("name", { ascending: true }),
      supabase
        .from("org_members")
        .select("user_id, profiles(full_name)")
        .eq("org_id", membership.orgId)
        .not("accepted_at", "is", null),
    ]);

  const stagesTyped: Stage[] = stages ?? [];

  const leads: LeadCard[] = (leadsData ?? []).map((lead) => {
    const contact = Array.isArray(lead.contacts) ? lead.contacts[0] : lead.contacts;
    const owner = Array.isArray(lead.profiles) ? lead.profiles[0] : lead.profiles;
    const leadTags = (lead.lead_tags ?? [])
      .map((lt) => (Array.isArray(lt.tags) ? lt.tags[0] : lt.tags))
      .filter((t): t is { id: string; name: string; color: string } => Boolean(t));

    return {
      id: lead.id,
      title: lead.title,
      valueCents: lead.value_cents,
      status: lead.status,
      position: lead.position,
      stageId: lead.stage_id,
      contact: contact ? { name: contact.name, phone_e164: contact.phone_e164 } : null,
      ownerName: owner?.full_name ?? null,
      ownerId: lead.owner_id,
      lostReason: lead.lost_reason,
      tags: leadTags,
    };
  });

  const memberOptions = (members ?? []).map((m) => {
    const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
    return { id: m.user_id, name: profile?.full_name ?? "(sem nome)" };
  });

  const vocabulary: Vocabulary = {
    ...DEFAULT_VOCABULARY,
    ...((pipeline?.vocabulary as Partial<Vocabulary>) ?? {}),
  };

  const canManageSettings = ROLE_RANK[membership.role] >= ROLE_RANK.admin;

  return (
    <KanbanBoard
      pipelineId={pipelineId}
      stages={stagesTyped}
      initialLeads={leads}
      contacts={contacts ?? []}
      tags={tags ?? []}
      members={memberOptions}
      vocabulary={vocabulary}
      canManageSettings={canManageSettings}
    />
  );
}
