"use client";

import { useActionState } from "react";
import { createOrganization, type ActionState } from "@/lib/actions/organizations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function OnboardingForm() {
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    createOrganization,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Crie sua organização</CardTitle>
        <CardDescription>
          É o espaço onde sua equipe vai atender os clientes pelo WhatsApp.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="name">Nome da organização</Label>
            <Input id="name" name="name" placeholder="Ex.: Loja da Ana" required />
          </div>
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          <Button type="submit" disabled={isPending} className="mt-2">
            {isPending ? "Criando..." : "Criar organização"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
