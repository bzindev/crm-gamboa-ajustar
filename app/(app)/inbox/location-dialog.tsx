"use client";

import { useState, useTransition } from "react";
import { LocateFixed } from "lucide-react";
import { sendLocation } from "@/lib/actions/messages";
import { parseCoordinates } from "@/lib/whatsapp/media-rules";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function LocationDialog({
  conversationId,
  open,
  onOpenChange,
}: {
  conversationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [where, setWhere] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [isPending, startTransition] = useTransition();

  const coords = parseCoordinates(where);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setError("Este navegador não informa a localização.");
      return;
    }
    setLocating(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setWhere(`${position.coords.latitude.toFixed(6)}, ${position.coords.longitude.toFixed(6)}`);
        setLocating(false);
      },
      () => {
        setError("Não foi possível pegar sua localização (permissão negada?). Cole um link do Google Maps.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  function send() {
    if (!coords) return;
    setError(null);
    startTransition(async () => {
      const result = await sendLocation({
        conversationId,
        ...coords,
        name: name.trim() || undefined,
        address: address.trim() || undefined,
      });
      if (result?.error) {
        setError(result.error);
        return;
      }
      setWhere("");
      setName("");
      setAddress("");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Enviar localização</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="loc-where">Link do Google Maps ou coordenadas</Label>
            <Input
              id="loc-where"
              value={where}
              onChange={(e) => setWhere(e.target.value)}
              placeholder="Cole o link do Maps ou -23.5505, -46.6333"
            />
            <div className="flex items-center justify-between gap-2">
              <Button type="button" variant="outline" size="sm" onClick={useMyLocation} disabled={locating}>
                <LocateFixed className="size-4" />
                {locating ? "Localizando..." : "Usar minha localização atual"}
              </Button>
              {where && (
                <span className={coords ? "text-xs text-positive" : "text-xs text-destructive"}>
                  {coords ? "Localização reconhecida" : "Não reconheci a localização"}
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              No Google Maps: abra o lugar → Compartilhar → Copiar link. Link encurtado (maps.app.goo.gl)
              não traz as coordenadas — abra o link no navegador e copie o endereço da barra.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="loc-name">Nome do lugar (opcional)</Label>
            <Input id="loc-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Renault Gamboa" maxLength={200} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="loc-address">Endereço (opcional)</Label>
            <Input id="loc-address" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Rua, número — bairro, cidade" maxLength={300} />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="button" onClick={send} disabled={!coords || isPending}>
            {isPending ? "Enviando..." : "Enviar localização"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
