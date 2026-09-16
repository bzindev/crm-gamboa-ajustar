/**
 * Sem "server-only" de propósito: usado tanto no servidor (lib/auth/session.ts,
 * require-role.ts) quanto em Client Components que precisam decidir o que
 * mostrar na tela por papel (ex.: sidebar destacando/escondendo item) — a
 * decisão de autorização em si nunca depende só disso, é sempre revalidada
 * no servidor (ver require-role.ts).
 */
export const ROLE_RANK = {
  agent: 1,
  manager: 2,
  admin: 3,
  owner: 4,
} as const;

export type Role = keyof typeof ROLE_RANK;
