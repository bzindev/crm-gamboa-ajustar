"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
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
import { markNotificationRead, markAllNotificationsRead } from "@/lib/actions/notifications";
import { getInitials } from "@/lib/format/initials";
import { formatRelativeTime } from "@/lib/format/relative-time";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export function Topbar({
  userName,
  notifications,
}: {
  userName: string;
  notifications: NotificationItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  function handleOpen(notification: NotificationItem) {
    if (!notification.read_at) {
      startTransition(async () => {
        await markNotificationRead(notification.id);
        router.refresh();
      });
    }
  }

  function handleMarkAllRead() {
    startTransition(async () => {
      await markAllNotificationsRead();
      router.refresh();
    });
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b bg-card px-6 print:hidden">
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="relative flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
              aria-label="Notificações"
            >
              <Bell className="size-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-80">
            <div className="flex items-center justify-between px-2 py-1.5">
              <DropdownMenuLabel className="p-0">Notificações</DropdownMenuLabel>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAllRead}
                  disabled={isPending}
                  className="text-xs text-primary hover:underline"
                >
                  Marcar todas como lidas
                </button>
              )}
            </div>
            <DropdownMenuSeparator />
            {notifications.length === 0 ? (
              <p className="px-2 py-4 text-center text-sm text-muted-foreground">
                Nenhuma notificação ainda.
              </p>
            ) : (
              <div className="flex max-h-80 flex-col overflow-y-auto">
                {notifications.map((notification) => {
                  const content = (
                    <div
                      className={cn(
                        "flex flex-col gap-0.5 rounded-md px-2 py-2 text-sm",
                        !notification.read_at && "bg-accent/40",
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {!notification.read_at && (
                          <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                        )}
                        <span className="font-medium">{notification.title}</span>
                      </div>
                      {notification.body && (
                        <p className="truncate text-xs text-muted-foreground">{notification.body}</p>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        {formatRelativeTime(notification.created_at)}
                      </span>
                    </div>
                  );

                  return notification.link ? (
                    <Link
                      key={notification.id}
                      href={notification.link}
                      onClick={() => handleOpen(notification)}
                      className="hover:bg-muted"
                    >
                      {content}
                    </Link>
                  ) : (
                    <button
                      key={notification.id}
                      type="button"
                      onClick={() => handleOpen(notification)}
                      className="text-left hover:bg-muted"
                    >
                      {content}
                    </button>
                  );
                })}
              </div>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

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
