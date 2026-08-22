import {
  centsToBRLInput,
  formatBRLDigitsInput,
  formatCentsToBRL,
  parseBRLInputToCents
} from "@/utils/formatters";

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

describe("formatBRLDigitsInput", () => {
  it("desloca os dígitos como centavos durante a digitação", () => {
    expect(formatBRLDigitsInput("1")).toBe("0,01");
    expect(formatBRLDigitsInput("11")).toBe("0,11");
    expect(formatBRLDigitsInput("111")).toBe("1,11");
    expect(formatBRLDigitsInput("1111")).toBe("11,11");
    expect(formatBRLDigitsInput("2000")).toBe("20,00");
  });

  it("reformata mesmo quando recebe valor já mascarado", () => {
    expect(formatBRLDigitsInput("1.234,56")).toBe("1.234,56");
  });

  it("retorna vazio quando não há dígitos", () => {
    expect(formatBRLDigitsInput("")).toBe("");
  });
});

describe("centsToBRLInput", () => {
  it("transforma centavos no valor editável sem símbolo", () => {
    expect(centsToBRLInput(1111)).toBe("11,11");
    expect(centsToBRLInput(123456)).toBe("1.234,56");
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

  it("interpreta corretamente valores com separador de milhar pt-BR", () => {
    expect(parseBRLInputToCents("1.234,56")).toBe(123456);
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
