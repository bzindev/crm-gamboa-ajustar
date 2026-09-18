"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { Trash2 } from "lucide-react";
import { createTeam, deleteTeam, toggleTeamMember, type TeamActionState } from "@/lib/actions/teams";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type Member = { userId: string; name: string };
type Team = { id: string; name: string; memberIds: string[] };

function TeamMemberCheckbox({
  teamId,
  member,
  checked,
}: {
  teamId: string;
  member: Member;
  checked: boolean;
}) {
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState(checked);

  function handleChange(next: boolean) {
    setOptimistic(next);
    const formData = new FormData();
    formData.set("teamId", teamId);
    formData.set("userId", member.userId);
    formData.set("action", next ? "add" : "remove");
    startTransition(() => {
      toggleTeamMember(formData);
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <Checkbox checked={optimistic} disabled={isPending} onCheckedChange={(v) => handleChange(v === true)} />
      {member.name}
    </label>
  );
}

function CreateTeamForm() {
  const [state, formAction, isPending] = useActionState<TeamActionState, FormData>(createTeam, null);

  return (
    <form action={formAction} className="flex items-center gap-2">
      <Input name="name" placeholder="Nome do setor" className="h-9 max-w-xs" required />
      <Button type="submit" size="sm" disabled={isPending}>
        Criar setor
      </Button>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}

export function TeamsSection({ teams, members }: { teams: Team[]; members: Member[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Setores</CardTitle>
        <CardDescription>
          Departamentos internos (venda de veículos novos, peças, pós-vendas, gerência). Quando o
          WhatsApp estiver conectado, conversas poderão ser encaminhadas para o setor certo.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <CreateTeamForm />
        <div className="grid gap-3 sm:grid-cols-2">
          {teams.map((team) => (
            <div key={team.id} className="rounded-xl border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-semibold">{team.name}</span>
                <form action={deleteTeam}>
                  <input type="hidden" name="teamId" value={team.id} />
                  <Button variant="ghost" size="icon" className="size-6" type="submit">
                    <Trash2 className="size-3.5 text-muted-foreground" />
                  </Button>
                </form>
              </div>
              <div className="flex flex-col gap-1.5">
                {members.map((member) => (
                  <TeamMemberCheckbox
                    key={member.userId}
                    teamId={team.id}
                    member={member}
                    checked={team.memberIds.includes(member.userId)}
                  />
                ))}
                {members.length === 0 && (
                  <p className="text-xs text-muted-foreground">Nenhum membro na equipe ainda.</p>
                )}
              </div>
            </div>
          ))}
          {teams.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum setor criado ainda.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
