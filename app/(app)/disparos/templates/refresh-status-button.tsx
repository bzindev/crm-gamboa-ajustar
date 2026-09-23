"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { refreshTemplateStatus } from "@/lib/actions/templates";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export function RefreshStatusButton({ templateId }: { templateId: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="size-7"
      disabled={isPending}
      title="Atualizar status na Meta"
      onClick={() => {
        startTransition(async () => {
          await refreshTemplateStatus(templateId);
          router.refresh();
        });
      }}
    >
      <RefreshCw className={isPending ? "size-3.5 animate-spin" : "size-3.5"} />
    </Button>
  );
}
