"use client";

import { useState, useTransition } from "react";
import { Plus, Tag as TagIcon } from "lucide-react";
import {
  setConversationTemperature,
  setConversationTags,
  addNewTagToConversation,
} from "@/lib/actions/conversations";
import { TEMPERATURES, type Temperature } from "@/lib/crm/temperature";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export type LabelTag = { id: string; name: string; color: string };

export function tagChipStyle(color: string): React.CSSProperties {
  return { backgroundColor: `${color}26`, color, borderColor: `${color}66` };
}

export function ConversationLabels({
  conversationId,
  temperature: initialTemperature,
  allTags,
  selectedTagIds: initialSelected,
}: {
  conversationId: string;
  temperature: Temperature | null;
  allTags: LabelTag[];
  selectedTagIds: string[];
}) {
  const [temperature, setTemperature] = useState(initialTemperature);
  const [selected, setSelected] = useState(initialSelected);
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Quando chega dado novo do servidor (outra pessoa etiquetou, ou a
  // etiqueta recém-criada entrou), acompanha — ajuste durante o render,
  // padrão do React pra "estado derivado de prop".
  const serverKey = `${initialTemperature ?? ""}|${initialSelected.join(",")}`;
  const [syncedKey, setSyncedKey] = useState(serverKey);
  if (serverKey !== syncedKey) {
    setSyncedKey(serverKey);
    setTemperature(initialTemperature);
    setSelected(initialSelected);
  }

  // Mudança otimista: aparece na hora; se o servidor recusar, volta.
  function pickTemperature(value: Temperature) {
    const next = temperature === value ? null : value;
    const previous = temperature;
    setTemperature(next);
    setError(null);
    startTransition(async () => {
      const result = await setConversationTemperature({ conversationId, temperature: next });
      if (result.error) {
        setTemperature(previous);
        setError(result.error);
      }
    });
  }

  function toggleTag(tagId: string, checked: boolean) {
    const previous = selected;
    const next = checked ? [...selected, tagId] : selected.filter((id) => id !== tagId);
    setSelected(next);
    setError(null);
    startTransition(async () => {
      const result = await setConversationTags({ conversationId, tagIds: next });
      if (result.error) {
        setSelected(previous);
        setError(result.error);
      }
    });
  }

  function createTag() {
    const name = newName.trim();
    if (!name) return;
    setError(null);
    startTransition(async () => {
      const result = await addNewTagToConversation({ conversationId, name });
      if (result.error) setError(result.error);
      else setNewName("");
    });
  }

  const selectedTags = allTags.filter((tag) => selected.includes(tag.id));

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b px-4 py-2">
      {TEMPERATURES.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => pickTemperature(option.value)}
          disabled={isPending}
          aria-pressed={temperature === option.value}
          className={cn(
            "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
            temperature === option.value
              ? option.className
              : "border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}

      <span className="mx-1 h-4 w-px bg-border" />

      {selectedTags.map((tag) => (
        <span key={tag.id} className="rounded-full border px-2 py-0.5 text-xs font-medium" style={tagChipStyle(tag.color)}>
          {tag.name}
        </span>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="ghost" size="sm" className="h-6 gap-1 px-2 text-xs">
            <TagIcon className="size-3.5" />
            Etiqueta
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Etiquetas da conversa</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <div className="max-h-60 overflow-y-auto">
            {allTags.map((tag) => (
              <DropdownMenuCheckboxItem
                key={tag.id}
                checked={selected.includes(tag.id)}
                onCheckedChange={(checked) => toggleTag(tag.id, checked === true)}
                onSelect={(e) => e.preventDefault()}
              >
                <span className="size-2.5 rounded-full" style={{ backgroundColor: tag.color }} />
                {tag.name}
              </DropdownMenuCheckboxItem>
            ))}
            {allTags.length === 0 && (
              <p className="px-2 py-1.5 text-xs text-muted-foreground">Nenhuma etiqueta ainda — crie abaixo.</p>
            )}
          </div>
          <DropdownMenuSeparator />
          <div className="flex items-center gap-1 p-1">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              // O menu captura as teclas pra navegação — sem isso, digitar
              // uma letra pulava pro item que começa com ela.
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") {
                  e.preventDefault();
                  createTag();
                }
              }}
              placeholder="Nova etiqueta (ex.: VIP)"
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-xs"
            />
            <Button type="button" size="icon" className="size-8" onClick={createTag} disabled={isPending || !newName.trim()} title="Criar e adicionar">
              <Plus className="size-4" />
            </Button>
          </div>
        </DropdownMenuContent>
      </DropdownMenu>

      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
