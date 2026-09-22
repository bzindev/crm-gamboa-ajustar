import { SettingsTabs } from "./settings-tabs";

export default function ConfiguracoesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações</h1>
        <p className="text-muted-foreground">Organização, equipe e conexões.</p>
      </div>

      <SettingsTabs />

      {children}
    </div>
  );
}
