import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// /api/webhooks e /api/cron são chamados por máquina (Meta, Vercel Cron),
// nunca com sessão de usuário — sem estarem aqui, o proxy redirecionava os
// dois pra /login e nada chegava no handler. Não ficam desprotegidos: cada
// rota valida a própria credencial antes de tocar no banco (assinatura
// HMAC da Meta / Bearer CRON_SECRET).
const PUBLIC_PATHS = ["/login", "/cadastro", "/convite", "/api/webhooks", "/api/cron"];

function isPublicPath(pathname: string) {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // getUser() valida o JWT contra o Supabase Auth (não apenas lê o cookie),
  // e a chamada também renova o token de sessão quando está perto de expirar.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(request.nextUrl.pathname)) {
    const loginUrl = new URL("/login", request.url);
    return NextResponse.redirect(loginUrl);
  }

  // Quem ativou o 2FA e ainda não digitou o código nesta sessão vai pra
  // tela do código. A barreira de verdade é o banco (migration 0025 — sem
  // aal2, nenhuma tabela responde); isto aqui é só pra pessoa não cair
  // numa tela vazia.
  if (user && !isPublicPath(request.nextUrl.pathname)) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal?.nextLevel === "aal2" && aal.currentLevel !== "aal2") {
      const mfaUrl = new URL("/login/2fa", request.url);
      mfaUrl.searchParams.set("redirectTo", request.nextUrl.pathname);
      return NextResponse.redirect(mfaUrl);
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
