import { Trash2 } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { deleteGoal } from "@/lib/actions/goals";
import { computeGoalProgress, monthKey, type GoalRow } from "@/lib/crm/goals";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { GoalProgressList } from "@/components/goals/goal-progress-list";
import { GoalForm } from "./goal-form";

function monthLabel(key: string): string {
  const [year, month] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, 15)).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}

export default async function MetasPage() {
  const membership = await requireRoleOrRedirect("manager");
  const supabase = await createClient();

  const [{ data: goals }, { data: members }, { data: leads }] = await Promise.all([
    supabase
      .from("goals")
      .select("id, user_id, month, target_won, target_value_cents")
      .eq("org_id", membership.orgId)
      .order("month", { ascending: false })
      .limit(60),
    supabase.from("org_members").select("user_id, profiles(full_name)").eq("org_id", membership.orgId).not("accepted_at", "is", null),
    supabase.from("leads").select("owner_id, status, value_cents, updated_at").eq("org_id", membership.orgId).eq("status", "won"),
  ]);

  const userNames = new Map(
    (members ?? []).map((m) => {
      const profile = Array.isArray(m.profiles) ? m.profiles[0] : m.profiles;
      return [m.user_id, profile?.full_name ?? "(sem nome)"];
    }),
  );

  const byMonth = new Map<string, GoalRow[]>();
  for (const goal of goals ?? []) {
    const key = goal.month.slice(0, 7);
    byMonth.set(key, [...(byMonth.get(key) ?? []), goal]);
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Metas mensais de vendas da equipe e de cada vendedor. O progresso conta os leads marcados como
        ganhos no mês e aparece também no Dashboard.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Definir meta</CardTitle>
        </CardHeader>
        <CardContent>
          <GoalForm
            members={[...userNames.entries()].map(([id, name]) => ({ id, name }))}
            defaultMonth={monthKey(new Date())}
          />
        </CardContent>
      </Card>

      {[...byMonth.entries()].map(([key, monthGoals]) => (
        <Card key={key}>
          <CardHeader>
            <CardTitle className="capitalize">{monthLabel(key)}</CardTitle>
            <CardDescription>{monthGoals.length} meta(s)</CardDescription>
          </CardHeader>
          <CardContent>
            <GoalProgressList
              items={computeGoalProgress(monthGoals, leads ?? [], key, userNames)}
              renderAction={(item) => (
                <form action={deleteGoal}>
                  <input type="hidden" name="id" value={item.goalId} />
                  <Button type="submit" variant="ghost" size="icon" className="size-7" title="Apagar meta">
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                </form>
              )}
            />
          </CardContent>
        </Card>
      ))}

      {byMonth.size === 0 && (
        <p className="text-sm text-muted-foreground">Nenhuma meta definida ainda.</p>
      )}
    </div>
  );
}
