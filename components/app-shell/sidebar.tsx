"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox as InboxIcon,
  KanbanSquare,
  Users,
  UserCog,
  LogOut,
  BarChart3,
  Zap,
  Settings,
} from "lucide-react";
import { OrgSwitcher } from "./org-switcher";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ActiveOrgMembership, OrgMembershipSummary } from "@/lib/auth/session";
import { ROLE_RANK, type Role } from "@/lib/auth/roles";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  minRole?: Role;
  comingSoon?: boolean;
};

// Lista plana, sem cabeçalho de grupo — mesmo padrão do DeskcommCRM (só com
// o que já existe aqui; nada de item para funcionalidade que ainda não foi
// construída).
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/inbox", label: "Inbox", icon: InboxIcon, comingSoon: true },
  { href: "/funil", label: "Funil", icon: KanbanSquare },
  { href: "/contatos", label: "Contatos", icon: Users },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3, comingSoon: true },
  { href: "/automacoes", label: "Automações", icon: Zap, minRole: "admin", comingSoon: true },
  { href: "/configuracoes/equipe", label: "Equipe", icon: UserCog, minRole: "admin" },
  {
    href: "/configuracoes/geral",
    label: "Configurações",
    icon: Settings,
    minRole: "admin",
    comingSoon: true,
  },
];

export function Sidebar({
  membership,
  orgs,
}: {
  membership: ActiveOrgMembership;
  orgs: OrgMembershipSummary[];
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.minRole || ROLE_RANK[membership.role] >= ROLE_RANK[item.minRole],
  );

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-4 border-r bg-sidebar p-3 text-sidebar-foreground">
      <OrgSwitcher orgs={orgs} currentOrgId={membership.orgId} />

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (item.comingSoon) {
            return (
              <span
                key={item.href}
                className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-sidebar-foreground/40"
              >
                <span className="flex items-center gap-2">
                  <Icon className="size-4" />
                  {item.label}
                </span>
                <Badge variant="secondary">em breve</Badge>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-accent text-sidebar-accent-foreground"
                  : "hover:bg-sidebar-accent/60",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-auto">
        <form action={signOut}>
          <Button variant="ghost" type="submit" className="w-full justify-start gap-2">
            <LogOut className="size-4" />
            Sair
          </Button>
        </form>
      </div>
    </aside>
  );
}
