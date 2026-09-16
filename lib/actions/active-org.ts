"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setActiveOrgCookie } from "@/lib/auth/active-org-cookie";

export async function setActiveOrg(formData: FormData) {
  const orgId = formData.get("orgId");
  if (typeof orgId !== "string" || orgId.length === 0) {
    return;
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login");
  }

  // A RLS de org_members já só devolve a linha se o usuário for membro
  // aceito dessa organização — se vier vazio, o pedido é inválido (cookie
  // adulterado ou id de outra organização) e nada é trocado.
  const { data: membership } = await supabase
    .from("org_members")
    .select("org_id")
    .eq("org_id", orgId)
    .not("accepted_at", "is", null)
    .maybeSingle();

  if (!membership) {
    return;
  }

  await setActiveOrgCookie(orgId);
  redirect("/dashboard");
}
