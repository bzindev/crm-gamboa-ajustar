"use client";

import { useActionState } from "react";
import {
  updateConversationStatus,
  type ConversationActionState,
} from "@/lib/actions/conversations";

const STATUS_OPTIONS = [
  { value: "open", label: "Aberta" },
  { value: "pending", label: "Pendente" },
  { value: "resolved", label: "Resolvida" },
  { value: "closed", label: "Fechada" },
] as const;

export function StatusSelect({
  conversationId,
  status,
}: {
  conversationId: string;
  status: string;
}) {
  const [state, formAction] = useActionState<ConversationActionState, FormData>(
    updateConversationStatus,
    null,
  );

  return (
    <form action={formAction} className="flex items-center gap-2">
      <input type="hidden" name="conversationId" value={conversationId} />
      <select
        name="status"
        defaultValue={status}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-8 rounded-md border bg-transparent px-2 text-xs"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {state?.error && <p className="text-xs text-destructive">{state.error}</p>}
    </form>
  );
}
