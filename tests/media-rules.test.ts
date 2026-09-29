import { describe, expect, it } from "vitest";
import { kindForMime, validateMediaFile, safeFileName, parseCoordinates, formatBytes } from "@/lib/whatsapp/media-rules";

const MB = 1024 * 1024;

describe("regras de mídia", () => {
  it.each([
    ["image/jpeg", "image"],
    ["image/png", "image"],
    ["video/mp4", "video"],
    ["audio/mpeg", "audio"],
    ["audio/ogg; codecs=opus", "audio"],
    ["application/pdf", "document"],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "document"],
  ])("%s → %s", (mime, kind) => {
    expect(kindForMime(mime)).toBe(kind);
  });

  it.each(["image/heic", "image/webp", "application/zip", "application/x-msdownload", ""])("recusa %j", (mime) => {
    expect(kindForMime(mime)).toBeNull();
    expect(validateMediaFile(mime, 1000)).not.toBeNull();
  });

  it("respeita o limite de cada tipo", () => {
    expect(validateMediaFile("image/jpeg", 5 * MB)).toBeNull();
    expect(validateMediaFile("image/jpeg", 5 * MB + 1)).toMatch(/5 MB/);
    expect(validateMediaFile("application/pdf", 40 * MB)).toBeNull();
    expect(validateMediaFile("application/pdf", 51 * MB)).toMatch(/50 MB/);
  });

  it("dá dica pra foto de iPhone", () => {
    expect(validateMediaFile("image/heic", 100)).toMatch(/HEIC/);
  });

  it("nome seguro pro Storage", () => {
    expect(safeFileName("Proposta Kwid Zen (final) ção.pdf")).toBe("Proposta_Kwid_Zen_final_cao.pdf");
    expect(safeFileName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeFileName("???")).toBe("arquivo");
  });

  it("formata tamanho", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(3.5 * MB)).toBe("3,5 MB");
  });
});

describe("parseCoordinates", () => {
  it.each([
    ["-23.5505, -46.6333", -23.5505, -46.6333],
    ["https://www.google.com/maps/@-23.5505,-46.6333,17z", -23.5505, -46.6333],
    ["https://maps.google.com/?q=-23.5505,-46.6333", -23.5505, -46.6333],
    ["https://www.google.com/maps/place/Renault/@-23.5,-46.6,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d-23.5505!4d-46.6333", -23.5505, -46.6333],
  ])("%s", (text, lat, lng) => {
    expect(parseCoordinates(text)).toEqual({ latitude: lat, longitude: lng });
  });

  it.each(["rua tal, 123", "999, 999", ""])("recusa %j", (text) => {
    expect(parseCoordinates(text)).toBeNull();
  });
});
