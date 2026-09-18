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
  Smartphone,
} from "lucide-react";
import { OrgSwitcher } from "./org-switcher";
import { signOut } from "@/lib/actions/auth";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/format/initials";
import { ROLE_LABELS } from "@/lib/auth/role-labels";
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
  { href: "/inbox", label: "Inbox", icon: InboxIcon },
  { href: "/funil", label: "Funil", icon: KanbanSquare },
  { href: "/contatos", label: "Contatos", icon: Users },
  { href: "/relatorios", label: "Relatórios", icon: BarChart3 },
  { href: "/automacoes", label: "Automações", icon: Zap, minRole: "admin" },
  { href: "/configuracoes/equipe", label: "Equipe", icon: UserCog, minRole: "admin" },
  { href: "/configuracoes/whatsapp", label: "Canal WhatsApp", icon: Smartphone, minRole: "admin" },
  { href: "/configuracoes/geral", label: "Configurações", icon: Settings, minRole: "admin" },
];

export function Sidebar({
  membership,
  orgs,
  userName,
}: {
  membership: ActiveOrgMembership;
  orgs: OrgMembershipSummary[];
  userName: string;
}) {
  const pathname = usePathname();
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.minRole || ROLE_RANK[membership.role] >= ROLE_RANK[item.minRole],
  );

  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 bg-gradient-to-b from-[#0d0d0d] to-[#1a1a1a] p-3 text-sidebar-foreground print:hidden">
      <div className="flex flex-col gap-0.5 px-1 pt-1">
        <span className="text-base font-semibold text-white">CRM Gamboa</span>
        <span className="text-xs text-sidebar-foreground/50">Admin Panel</span>
      </div>

      <OrgSwitcher orgs={orgs} currentOrgId={membership.orgId} />

      <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);

          if (item.comingSoon) {
            return (
              <span
                key={item.href}
                className="flex items-center justify-between rounded-xl px-3 py-2.5 text-sm text-sidebar-foreground/40"
              >
                <span className="flex items-center gap-2.5">
                  <Icon className="size-4" />
                  {item.label}
                </span>
                <Badge variant="secondary" className="bg-white/10 text-[10px] text-sidebar-foreground/70">
                  em breve
                </Badge>
              </span>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"
                  : "text-sidebar-foreground hover:bg-white/5",
              )}
            >
              <Icon className="size-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex flex-col gap-3 border-t border-sidebar-border pt-3">
        <div className="flex items-center gap-2.5 px-1">
          <Avatar className="size-8 shrink-0">
            <AvatarFallback className="bg-sidebar-primary text-xs font-semibold text-sidebar-primary-foreground">
              {getInitials(userName)}
            </AvatarFallback>
          </Avatar>
          <div className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium text-white">{userName}</span>
            <span className="truncate text-xs text-sidebar-foreground/50">
              {ROLE_LABELS[membership.role]}
            </span>
          </div>
        </div>
        <form action={signOut}>
          <Button
            variant="ghost"
            type="submit"
            className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-white/5 hover:text-white"
          >
            <LogOut className="size-4" />
            Sair
          </Button>
        </form>
      </div>
    </aside>
  );
}
