import { CadastroForm } from "./cadastro-form";

export default async function CadastroPage({
  searchParams,
}: {
  searchParams: Promise<{ redirectTo?: string; email?: string }>;
}) {
  const { redirectTo, email } = await searchParams;
  return <CadastroForm redirectTo={redirectTo} defaultEmail={email} />;
}
