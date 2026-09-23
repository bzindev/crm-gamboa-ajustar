import Link from "next/link";
import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Plus } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  draft: "Rascunho",
  sending: "Enviando",
  done: "Concluída",
  failed: "Falhou",
};

const STATUS_VARIANT: Record<string, "secondary" | "default" | "destructive" | "outline"> = {
  draft: "outline",
  sending: "secondary",
  done: "default",
  failed: "destructive",
};

export default async function CampanhasPage() {
  const membership = await requireRoleOrRedirect("manager");
  const supabase = await createClient();

  const { data: campaigns } = await supabase
    .from("bulk_campaigns")
    .select("id, name, status, total_recipients, sent_count, failed_count, created_at, message_templates(name)")
    .eq("org_id", membership.orgId)
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/disparos/novo">
            <Plus className="size-4" />
            Nova campanha
          </Link>
        </Button>
      </div>

      {(campaigns ?? []).length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Nenhuma campanha ainda.
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {(campaigns ?? []).map((campaign) => {
            const template = Array.isArray(campaign.message_templates)
              ? campaign.message_templates[0]
              : campaign.message_templates;
            return (
              <Link key={campaign.id} href={`/disparos/${campaign.id}`}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium">{campaign.name}</p>
                      <p className="text-xs text-muted-foreground">
                        Template: {template?.name ?? "—"} ·{" "}
                        {new Date(campaign.created_at).toLocaleDateString("pt-BR")}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <span className="text-muted-foreground">
                        {campaign.sent_count}/{campaign.total_recipients} enviadas
                        {campaign.failed_count > 0 && ` · ${campaign.failed_count} falharam`}
                      </span>
                      <Badge variant={STATUS_VARIANT[campaign.status] ?? "outline"}>
                        {STATUS_LABELS[campaign.status] ?? campaign.status}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
