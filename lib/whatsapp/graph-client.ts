import "server-only";

function baseUrl(): string {
  const version = process.env.WHATSAPP_GRAPH_API_VERSION ?? "v23.0";
  return `https://graph.facebook.com/${version}`;
}

export class GraphApiError extends Error {
  code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "GraphApiError";
    this.code = code;
  }
}

async function parseGraphError(response: Response): Promise<never> {
  const body = await response.json().catch(() => null);
  const error = body?.error;
  throw new GraphApiError(error?.message ?? `Graph API respondeu ${response.status}`, error?.code);
}

/** Confirma que o token/phone_number_id funcionam antes de salvar o canal. */
export async function getPhoneNumberInfo(phoneNumberId: string, accessToken: string) {
  const response = await fetch(
    `${baseUrl()}/${phoneNumberId}?fields=verified_name,display_phone_number`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    await parseGraphError(response);
  }
  return (await response.json()) as { verified_name?: string; display_phone_number?: string };
}

/** POST /{phone-number-id}/messages — texto livre dentro da janela de 24h. */
export async function sendTextMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  body: string,
) {
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body },
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  const data = (await response.json()) as { messages?: { id: string }[] };
  const wamid = data.messages?.[0]?.id;
  if (!wamid) {
    throw new GraphApiError("A Meta não devolveu o id da mensagem enviada.");
  }
  return { wamid };
}

/**
 * POST /{phone-number-id}/messages com type "template" — o único jeito de
 * iniciar conversa fora da janela de 24h. `bodyParams` preenche as
 * variáveis {{1}}, {{2}}... na ordem, na única seção BODY do template
 * (v1 não suporta header/footer/botão com variável).
 */
export async function sendTemplateMessage(
  phoneNumberId: string,
  accessToken: string,
  to: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[],
) {
  const response = await fetch(`${baseUrl()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components:
          bodyParams.length > 0
            ? [
                {
                  type: "body",
                  parameters: bodyParams.map((text) => ({ type: "text", text })),
                },
              ]
            : undefined,
      },
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  const data = (await response.json()) as { messages?: { id: string }[] };
  const wamid = data.messages?.[0]?.id;
  if (!wamid) {
    throw new GraphApiError("A Meta não devolveu o id da mensagem enviada.");
  }
  return { wamid };
}

/**
 * POST /{waba-id}/message_templates — submete o template pra aprovação da
 * Meta. Categoria e corpo não dá para editar depois de aprovado (a Meta
 * trata como um template novo); por isso não existe "editar", só criar de
 * novo com outro nome se precisar mudar o texto.
 */
export async function createMessageTemplate(
  wabaId: string,
  accessToken: string,
  params: { name: string; language: string; category: string; bodyText: string },
) {
  const response = await fetch(`${baseUrl()}/${wabaId}/message_templates`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: params.name,
      language: params.language,
      category: params.category,
      components: [{ type: "BODY", text: params.bodyText }],
    }),
  });

  if (!response.ok) {
    await parseGraphError(response);
  }

  return (await response.json()) as { id: string; status: string; category: string };
}

/** GET /{waba-id}/message_templates?name=... — consulta o status atual (a aprovação da Meta acontece fora do nosso controle, de minutos a dias). */
export async function getMessageTemplateStatus(wabaId: string, accessToken: string, name: string) {
  const response = await fetch(
    `${baseUrl()}/${wabaId}/message_templates?name=${encodeURIComponent(name)}&fields=status,rejected_reason`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) {
    await parseGraphError(response);
  }
  const data = (await response.json()) as {
    data?: { status: string; rejected_reason?: string }[];
  };
  return data.data?.[0] ?? null;
}
