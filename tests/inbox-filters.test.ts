import { describe, expect, it } from "vitest";
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  filtersToSearchParams,
  parseInboxFilters,
  resolvePeriod,
} from "@/lib/inbox/filters";

const TAG_A = "11111111-1111-4111-8111-111111111111";
const TAG_B = "22222222-2222-4222-8222-222222222222";
const USER = "33333333-3333-4333-8333-333333333333";

describe("filtros da Inbox na URL", () => {
  it("URL vazia = filtros padrão", () => {
    expect(parseInboxFilters(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
    expect(filtersToSearchParams(DEFAULT_FILTERS).toString()).toBe("");
  });

  it("ida e volta: o link gerado reproduz exatamente os mesmos filtros", () => {
    const url = `q=Ana&status=open&temp=hot,none&tags=${TAG_A},${TAG_B}&tagMode=all&vendor=me,none,${USER}&period=custom&date=created&from=2026-09-01&to=2026-09-10&unread=1&awaiting=1`;
    const filters = parseInboxFilters(new URLSearchParams(url));
    expect(filters).toMatchObject({
      q: "Ana",
      status: "open",
      temperatures: ["hot", "none"],
      tagIds: [TAG_A, TAG_B],
      tagMode: "all",
      vendors: ["me", "none", USER],
      period: "custom",
      dateField: "created",
      from: "2026-09-01",
      to: "2026-09-10",
      unread: true,
      awaiting: true,
    });
    expect(parseInboxFilters(filtersToSearchParams(filters))).toEqual(filters);
  });

  it("valor inválido é ignorado em vez de quebrar a tela", () => {
    const filters = parseInboxFilters(
      new URLSearchParams("status=arquivada&temp=fervendo,hot&tags=nao-e-uuid&vendor=' or 1=1&period=sempre&from=ontem"),
    );
    expect(filters.status).toBeNull();
    expect(filters.temperatures).toEqual(["hot"]);
    expect(filters.tagIds).toEqual([]);
    expect(filters.vendors).toEqual([]);
    expect(filters.period).toBeNull();
    expect(filters.from).toBeNull();
  });

  it("datas só valem no período personalizado; itens repetidos contam uma vez", () => {
    const filters = parseInboxFilters(new URLSearchParams(`period=7d&from=2026-09-01&tags=${TAG_A},${TAG_A}`));
    expect(filters.from).toBeNull();
    expect(filters.tagIds).toEqual([TAG_A]);
  });

  it("conta os filtros ativos (a aba de status não conta)", () => {
    expect(countActiveFilters(DEFAULT_FILTERS)).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, status: "open" })).toBe(0);
    expect(countActiveFilters({ ...DEFAULT_FILTERS, temperatures: ["hot", "cold"], unread: true, q: "x" })).toBe(3);
  });
});

describe("período no horário de Brasília", () => {
  // 01:30 de 15/09/2026 em Brasília (04:30 UTC).
  const now = new Date("2026-09-15T04:30:00Z");
  const iso = (d: Date | null) => d?.toISOString() ?? null;

  it("hoje começa à meia-noite de Brasília (03:00 UTC), não à meia-noite UTC", () => {
    const { from, to } = resolvePeriod({ period: "today", from: null, to: null }, now);
    expect(iso(from)).toBe("2026-09-15T03:00:00.000Z");
    expect(iso(to)).toBe("2026-09-16T03:00:00.000Z");
  });

  it("às 23h de Brasília ainda é o mesmo dia (já é dia seguinte em UTC)", () => {
    const late = new Date("2026-09-16T02:00:00Z"); // 15/09 23:00 em Brasília
    expect(iso(resolvePeriod({ period: "today", from: null, to: null }, late).from)).toBe("2026-09-15T03:00:00.000Z");
  });

  it("ontem, 7 e 30 dias incluem o dia de hoje inteiro", () => {
    expect(resolvePeriod({ period: "yesterday", from: null, to: null }, now)).toEqual({
      from: new Date("2026-09-14T03:00:00Z"),
      to: new Date("2026-09-15T03:00:00Z"),
    });
    expect(iso(resolvePeriod({ period: "7d", from: null, to: null }, now).from)).toBe("2026-09-09T03:00:00.000Z");
    expect(iso(resolvePeriod({ period: "30d", from: null, to: null }, now).from)).toBe("2026-08-17T03:00:00.000Z");
  });

  it("este mês e mês passado (inclusive virada de ano)", () => {
    expect(resolvePeriod({ period: "this_month", from: null, to: null }, now)).toEqual({
      from: new Date("2026-09-01T03:00:00Z"),
      to: new Date("2026-10-01T03:00:00Z"),
    });
    const january = new Date("2027-01-10T15:00:00Z");
    expect(resolvePeriod({ period: "last_month", from: null, to: null }, january)).toEqual({
      from: new Date("2026-12-01T03:00:00Z"),
      to: new Date("2027-01-01T03:00:00Z"),
    });
  });

  it("personalizado: 'até' inclui o último dia inteiro; lado vazio fica aberto", () => {
    expect(resolvePeriod({ period: "custom", from: "2026-09-01", to: "2026-09-10" }, now)).toEqual({
      from: new Date("2026-09-01T03:00:00Z"),
      to: new Date("2026-09-11T03:00:00Z"),
    });
    expect(resolvePeriod({ period: "custom", from: null, to: "2026-09-10" }, now).from).toBeNull();
  });
});
