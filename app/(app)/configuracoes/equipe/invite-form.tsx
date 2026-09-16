"use client";

import { useActionState, useState } from "react";
import { createInvite, type CreateInviteState } from "@/lib/actions/invites";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ROLE_OPTIONS = [
  { value: "admin", label: "Administrador(a)" },
  { value: "manager", label: "Gerente" },
  { value: "agent", label: "Atendente" },
];

export function InviteForm() {
  const [state, formAction, isPending] = useActionState<CreateInviteState, FormData>(
    createInvite,
    null,
  );
  const [copied, setCopied] = useState(false);

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Sem permissão de clipboard: o link já está visível na tela para
      // selecionar manualmente.
    }
  }

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-email">E-mail</Label>
          <Input id="invite-email" name="email" type="email" required className="w-64" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-role">Papel</Label>
          <select
            id="invite-role"
            name="role"
            defaultValue="agent"
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={isPending}>
          {isPending ? "Gerando..." : "Convidar"}
        </Button>
      </div>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      {state?.inviteUrl && (
        <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <code className="flex-1 truncate">{state.inviteUrl}</code>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => copyLink(state.inviteUrl!)}
          >
            {copied ? "Copiado!" : "Copiar"}
          </Button>
        </div>
      )}
    </form>
  );
}
