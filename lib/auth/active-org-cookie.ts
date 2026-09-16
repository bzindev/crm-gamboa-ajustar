import "server-only";
import { cookies } from "next/headers";

/**
 * O cookie guarda só uma preferência de qual organização mostrar — nunca é
 * consultado como prova de permissão. lib/auth/session.ts sempre confere
 * contra org_members antes de confiar nele. Por isso não há problema em um
 * usuário mal-intencionado trocar o valor manualmente: o pior caso é a
 * função de sessão ignorar o cookie e cair de volta na primeira organização
 * de que ele realmente participa.
 */
export async function setActiveOrgCookie(orgId: string) {
  const cookieStore = await cookies();
  cookieStore.set("active_org_id", orgId, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
