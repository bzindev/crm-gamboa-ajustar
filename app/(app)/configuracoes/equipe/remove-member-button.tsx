"use client";

import { useActionState, useState } from "react";
import { UserMinus } from "lucide-react";
import { removeMember, type MemberActionState } from "@/lib/actions/members";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function RemoveMemberButton({ userId, name }: { userId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<MemberActionState, FormData>(
    async (prevState, formData) => {
      const result = await removeMember(prevState, formData);
      if (result?.success) setOpen(false);
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" className="size-8" title={`Remover ${name}`}>
          <UserMinus className="size-4 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Remover {name}?</DialogTitle>
          <DialogDescription>
            A pessoa perde o acesso a esta organização na hora e sai de todos os setores. Conversas
            e leads em aberto dela ficam sem responsável, pra outra pessoa assumir. Leads já ganhos
            ou perdidos continuam no nome dela, pro histórico.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-3">
          <input type="hidden" name="userId" value={userId} />
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={isPending}>
              {isPending ? "Removendo..." : "Remover"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
