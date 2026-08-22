export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * Formata uma sequência digitada como centavos, sem o símbolo de moeda.
 * Ex.: "1" -> "0,01", "1111" -> "11,11", "2000" -> "20,00".
 */
export function formatBRLDigitsInput(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (!digits) return "";

  const cents = Number.parseInt(digits, 10);
  if (!Number.isFinite(cents)) return "";

  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function centsToBRLInput(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

export function parseBRLInputToCents(input: string): number {
  const raw = input.replace(/[^\d,.-]/g, "").trim();
  if (!raw) return 0;

  let normalized: string;
  if (raw.includes(",")) {
    // Formato pt-BR: ponto como milhar e vírgula como decimal.
    normalized = raw.replace(/\./g, "").replace(",", ".");
  } else {
    // Mantém compatibilidade com entrada decimal usando ponto (ex.: 10.50).
    normalized = raw;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}
