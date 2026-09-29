"use client";

import { useState, useTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { recordPasswordChange } from "@/lib/actions/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const MIN_LENGTH = 10;

/** Mensagens do Supabase Auth traduzidas nos casos comuns. */
function translate(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("different from the old")) return "A senha nova precisa ser diferente da atual.";
  if (lower.includes("weak") || lower.includes("at least")) return "Senha fraca demais — use pelo menos 10 caracteres, misturando letras e números.";
  if (lower.includes("reauthentication") || lower.includes("nonce")) return "Por segurança, saia e entre de novo antes de trocar a senha.";
  if (lower.includes("aal2") || lower.includes("mfa")) return "Confirme o código do 2FA (saia e entre de novo) antes de trocar a senha.";
  return `Não foi possível trocar a senha: ${message}`;
}

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [isPending, startTransition] = useTransition();

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_LENGTH && confirm === password;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setDone(false);
    startTransition(async () => {
      // Direto com o Supabase Auth, na sessão do navegador — a senha nunca
      // passa pelo nosso servidor nem fica em log.
      const { error: updateError } = await createClient().auth.updateUser({ password });
      if (updateError) {
        setError(translate(updateError.message));
        return;
      }
      await recordPasswordChange();
      setPassword("");
      setConfirm("");
      setDone(true);
    });
  }

  return (
    <form onSubmit={submit} className="flex max-w-sm flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label htmlFor="new-password">Nova senha</Label>
        <Input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {tooShort && <p className="text-xs text-destructive">Mínimo de {MIN_LENGTH} caracteres.</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="confirm-password">Repita a nova senha</Label>
        <Input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        {mismatch && <p className="text-xs text-destructive">As duas senhas não são iguais.</p>}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {done && <p className="text-sm text-positive">Senha trocada. Use a nova no próximo login.</p>}
      <Button type="submit" disabled={!canSubmit || isPending} className="w-fit">
        {isPending ? "Salvando..." : "Trocar senha"}
      </Button>
    </form>
  );
}
