import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import type { FilterOptions } from "@/lib/inbox/conversation-summary";

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Opções dos seletores de filtro, direto do banco (não da lista que está
 * na tela — senão só apareceria etiqueta/vendedor que já tem conversa
 * carregada). Vendedor comum recebe só ele mesmo na lista de vendedores:
 * ele não filtra por colega (e, mesmo se tentar pela URL, o banco barra).
 */
export async function GET() {
  const membership = await getActiveOrgMembership();
  if (!membership) return NextResponse.json({ error: "Não autenticado." }, { status: 401 });

  const supabase = await createClient();
  const orgId = membership.orgId;
  const [tags, members, teams, stages] = await Promise.all([
    supabase.from("tags").select("id, name, color").eq("org_id", orgId).order("name"),
    supabase
      .from("org_members")
      .select("user_id, profiles(full_name)")
      .eq("org_id", orgId)
      .not("accepted_at", "is", null),
    supabase.from("teams").select("id, name").eq("org_id", orgId).order("name"),
    supabase
      .from("pipeline_stages")
      .select("id, name, position, pipelines(name)")
      .eq("org_id", orgId)
      .order("position"),
  ]);

  const error = tags.error ?? members.error ?? teams.error ?? stages.error;
  if (error) {
    console.error("[inbox] opções de filtro falharam:", error.code, error.message);
    return NextResponse.json({ error: "Não foi possível carregar os filtros." }, { status: 500 });
  }

  const allMembers = (members.data ?? [])
    .map((m) => ({ id: m.user_id, name: one(m.profiles)?.full_name ?? "Sem nome" }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const body: FilterOptions = {
    viewer: { id: membership.userId, role: membership.role },
    tags: tags.data ?? [],
    members: membership.role === "agent" ? allMembers.filter((m) => m.id === membership.userId) : allMembers,
    teams: teams.data ?? [],
    stages: (stages.data ?? []).map((s) => ({ id: s.id, name: s.name, pipeline: one(s.pipelines)?.name ?? "" })),
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
