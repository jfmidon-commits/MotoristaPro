export type RidePaymentMethod = "cash" | "pix" | "app";

export function paymentMethodLabel(method: RidePaymentMethod): string {
  switch (method) {
    case "cash": return "Dinheiro";
    case "pix": return "Pix";
    case "app": return "Aplicativo";
  }
}

export function incomeCategoryForPlatform(platform: string): string {
  const normalized = platform.trim().toLowerCase();
  if (normalized === "uber") return "Corrida Uber";
  if (normalized === "99") return "Corrida 99";
  if (normalized === "indrive") return "Corrida inDrive";
  return "Corrida aplicativo";
}
