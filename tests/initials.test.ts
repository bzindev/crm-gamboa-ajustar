import { describe, expect, it } from "vitest";
import { getInitials } from "@/lib/format/initials";

describe("getInitials", () => {
  it.each([
    ["Cliente Demonstração (teste)", "CT"],
    ["Maria Souza", "MS"],
    ["Ana", "AN"],
    ["+5511999999999", "55"],
    ["  ", "?"],
    ["(sem nome)", "SN"],
  ])("%j → %j", (name, expected) => {
    expect(getInitials(name)).toBe(expected);
  });
});
