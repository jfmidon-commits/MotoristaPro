import { formatCentsToBRL, parseBRLInputToCents } from "@/utils/formatters";

describe("formatCentsToBRL", () => {
  it("formata centavos como moeda brasileira", () => {
    expect(formatCentsToBRL(1000)).toBe("R$\u00A010,00");
  });

  it("formata zero corretamente", () => {
    expect(formatCentsToBRL(0)).toBe("R$\u00A00,00");
  });

  it("formata valores negativos (saldo negativo)", () => {
    expect(formatCentsToBRL(-500)).toBe("-R$\u00A05,00");
  });

  it("formata valores grandes com separador de milhar", () => {
    expect(formatCentsToBRL(123456789)).toBe("R$\u00A01.234.567,89");
  });
});

describe("parseBRLInputToCents", () => {
  it("converte '10,50' para 1050 centavos", () => {
    expect(parseBRLInputToCents("10,50")).toBe(1050);
  });

  it("converte '10.50' (ponto) para 1050 centavos", () => {
    expect(parseBRLInputToCents("10.50")).toBe(1050);
  });

  it("ignora símbolo de moeda e espaços", () => {
    expect(parseBRLInputToCents("R$ 25,00")).toBe(2500);
  });

  it("trata string vazia como zero", () => {
    expect(parseBRLInputToCents("")).toBe(0);
  });

  it("arredonda corretamente para evitar erro de ponto flutuante", () => {
    expect(parseBRLInputToCents("0,10")).toBe(10);
    expect(parseBRLInputToCents("19,99")).toBe(1999);
  });

  it("é a inversa de formatCentsToBRL para valores redondos", () => {
    const cents = 4599;
    const formatted = formatCentsToBRL(cents);
    const raw = formatted.replace("R$", "").trim();
    expect(parseBRLInputToCents(raw)).toBe(cents);
  });
});
