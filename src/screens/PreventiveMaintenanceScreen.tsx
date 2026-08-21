import React, { useCallback, useState } from "react";
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getVehicles } from "@/services/VehicleService";
import {
  createPreventiveMaintenancePlan,
  deletePreventiveMaintenancePlan,
  getPreventiveMaintenanceOverviewForVehicle,
  setPreventiveMaintenancePlanActive
} from "@/services/PreventiveMaintenanceService";
import type { PreventiveMaintenanceOverview, Vehicle } from "@/types";

const CATEGORIES = [
  "Troca de óleo",
  "Filtro de óleo",
  "Filtro de ar",
  "Filtro de combustível",
  "Pneus",
  "Rodízio de pneus",
  "Freios",
  "Alinhamento",
  "Balanceamento",
  "Revisão",
  "Correia",
  "Fluido de freio",
  "Líquido de arrefecimento",
  "Outros"
] as const;

const PRESETS: Record<string, { intervalKm?: number; intervalDays?: number; warningKm?: number; warningDays?: number }> = {
  "Troca de óleo": { intervalKm: 10_000, intervalDays: 180, warningKm: 1_000, warningDays: 15 },
  "Filtro de óleo": { intervalKm: 10_000, warningKm: 1_000 },
  "Filtro de ar": { intervalKm: 15_000, warningKm: 1_500 },
  "Pneus": { intervalKm: 40_000, warningKm: 3_000 },
  "Rodízio de pneus": { intervalKm: 10_000, warningKm: 1_000 },
  "Freios": { intervalKm: 20_000, warningKm: 2_000 },
  "Revisão": { intervalKm: 10_000, intervalDays: 365, warningKm: 1_000, warningDays: 30 }
};

function parseOptionalPositive(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

function statusText(item: PreventiveMaintenanceOverview): string {
  switch (item.status) {
    case "overdue": return "VENCIDO";
    case "soon": return "EM BREVE";
    case "ok": return "OK";
    default: return "SEM REFERÊNCIA";
  }
}

function remainingText(item: PreventiveMaintenanceOverview): string {
  if (item.status === "unknown") return "Registre a primeira manutenção desta categoria.";
  const parts: string[] = [];
  if (item.remainingKm != null) {
    parts.push(item.remainingKm >= 0 ? `${item.remainingKm} km restantes` : `${Math.abs(item.remainingKm)} km vencidos`);
  }
  if (item.remainingDays != null) {
    parts.push(item.remainingDays >= 0 ? `${item.remainingDays} dias restantes` : `${Math.abs(item.remainingDays)} dias vencidos`);
  }
  return parts.join(" • ") || "Sem dados suficientes";
}

export default function PreventiveMaintenanceScreen({ navigation }: any) {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [overview, setOverview] = useState<PreventiveMaintenanceOverview[]>([]);
  const [category, setCategory] = useState<string>("Troca de óleo");
  const [customCategory, setCustomCategory] = useState("");
  const [intervalKm, setIntervalKm] = useState("10000");
  const [intervalDays, setIntervalDays] = useState("180");
  const [warningKm, setWarningKm] = useState("1000");
  const [warningDays, setWarningDays] = useState("15");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const vehicleRows = await getVehicles(user.id);
    setVehicles(vehicleRows);
    const selected =
      vehicleRows.find((v) => v.id === selectedVehicleId) ??
      vehicleRows.find((v) => v.is_default) ??
      vehicleRows[0] ??
      null;
    setSelectedVehicleId(selected?.id ?? null);
    setOverview(selected ? await getPreventiveMaintenanceOverviewForVehicle(user.id, selected.id) : []);
  }, [selectedVehicleId, user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function selectVehicle(vehicleId: string) {
    if (!user?.id) return;
    setSelectedVehicleId(vehicleId);
    setOverview(await getPreventiveMaintenanceOverviewForVehicle(user.id, vehicleId));
  }

  function applyCategory(next: string) {
    setCategory(next);
    const preset = PRESETS[next];
    setIntervalKm(preset?.intervalKm != null ? String(preset.intervalKm) : "");
    setIntervalDays(preset?.intervalDays != null ? String(preset.intervalDays) : "");
    setWarningKm(preset?.warningKm != null ? String(preset.warningKm) : "");
    setWarningDays(preset?.warningDays != null ? String(preset.warningDays) : "");
  }

  async function handleCreate() {
    if (!user?.id || !selectedVehicleId) {
      Alert.alert("Cadastre ou selecione um veículo primeiro.");
      return;
    }

    const parsedIntervalKm = parseOptionalPositive(intervalKm);
    const parsedIntervalDays = parseOptionalPositive(intervalDays);
    const parsedWarningKm = parseOptionalPositive(warningKm);
    const parsedWarningDays = parseOptionalPositive(warningDays);

    const numericValues = [parsedIntervalKm, parsedIntervalDays, parsedWarningKm, parsedWarningDays];
    if (numericValues.some((value) => value != null && !Number.isFinite(value))) {
      Alert.alert("Confira os intervalos e avisos informados.");
      return;
    }

    const finalCategory = category === "Outros" ? customCategory.trim() : category;
    if (!finalCategory) {
      Alert.alert("Informe o nome da manutenção.");
      return;
    }

    setSaving(true);
    try {
      await createPreventiveMaintenancePlan({
        userId: user.id,
        vehicleId: selectedVehicleId,
        category: finalCategory,
        intervalKm: parsedIntervalKm,
        intervalDays: parsedIntervalDays,
        warningKm: parsedWarningKm,
        warningDays: parsedWarningDays
      });
      if (category === "Outros") setCustomCategory("");
      await selectVehicle(selectedVehicleId);
    } catch (error) {
      Alert.alert("Erro", (error as Error)?.message ?? "Não foi possível criar o plano.");
    } finally {
      setSaving(false);
    }
  }

  async function toggle(item: PreventiveMaintenanceOverview) {
    if (!user?.id) return;
    await setPreventiveMaintenancePlanActive(user.id, item.plan.id, !item.plan.is_active);
    await load();
  }

  function remove(item: PreventiveMaintenanceOverview) {
    if (!user?.id) return;
    Alert.alert("Excluir plano?", `${item.plan.category} deixará de ser acompanhado.`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Excluir",
        style: "destructive",
        onPress: async () => {
          await deletePreventiveMaintenancePlan(user.id, item.plan.id);
          await load();
        }
      }
    ]);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={overview}
        keyExtractor={(item) => item.plan.id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View>
            <Text style={styles.title}>Manutenção preventiva</Text>
            <Text style={styles.subtitle}>Acompanhe por km e/ou tempo sem inventar quilometragem.</Text>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {vehicles.map((vehicle) => (
                <Pressable
                  key={vehicle.id}
                  style={[styles.vehicleChip, selectedVehicleId === vehicle.id && styles.vehicleChipActive]}
                  onPress={() => selectVehicle(vehicle.id)}
                >
                  <Text style={[styles.vehicleText, selectedVehicleId === vehicle.id && styles.vehicleTextActive]}>
                    {vehicle.name}{vehicle.is_default ? " ★" : ""}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>

            {vehicles.length === 0 && (
              <Pressable style={styles.emptyCard} onPress={() => navigation.navigate("Vehicles")}>
                <Text style={styles.emptyText}>Cadastre um veículo para criar planos preventivos.</Text>
              </Pressable>
            )}

            <Text style={styles.section}>Novo plano</Text>
            <View style={styles.categoryWrap}>
              {CATEGORIES.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.categoryChip, category === item && styles.categoryChipActive]}
                  onPress={() => applyCategory(item)}
                >
                  <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>
            {category === "Outros" && (
              <TextInput
                style={styles.input}
                value={customCategory}
                onChangeText={setCustomCategory}
                placeholder="Nome da manutenção"
                placeholderTextColor="#64748B"
              />
            )}
            <View style={styles.formGrid}>
              <TextInput style={styles.halfInput} keyboardType="number-pad" value={intervalKm} onChangeText={setIntervalKm} placeholder="Intervalo km" placeholderTextColor="#64748B" />
              <TextInput style={styles.halfInput} keyboardType="number-pad" value={intervalDays} onChangeText={setIntervalDays} placeholder="Intervalo dias" placeholderTextColor="#64748B" />
              <TextInput style={styles.halfInput} keyboardType="number-pad" value={warningKm} onChangeText={setWarningKm} placeholder="Avisar antes km" placeholderTextColor="#64748B" />
              <TextInput style={styles.halfInput} keyboardType="number-pad" value={warningDays} onChangeText={setWarningDays} placeholder="Avisar antes dias" placeholderTextColor="#64748B" />
            </View>
            <Pressable style={styles.createButton} onPress={handleCreate} disabled={saving || !selectedVehicleId}>
              <Text style={styles.createButtonText}>{saving ? "Salvando..." : "Criar plano"}</Text>
            </Pressable>

            <Text style={styles.section}>Acompanhamento</Text>
          </View>
        }
        ListEmptyComponent={
          selectedVehicleId ? <Text style={styles.emptyText}>Nenhum plano preventivo configurado para este veículo.</Text> : null
        }
        renderItem={({ item }) => (
          <View style={[styles.planCard, item.status === "overdue" && styles.overdueCard, item.status === "soon" && styles.soonCard]}>
            <View style={styles.planHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.planTitle}>{item.plan.category}</Text>
                <Text style={styles.planStatus}>{statusText(item)}</Text>
              </View>
              <Text style={styles.sync}>{item.plan.sync_state === "synced" ? "✓" : "⏳"}</Text>
            </View>
            <Text style={styles.remaining}>{remainingText(item)}</Text>
            {item.currentOdometerKm != null && <Text style={styles.meta}>Odômetro atual conhecido: {item.currentOdometerKm} km</Text>}
            {item.lastEvent && (
              <Text style={styles.meta}>
                Última: {new Date(item.lastEvent.performed_at).toLocaleDateString("pt-BR")}
                {item.lastEvent.odometer_km != null ? ` • ${item.lastEvent.odometer_km} km` : ""}
              </Text>
            )}
            <View style={styles.actions}>
              <Pressable
                style={styles.primaryAction}
                onPress={() => navigation.navigate("Maintenance", { vehicleId: item.plan.vehicle_id, category: item.plan.category })}
              >
                <Text style={styles.primaryActionText}>Registrar manutenção</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => toggle(item)}>
                <Text style={styles.secondaryActionText}>{item.plan.is_active ? "Pausar" : "Ativar"}</Text>
              </Pressable>
              <Pressable style={styles.secondaryAction} onPress={() => remove(item)}>
                <Text style={styles.deleteText}>Excluir</Text>
              </Pressable>
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 24, fontWeight: "800" },
  subtitle: { color: "#94A3B8", marginTop: 4, marginBottom: 16 },
  chips: { gap: 8, paddingBottom: 8 },
  vehicleChip: { backgroundColor: "#1E293B", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
  vehicleChipActive: { backgroundColor: "#38BDF8" },
  vehicleText: { color: "#CBD5E1", fontWeight: "700" },
  vehicleTextActive: { color: "#082F49" },
  section: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 18, marginBottom: 10 },
  categoryWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 10 },
  categoryChip: { backgroundColor: "#1E293B", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 11 },
  categoryChipActive: { backgroundColor: "#F97316" },
  categoryText: { color: "#94A3B8", fontSize: 12, fontWeight: "700" },
  categoryTextActive: { color: "#0F172A" },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 13, borderRadius: 10, marginBottom: 10 },
  formGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  halfInput: { width: "48%", backgroundColor: "#1E293B", color: "#fff", padding: 13, borderRadius: 10 },
  createButton: { backgroundColor: "#38BDF8", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 10 },
  createButtonText: { color: "#0F172A", fontWeight: "800" },
  emptyCard: { backgroundColor: "#422006", borderRadius: 10, padding: 14 },
  emptyText: { color: "#94A3B8", textAlign: "center", marginVertical: 14 },
  planCard: { backgroundColor: "#1E293B", borderRadius: 14, padding: 15, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: "#22C55E" },
  soonCard: { borderLeftColor: "#F59E0B" },
  overdueCard: { borderLeftColor: "#EF4444" },
  planHeader: { flexDirection: "row", alignItems: "center" },
  planTitle: { color: "#fff", fontSize: 16, fontWeight: "800" },
  planStatus: { color: "#CBD5E1", fontSize: 12, fontWeight: "800", marginTop: 2 },
  sync: { color: "#64748B" },
  remaining: { color: "#E2E8F0", marginTop: 10, fontWeight: "600" },
  meta: { color: "#94A3B8", fontSize: 12, marginTop: 5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  primaryAction: { backgroundColor: "#F97316", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  primaryActionText: { color: "#0F172A", fontWeight: "800", fontSize: 12 },
  secondaryAction: { backgroundColor: "#334155", borderRadius: 8, paddingVertical: 9, paddingHorizontal: 12 },
  secondaryActionText: { color: "#E2E8F0", fontWeight: "700", fontSize: 12 },
  deleteText: { color: "#FCA5A5", fontWeight: "700", fontSize: 12 }
});
