import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { TemplateForm } from "./template-form";
import { RefreshStatusButton } from "./refresh-status-button";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  pending: "Em análise pela Meta",
  approved: "Aprovado",
  rejected: "Rejeitado",
};

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  draft: "outline",
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: "Marketing",
  UTILITY: "Utilidade",
  AUTHENTICATION: "Autenticação",
};

export default async function TemplatesPage() {
  // Admin só — o mesmo papel que pode conectar o canal WhatsApp, já que
  // template é vinculado à conta de negócio (WABA) da organização.
  const membership = await requireRoleOrRedirect("admin");
  const supabase = await createClient();

  const { data: templates } = await supabase
    .from("message_templates")
    .select("id, name, language, category, body_text, status, rejected_reason, created_at")
    .eq("org_id", membership.orgId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <TemplateForm
          trigger={
            <Button>
              <Plus className="size-4" />
              Novo template
            </Button>
          }
        />
      </div>

      {(templates ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhum template ainda. Crie um para poder disparar mensagens fora da janela de 24h.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(templates ?? []).map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="font-mono text-sm">{template.name}</CardTitle>
                  <div className="flex items-center gap-1">
                    <Badge variant={STATUS_VARIANT[template.status] ?? "outline"}>
                      {STATUS_LABELS[template.status] ?? template.status}
                    </Badge>
                    {template.status === "pending" && <RefreshStatusButton templateId={template.id} />}
                  </div>
                </div>
                <CardDescription>
                  {CATEGORY_LABELS[template.category] ?? template.category} · {template.language}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                <p className="text-sm">{template.body_text}</p>
                {template.status === "rejected" && template.rejected_reason && (
                  <p className="text-xs text-destructive">Motivo: {template.rejected_reason}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
