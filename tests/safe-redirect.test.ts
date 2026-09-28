import { describe, expect, it } from "vitest";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it.each(["/dashboard", "/inbox/123?x=1", "/contatos#topo"])("aceita caminho interno %s", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "https://evil.com",
    "evil.com",
    "/ok\nSet-Cookie: x",
    "",
    null,
    undefined,
    42,
  ])("recusa %j e volta pro dashboard", (value) => {
    expect(safeRedirectPath(value)).toBe("/dashboard");
  });
});
