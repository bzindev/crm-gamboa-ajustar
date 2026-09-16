import type { Role } from "@/lib/auth/session";

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Dono(a)",
  admin: "Administrador(a)",
  manager: "Gerente",
  agent: "Atendente",
};
