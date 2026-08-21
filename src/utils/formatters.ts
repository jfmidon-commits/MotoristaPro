export function formatCentsToBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function parseBRLInputToCents(input: string): number {
  const normalized = input.replace(/[^\d,.-]/g, "").replace(",", ".");
  const value = parseFloat(normalized || "0");
  return Math.round(value * 100);
}
