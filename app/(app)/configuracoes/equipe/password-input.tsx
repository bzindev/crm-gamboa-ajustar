"use client";

import { useState } from "react";
import { Eye, EyeOff, Wand2 } from "lucide-react";
import { generatePassword } from "@/lib/auth/generate-password";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/** Campo de senha com mostrar/esconder e "Gerar" (senha forte aleatória, já visível pra copiar). */
export function PasswordInput({
  id,
  name,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  name: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex gap-2">
      <div className="relative flex-1">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          required={required}
          className="pr-9"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={visible ? "Esconder senha" : "Mostrar senha"}
        >
          {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          onChange(generatePassword());
          setVisible(true);
        }}
        title="Gerar senha forte"
      >
        <Wand2 className="size-4" />
        Gerar
      </Button>
    </div>
  );
}
