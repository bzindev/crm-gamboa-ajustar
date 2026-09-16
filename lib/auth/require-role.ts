import "server-only";
import { redirect } from "next/navigation";
import {
  getActiveOrgMembership,
  ROLE_RANK,
  type ActiveOrgMembership,
  type Role,
} from "@/lib/auth/session";

export class ForbiddenError extends Error {
  constructor(message = "Você não tem permissão para esta ação.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/**
 * Gate de autorização para Server Actions. Lança ForbiddenError se o
 * usuário não tiver organização ativa ou papel insuficiente — quem chama
 * (a Server Action) decide o que fazer com isso, normalmente devolvendo
 * `{ error: err.message }` para o formulário exibir.
 *
 * Isso existe para nunca depender só da UI escondendo um botão: mesmo que
 * alguém monte a requisição na mão, a checagem acontece aqui, no servidor,
 * antes de qualquer escrita no banco.
 */
export async function requireRole(min: Role): Promise<ActiveOrgMembership> {
  const membership = await getActiveOrgMembership();

  if (!membership) {
    throw new ForbiddenError("Você precisa fazer parte de uma organização.");
  }

  if (ROLE_RANK[membership.role] < ROLE_RANK[min]) {
    throw new ForbiddenError(
      `Esta ação exige o papel "${min}" ou superior na organização.`,
    );
  }

  return membership;
}

/**
 * Mesmo gate, mas para páginas (Server Components): em vez de lançar,
 * redireciona. Uso em páginas inteiras que só um papel mínimo pode abrir
 * (ex.: /configuracoes/equipe).
 */
export async function requireRoleOrRedirect(
  min: Role,
  fallback = "/dashboard",
): Promise<ActiveOrgMembership> {
  try {
    return await requireRole(min);
  } catch (err) {
    if (err instanceof ForbiddenError) {
      redirect(fallback);
    }
    throw err;
  }
}
