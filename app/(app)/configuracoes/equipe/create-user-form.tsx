"use client";

import { useActionState, useState } from "react";
import { createUserWithPassword, type UserActionState } from "@/lib/actions/users";
import { PASSWORD_MIN } from "@/lib/validation/users";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";

export function CreateUserForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("agent");
  const [password, setPassword] = useState("");
  const [createdMessage, setCreatedMessage] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState<UserActionState, FormData>(
    async (prevState, formData) => {
      const result = await createUserWithPassword(prevState, formData);
      if (result?.created) {
        // Mostra UMA vez pra copiar e repassar — não fica salvo em lugar nenhum.
        setCreatedMessage(`Usuário criado. Login: ${result.created.email} · Senha: ${password}`);
        setFullName("");
        setEmail("");
        setPassword("");
        setRole("agent");
      } else {
        setCreatedMessage(null);
      }
      return result;
    },
    null,
  );

  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN;

  return (
    <form action={formAction} className="grid max-w-3xl gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-user-name">Nome</Label>
        <Input id="new-user-name" name="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} required maxLength={80} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-user-email">E-mail (login)</Label>
        <Input id="new-user-email" name="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-user-role">Papel</Label>
        <select
          id="new-user-role"
          name="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="h-9 rounded-md border bg-transparent px-2 text-sm"
        >
          <option value="agent">{ROLE_LABELS.agent}</option>
          <option value="manager">{ROLE_LABELS.manager}</option>
          <option value="admin">{ROLE_LABELS.admin}</option>
        </select>
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-user-password">Senha</Label>
        <PasswordInput id="new-user-password" name="password" value={password} onChange={setPassword} required />
        <p className={passwordTooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
          Mínimo {PASSWORD_MIN} caracteres. A pessoa pode trocar depois em Segurança.
        </p>
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
        {createdMessage && <p className="break-all text-sm text-positive">{createdMessage}</p>}
        <Button type="submit" disabled={isPending || passwordTooShort} className="w-fit">
          {isPending ? "Cadastrando..." : "Cadastrar usuário"}
        </Button>
      </div>
    </form>
  );
}
