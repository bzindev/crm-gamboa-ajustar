"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signUpSchema, signInSchema } from "@/lib/validation/auth";

export type AuthActionState = { error?: string; message?: string } | null;

/** Só aceita caminho relativo interno — evita open redirect via campo de formulário. */
function safeRedirectTarget(raw: FormDataEntryValue | null): string {
  if (typeof raw === "string" && raw.startsWith("/") && !raw.startsWith("//")) {
    return raw;
  }
  return "/dashboard";
}

/**
 * As mensagens do Supabase Auth já são pensadas para aparecer para o
 * usuário final (não vazam segredo nenhum) — só traduzimos os casos mais
 * comuns para português; o resto passa a mensagem original em vez de um
 * "algo deu errado" genérico, que só esconde o problema na hora de debugar.
 */
function mapSignUpError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("already registered") || lower.includes("already exists")) {
    return "Este e-mail já tem uma conta. Tente entrar em vez de criar outra.";
  }
  if (lower.includes("password")) {
    return `Senha não aceita: ${message}`;
  }
  if (lower.includes("rate limit") || lower.includes("too many")) {
    return "Muitas tentativas seguidas. Aguarde um pouco e tente de novo.";
  }
  return `Não foi possível criar a conta: ${message}`;
}

export async function signUp(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signUpSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { data: { full_name: parsed.data.name } },
  });

  if (error) {
    console.error("[auth] signUp falhou:", error.status, error.message);
    return { error: mapSignUpError(error.message) };
  }

  // Se o projeto Supabase exige confirmação de e-mail, o cadastro não
  // devolve sessão até o usuário clicar no link recebido.
  if (!data.session) {
    return {
      message: "Conta criada. Confira seu e-mail para confirmar o cadastro.",
    };
  }

  redirect(safeRedirectTarget(formData.get("redirectTo")));
}

export async function signIn(
  _prevState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Mensagem para o usuário fica genérica de propósito (não confirma se o
    // e-mail existe ou não) — mas logamos o motivo real para debug.
    console.error("[auth] signIn falhou:", error.status, error.message);
    return { error: "E-mail ou senha incorretos." };
  }

  redirect(safeRedirectTarget(formData.get("redirectTo")));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
