"use client";

import { useActionState, useMemo, useState } from "react";
import { createCampaign, type CampaignActionState } from "@/lib/actions/campaigns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

type Template = { id: string; name: string; category: string; body_text: string };
type Contact = { id: string; name: string; phone: string; optedIn: boolean };

export function CampaignForm({ templates, contacts }: { templates: Template[]; contacts: Contact[] }) {
  const [state, formAction, isPending] = useActionState<CampaignActionState, FormData>(
    createCampaign,
    null,
  );
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q),
    );
  }, [contacts, search]);

  const optedInIds = useMemo(() => contacts.filter((c) => c.optedIn).map((c) => c.id), [contacts]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form action={formAction} className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Dados da campanha</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nome da campanha</Label>
            <Input id="name" name="name" placeholder="Promoção de setembro" required />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="templateId">Template</Label>
            <select
              id="templateId"
              name="templateId"
              required
              className="h-9 rounded-md border bg-transparent px-3 text-sm"
            >
              <option value="">Selecione...</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Destinatários</CardTitle>
          <CardDescription>
            Só contatos com consentimento (opt-in) marcado recebem a mensagem — os demais são
            pulados automaticamente, mesmo que selecionados aqui.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Input
              placeholder="Buscar por nome ou telefone..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setSelected(new Set(optedInIds))}
            >
              Selecionar todos com opt-in ({optedInIds.length})
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Limpar
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto rounded-md border">
            {filtered.map((contact) => (
              <label
                key={contact.id}
                className="flex items-center gap-3 border-b px-3 py-2 text-sm last:border-b-0 hover:bg-muted/50"
              >
                <input
                  type="checkbox"
                  name="contactIds"
                  value={contact.id}
                  checked={selected.has(contact.id)}
                  onChange={() => toggle(contact.id)}
                />
                <span className="flex-1">{contact.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{contact.phone}</span>
                <Badge variant={contact.optedIn ? "default" : "outline"} className="text-[10px]">
                  {contact.optedIn ? "opt-in" : "sem opt-in"}
                </Badge>
              </label>
            ))}
            {filtered.length === 0 && (
              <p className="p-4 text-center text-sm text-muted-foreground">Nenhum contato encontrado.</p>
            )}
          </div>

          <p className="text-xs text-muted-foreground">{selected.size} contato(s) selecionado(s).</p>
        </CardContent>
      </Card>

      {state?.error && <p className="text-sm text-destructive">{state.error}</p>}

      <Button type="submit" disabled={isPending || selected.size === 0} className="w-fit">
        {isPending ? "Criando campanha..." : "Criar e disparar"}
      </Button>
    </form>
  );
}
