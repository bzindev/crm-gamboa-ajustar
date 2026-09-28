import { Trash2 } from "lucide-react";
import { requireRoleOrRedirect } from "@/lib/auth/require-role";
import { createClient } from "@/lib/supabase/server";
import { deleteQuickReply } from "@/lib/actions/quick-replies";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuickReplyForm } from "./quick-reply-form";

export default async function RespostasRapidasPage() {
  // Gerente pra cima mantém a lista; vendedor usa direto no chat.
  const membership = await requireRoleOrRedirect("manager");
  const supabase = await createClient();

  const { data: replies } = await supabase
    .from("quick_replies")
    .select("id, title, body")
    .eq("org_id", membership.orgId)
    .order("title");

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Mensagens prontas que qualquer vendedor insere no chat com um clique — dá pra editar antes de
        enviar.
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Nova resposta rápida</CardTitle>
        </CardHeader>
        <CardContent>
          <QuickReplyForm />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Respostas cadastradas</CardTitle>
          <CardDescription>{replies?.length ?? 0} no total.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {(replies ?? []).map((reply) => (
            <div key={reply.id} className="flex items-start gap-3 rounded-xl border px-3 py-2 text-sm">
              <div className="flex-1">
                <p className="font-medium">{reply.title}</p>
                <p className="whitespace-pre-wrap text-xs text-muted-foreground">{reply.body}</p>
              </div>
              <form action={deleteQuickReply}>
                <input type="hidden" name="id" value={reply.id} />
                <Button type="submit" variant="ghost" size="icon" className="size-8" title="Apagar">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </form>
            </div>
          ))}
          {(replies?.length ?? 0) === 0 && (
            <p className="text-sm text-muted-foreground">Nenhuma resposta rápida ainda.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
