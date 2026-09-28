"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { ShieldCheck, ShieldOff } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { recordMfaChange } from "@/lib/actions/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type Enrolling = { factorId: string; qrCode: string; secret: string };

export function MfaSettings() {
  const [verifiedFactorId, setVerifiedFactorId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const reload = useCallback(async () => {
    const { data } = await createClient().auth.mfa.listFactors();
    setVerifiedFactorId(data?.totp.find((f) => f.status === "verified")?.id ?? null);
    setLoaded(true);
  }, []);

  useEffect(() => {
    // Buscar os fatores só existe no cliente (sessão do navegador) — por
    // isso é um efeito de carregamento, não dado vindo do servidor.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reload();
  }, [reload]);

  function start() {
    setError(null);
    startTransition(async () => {
      const supabase = createClient();
      // Uma tentativa anterior abandonada no meio deixa um fator "não
      // verificado" que bloqueia criar outro — limpa antes.
      const { data: existing } = await supabase.auth.mfa.listFactors();
      for (const factor of existing?.all ?? []) {
        if (factor.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: factor.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `CRM ${new Date().toLocaleDateString("pt-BR")} ${Date.now()}`,
      });
      if (enrollError || !data) {
        setError("Não foi possível iniciar a ativação. Tente de novo.");
        return;
      }
      setEnrolling({ factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
    });
  }

  function confirm(event: React.FormEvent) {
    event.preventDefault();
    if (!enrolling) return;
    setError(null);
    startTransition(async () => {
      const { error: verifyError } = await createClient().auth.mfa.challengeAndVerify({
        factorId: enrolling.factorId,
        code: code.trim(),
      });
      if (verifyError) {
        setError("Código inválido. Confira se o horário do celular está certo e tente de novo.");
        return;
      }
      await recordMfaChange("enabled");
      setEnrolling(null);
      setCode("");
      await reload();
    });
  }

  function disable() {
    if (!verifiedFactorId) return;
    if (!window.confirm("Desativar a verificação em duas etapas? Sua conta fica protegida só pela senha.")) return;
    setError(null);
    startTransition(async () => {
      const { error: unenrollError } = await createClient().auth.mfa.unenroll({ factorId: verifiedFactorId });
      if (unenrollError) {
        setError("Não foi possível desativar. Saia, entre de novo com o código e tente outra vez.");
        return;
      }
      await recordMfaChange("disabled");
      await reload();
    });
  }

  if (!loaded) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (verifiedFactorId) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-positive" />
          <Badge>2FA ativado</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Toda vez que entrar, além da senha, o sistema vai pedir o código do app autenticador.
        </p>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button type="button" variant="outline" onClick={disable} disabled={isPending} className="w-fit">
          <ShieldOff className="size-4" />
          Desativar 2FA
        </Button>
      </div>
    );
  }

  if (enrolling) {
    return (
      <form onSubmit={confirm} className="flex max-w-md flex-col gap-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Abra o app autenticador (Google Authenticator, Microsoft Authenticator, Authy…).</li>
          <li>Escaneie o QR code abaixo.</li>
          <li>Digite o código de 6 dígitos que aparecer.</li>
        </ol>
        {/* QR vem pronto do Supabase como SVG em data URL — next/image não agrega nada aqui. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrolling.qrCode} alt="QR code do 2FA" className="size-48 rounded-md bg-white p-2" />
        <p className="text-xs text-muted-foreground">
          Não consegue escanear? Digite esta chave no app:{" "}
          <code className="break-all rounded bg-muted px-1">{enrolling.secret}</code>
        </p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="mfa-code">Código</Label>
          <Input
            id="mfa-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder="123456"
            className="w-40"
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={isPending || code.length !== 6}>
            {isPending ? "Confirmando..." : "Confirmar e ativar"}
          </Button>
          <Button type="button" variant="ghost" onClick={() => setEnrolling(null)}>
            Cancelar
          </Button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Com o 2FA, mesmo que alguém descubra sua senha, não consegue entrar sem o código que muda a
        cada 30 segundos no seu celular.
      </p>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="button" onClick={start} disabled={isPending} className="w-fit">
        <ShieldCheck className="size-4" />
        {isPending ? "Preparando..." : "Ativar 2FA"}
      </Button>
    </div>
  );
}
