"use client";

import { useTransition } from "react";
import { ChevronsUpDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setActiveOrg } from "@/lib/actions/active-org";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
import type { OrgMembershipSummary } from "@/lib/auth/session";

export function OrgSwitcher({
  orgs,
  currentOrgId,
}: {
  orgs: OrgMembershipSummary[];
  currentOrgId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const current = orgs.find((o) => o.orgId === currentOrgId);

  function switchTo(orgId: string) {
    const formData = new FormData();
    formData.set("orgId", orgId);
    startTransition(() => {
      setActiveOrg(formData);
    });
  }

  if (orgs.length <= 1) {
    return (
      <div className="rounded-xl border border-sidebar-border bg-white/5 px-3 py-2 text-sm font-medium text-sidebar-foreground">
        {current?.orgName ?? "Organização"}
      </div>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={isPending}
        className="flex w-full items-center justify-between rounded-xl border border-sidebar-border bg-white/5 px-3 py-2 text-sm font-medium text-sidebar-foreground hover:bg-white/10"
      >
        <span className="truncate">{current?.orgName ?? "Organização"}</span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuLabel>Trocar organização</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {orgs.map((org) => (
          <DropdownMenuItem key={org.orgId} onSelect={() => switchTo(org.orgId)}>
            <span className="truncate">{org.orgName}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {ROLE_LABELS[org.role]}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
