import { DisparosTabs } from "./disparos-tabs";

export default function DisparosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Disparo em massa</h1>
        <p className="text-muted-foreground">
          Envie mensagens para vários contatos de uma vez, usando um template aprovado pela Meta.
        </p>
      </div>

      <DisparosTabs />

      {children}
    </div>
  );
}
