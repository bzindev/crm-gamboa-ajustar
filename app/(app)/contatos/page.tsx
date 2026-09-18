import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getActiveOrgMembership } from "@/lib/auth/session";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/format/initials";
import { ContactDialog } from "./contact-dialog";

export default async function ContatosPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const membership = await getActiveOrgMembership();
  if (!membership) redirect("/onboarding");

  const { q } = await searchParams;
  const query = q?.trim() ?? "";

  const supabase = await createClient();

  let contactsQuery = supabase
    .from("contacts")
    .select("id, name, phone_e164, opted_in")
    .eq("org_id", membership.orgId)
    .order("name", { ascending: true });

  if (query) {
    contactsQuery = contactsQuery.or(`name.ilike.%${query}%,phone_e164.ilike.%${query}%`);
  }

  const [{ data: contacts }, { data: leads }] = await Promise.all([
    contactsQuery,
    supabase.from("leads").select("contact_id").eq("org_id", membership.orgId),
  ]);

  const leadCountByContact = new Map<string, number>();
  for (const lead of leads ?? []) {
    leadCountByContact.set(lead.contact_id, (leadCountByContact.get(lead.contact_id) ?? 0) + 1);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contatos</h1>
          <p className="text-muted-foreground">
            Pessoas cadastradas em {membership.orgName}.
          </p>
        </div>
        <ContactDialog trigger={<Button>Novo contato</Button>} />
      </div>

      <form method="get" className="flex max-w-sm items-center gap-2">
        <Input name="q" placeholder="Buscar por nome ou telefone..." defaultValue={query} />
        <Button type="submit" variant="outline">
          Buscar
        </Button>
      </form>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Nome</TableHead>
            <TableHead>Telefone</TableHead>
            <TableHead>Opt-in</TableHead>
            <TableHead>Leads</TableHead>
            <TableHead className="w-0" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {contacts?.map((contact) => (
            <TableRow key={contact.id}>
              <TableCell>
                <Link href={`/contatos/${contact.id}`} className="flex items-center gap-2.5 font-medium hover:underline">
                  <Avatar className="size-7 shrink-0">
                    <AvatarFallback className="bg-[#18181b] text-[10px] font-semibold text-white">
                      {getInitials(contact.name)}
                    </AvatarFallback>
                  </Avatar>
                  {contact.name}
                </Link>
              </TableCell>
              <TableCell className="font-mono text-sm">{contact.phone_e164}</TableCell>
              <TableCell>
                <Badge variant={contact.opted_in ? "default" : "secondary"}>
                  {contact.opted_in ? "sim" : "não"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant="outline">{leadCountByContact.get(contact.id) ?? 0}</Badge>
              </TableCell>
              <TableCell>
                <ContactDialog
                  contact={contact}
                  trigger={
                    <Button variant="ghost" size="sm">
                      Editar
                    </Button>
                  }
                />
              </TableCell>
            </TableRow>
          ))}
          {(!contacts || contacts.length === 0) && (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                {query ? "Nenhum contato encontrado." : "Nenhum contato ainda."}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
