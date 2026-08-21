import React, { useCallback, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getWorkSessionById } from "@/services/WorkSessionService";
import { computeWorkSessionMetrics, formatDuration, type WorkSessionMetrics } from "@/services/WorkSessionMetricsService";
import { getVehicles } from "@/services/VehicleService";
import { formatCentsToBRL } from "@/utils/formatters";
import type { WorkSession } from "@/types";

function metric(value: number | null): string {
  return value == null ? "—" : formatCentsToBRL(value);
}

export default function WorkSessionDetailScreen({ route }: any) {
  const { user } = useAuth();
  const sessionId: string | undefined = route.params?.sessionId;
  const [session, setSession] = useState<WorkSession | null>(null);
  const [metrics, setMetrics] = useState<WorkSessionMetrics | null>(null);
  const [vehicleLabel, setVehicleLabel] = useState("Veículo não informado");

  const load = useCallback(async () => {
    if (!user?.id || !sessionId) return;
    const row = await getWorkSessionById(user.id, sessionId);
    setSession(row);
    if (!row) return;
    const [m, vehicles] = await Promise.all([
      computeWorkSessionMetrics(user.id, row),
      getVehicles(user.id)
    ]);
    setMetrics(m);
    const vehicle = vehicles.find((v) => v.id === row.vehicle_id);
    setVehicleLabel(vehicle ? `${vehicle.name}${vehicle.plate ? ` • ${vehicle.plate}` : ""}` : "Veículo não informado");
  }, [sessionId, user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (!session) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <Text style={styles.empty}>Turno não encontrado.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{new Date(session.started_at).toLocaleDateString("pt-BR")}</Text>
        <Text style={styles.subtitle}>{vehicleLabel}</Text>

        <View style={styles.card}>
          <Row label="Início" value={new Date(session.started_at).toLocaleString("pt-BR")} />
          <Row label="Fim" value={session.ended_at ? new Date(session.ended_at).toLocaleString("pt-BR") : "Em andamento"} />
          <Row label="Duração" value={metrics ? formatDuration(metrics.durationHours) : "—"} />
          <Row label="Odômetro inicial" value={session.start_odometer_km != null ? `${session.start_odometer_km} km` : "—"} />
          <Row label="Odômetro final" value={session.end_odometer_km != null ? `${session.end_odometer_km} km` : "—"} />
          <Row label="Km rodados" value={metrics?.totalKm != null ? `${metrics.totalKm} km` : "—"} />
        </View>

        <View style={styles.card}>
          <Row label="Receita" value={metrics ? formatCentsToBRL(metrics.grossIncome) : "—"} positive />
          <Row label="Despesas" value={metrics ? formatCentsToBRL(metrics.totalExpense) : "—"} negative />
          <Row label="Lucro líquido" value={metrics ? formatCentsToBRL(metrics.netProfit) : "—"} />
          <Row label="R$/hora" value={metric(metrics?.perHourCents ?? null)} />
          <Row label="R$/km" value={metric(metrics?.perKmCents ?? null)} />
          <Row label="Custo/km" value={metric(metrics?.costPerKmCents ?? null)} />
          <Row label="Lançamentos" value={String(metrics?.transactionCount ?? 0)} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, positive, negative }: { label: string; value: string; positive?: boolean; negative?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, positive && styles.positive, negative && styles.negative]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20 },
  empty: { color: "#94A3B8", textAlign: "center", marginTop: 40 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#94A3B8", marginTop: 4, marginBottom: 16 },
  card: { backgroundColor: "#1E293B", borderRadius: 14, padding: 16, marginBottom: 14 },
  row: { flexDirection: "row", justifyContent: "space-between", gap: 16, paddingVertical: 8 },
  label: { color: "#94A3B8", flex: 1 },
  value: { color: "#fff", fontWeight: "700", flex: 1, textAlign: "right" },
  positive: { color: "#22C55E" },
  negative: { color: "#EF4444" }
});
