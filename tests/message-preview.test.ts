import { describe, expect, it } from "vitest";
import { messagePreview } from "@/lib/inbox/message-preview";

describe("messagePreview", () => {
  it.each([
    ["text", { body: "Oi" }, "Oi"],
    ["image", { body: null, media: {} }, "📷 Foto"],
    ["image", { body: "Olha o carro", media: {} }, "📷 Foto · Olha o carro"],
    ["document", { body: null, media: { filename: "proposta.pdf" } }, "📄 proposta.pdf"],
    ["location", { location: { name: "Renault Gamboa" } }, "📍 Renault Gamboa"],
    ["location", { location: {} }, "📍 Localização"],
    ["audio", null, "🎤 Áudio"],
    ["template", { body: "Olá Maria" }, "Olá Maria"],
  ])("%s %j → %j", (type, content, expected) => {
    expect(messagePreview(type, content)).toBe(expected);
  });
});
