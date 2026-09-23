import { RelatoriosTabs } from "./relatorios-tabs";

export default function RelatoriosLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="print:hidden">
        <h1 className="text-2xl font-bold">Relatórios</h1>
        <p className="text-muted-foreground">Desempenho geral e base de contatos.</p>
      </div>

      <div className="print:hidden">
        <RelatoriosTabs />
      </div>

      {children}
    </div>
  );
}
