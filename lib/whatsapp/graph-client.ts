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
