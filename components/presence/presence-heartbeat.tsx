"use client";

import { useEffect, useRef } from "react";
import { setPresence } from "@/lib/actions/presence";

const HEARTBEAT_MS = 60 * 1000;
const AWAY_AFTER_MS = 10 * 60 * 1000;
const ACTIVITY_EVENTS = ["mousemove", "keydown", "click", "scroll", "touchstart"] as const;

/**
 * Sem UI própria. Reporta "online" a cada heartbeat enquanto o usuário
 * interagiu há menos de 10 minutos; passa a reportar "away" depois disso,
 * sem precisar de um evento dedicado — o próprio heartbeat já carrega o
 * status certo no valor que manda. "offline" nunca é reportado por este
 * componente (ver lib/actions/presence.ts).
 */
export function PresenceHeartbeat() {
  const lastActivityRef = useRef<number | null>(null);

  useEffect(() => {
    lastActivityRef.current = Date.now();

    const markActive = () => {
      lastActivityRef.current = Date.now();
    };
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }

    const report = () => {
      const idleFor = Date.now() - (lastActivityRef.current ?? Date.now());
      void setPresence(idleFor >= AWAY_AFTER_MS ? "away" : "online");
    };

    report();
    const interval = setInterval(report, HEARTBEAT_MS);

    return () => {
      clearInterval(interval);
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
    };
  }, []);

  return null;
}
