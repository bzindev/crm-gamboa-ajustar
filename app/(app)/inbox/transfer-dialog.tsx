"use client";

import { useActionState, useState } from "react";
import { transferConversation, type ConversationActionState } from "@/lib/actions/conversations";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export type TransferTarget = { id: string; name: string };

export function TransferDialog({
  conversationId,
  targets,
}: {
  conversationId: string;
  targets: TransferTarget[];
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, isPending] = useActionState<ConversationActionState, FormData>(
    async (prevState, formData) => {
      const result = await transferConversation(prevState, formData);
      if (!result?.error) setOpen(false);
      return result;
    },
    null,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          Transferir
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Transferir conversa</DialogTitle>
        </DialogHeader>
        <form action={formAction} className="flex flex-col gap-4">
          <input type="hidden" name="conversationId" value={conversationId} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="targetUserId">Repassar para</Label>
            <select
              id="targetUserId"
              name="targetUserId"
              required
              defaultValue=""
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="" disabled>
                Selecione...
              </option>
              {targets.map((target) => (
                <option key={target.id} value={target.id}>
                  {target.name}
                </option>
              ))}
            </select>
          </div>
          {state?.error && <p className="text-sm text-destructive">{state.error}</p>}
          <Button type="submit" disabled={isPending}>
            {isPending ? "Transferindo..." : "Transferir"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
