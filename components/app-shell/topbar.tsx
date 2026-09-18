"use client";

import { Search, Bell } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { signOut } from "@/lib/actions/auth";
import { getInitials } from "@/lib/format/initials";

export function Topbar({ userName }: { userName: string }) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-white px-6 print:hidden">
      <div className="relative w-full max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        {/* Busca ainda não está ligada a nada — só o visual por enquanto. */}
        <input
          type="search"
          placeholder="Buscar leads, contatos..."
          disabled
          className="h-10 w-full rounded-full border border-input bg-muted/50 pl-9 pr-4 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed"
        />
      </div>

      <div className="ml-auto flex items-center gap-3">
        <button
          type="button"
          disabled
          className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground disabled:cursor-not-allowed"
          aria-label="Notificações (em breve)"
        >
          <Bell className="size-5" />
        </button>

        <DropdownMenu>
          <DropdownMenuTrigger className="rounded-full">
            <Avatar className="size-9">
              <AvatarFallback className="bg-primary text-xs font-semibold text-primary-foreground">
                {getInitials(userName)}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel className="truncate">{userName}</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <form action={signOut} className="w-full">
                <button type="submit" className="w-full text-left">
                  Sair
                </button>
              </form>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
