"use client";

import { useActionState, useState } from "react";
import { Pencil } from "lucide-react";
import { updateMember, type UserActionState } from "@/lib/actions/users";
import { PASSWORD_MIN } from "@/lib/validation/users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PasswordInput } from "./password-input";

export function EditMemberDialog({
  userId,
  name,
  isSelf,
}: {
  userId: string;
  name: string;
  /** A própria pessoa edita só o nome aqui — a própria senha é em Segurança. */
  isSelf: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState(name);
  const [password, setPassword] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [state, formAction, isPending] = useActionState<UserActionState, FormData>(
    async (prevState, formData) => {
      const result = await updateMember(prevState, formData);
      if (result?.success) {
        setSaved(password ? `Salvo. Passe a nova senha pra ${fullName}: ${password}` : "Salvo.");
        setPassword("");
      }
      return result;
    },
    null,
  );

  function onOpenChange(value: boolean) {
    setOpen(value);
    if (value) {
      setFullName(name);
      setPassword("");
      setSaved(null);
    }
  }

  const passwordTooShort = password.length > 0 && password.length < PASSWORD_MIN;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-8 gap-1.5 px-2">
          <Pencil className="size-3.5" />
          Editar
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Editar {isSelf ? "meus dados" : "membro"}</DialogTitle>
          <DialogDescription>
            {isSelf ? "Atualize o seu nome." : "Atualize o nome ou defina uma nova senha pra essa pessoa."}
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="userId" value={userId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={`name-${userId}`}>Nome</Label>
            <Input
              id={`name-${userId}`}
              name="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              required
              maxLength={80}
            />
          </div>
          {isSelf ? (
            <p className="text-xs text-muted-foreground">
              Sua senha você troca em Segurança (menu do avatar, canto superior direito).
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              <Label htmlFor={`password-${userId}`}>Nova senha (opcional)</Label>
              <PasswordInput
                id={`password-${userId}`}
                name="password"
                value={password}
                onChange={setPassword}
                placeholder="Deixe em branco para manter"
              />
              <p className={passwordTooShort ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                Mínimo {PASSWORD_MIN} caracteres. Deixe em branco para não alterar.
              </p>
            </div>
          )}
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          {saved && <p className="break-all text-sm text-positive">{saved}</p>}
          <DialogFooter className="grid grid-cols-2 gap-2 sm:flex">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {saved ? "Fechar" : "Cancelar"}
            </Button>
            <Button type="submit" disabled={isPending || passwordTooShort || fullName.trim().length < 2}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
