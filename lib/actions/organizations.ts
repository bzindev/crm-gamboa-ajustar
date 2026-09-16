"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { setActiveOrgCookie } from "@/lib/auth/active-org-cookie";
import { createOrganizationSchema } from "@/lib/validation/organizations";

export type ActionState = { error?: string } | null;

export async function createOrganization(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createOrganizationSchema.safeParse({
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();

  // fn_create_organization roda como security definer: cria a organização
  // e já insere o usuário atual como owner na mesma transação. Ver
  // supabase/migrations/0003_fn_organizacoes_e_convites.sql para o porquê
  // de isso não dar para fazer com dois INSERTs comuns sob RLS.
  const { data, error } = await supabase
    .rpc("fn_create_organization", { p_name: parsed.data.name })
    .single()
    .returns<{ org_id: string; org_slug: string }>();

  if (error || !data) {
    return { error: "Não foi possível criar a organização. Tente novamente." };
  }

  await setActiveOrgCookie(data.org_id);
  redirect("/dashboard");
}
