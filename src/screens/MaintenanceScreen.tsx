import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Alert, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import {
  addMaintenanceEvent,
  getMaintenanceEvents,
  MAINTENANCE_CATEGORIES,
  NoVehicleError,
  type MaintenanceCategory
} from "@/services/MaintenanceService";
import { getVehicles } from "@/services/VehicleService";
import { formatCentsToBRL, parseBRLInputToCents } from "@/utils/formatters";
import type { MaintenanceEvent, Vehicle } from "@/types";

function parseOdometer(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed.replace(",", "."));
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

function isKnownCategory(value: string | undefined): value is MaintenanceCategory {
  return !!value && (MAINTENANCE_CATEGORIES as readonly string[]).includes(value);
}

export default function MaintenanceScreen({ navigation, route }: any) {
  const { user } = useAuth();
  const requestedVehicleId = route.params?.vehicleId as string | undefined;
  const requestedCategory = route.params?.category as string | undefined;
  const requestedPreventivePlanId = route.params?.preventivePlanId as string | undefined;
  const knownRequestedCategory = isKnownCategory(requestedCategory);

  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(requestedVehicleId ?? null);
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [category, setCategory] = useState<MaintenanceCategory>(
    knownRequestedCategory ? requestedCategory : requestedCategory ? "Outros" : "Troca de óleo"
  );
  const [notes, setNotes] = useState(knownRequestedCategory ? "" : requestedCategory ?? "");
  const [cost, setCost] = useState("");
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const rows = await getVehicles(user.id);
    setVehicles(rows);

    const selected =
      rows.find((v) => v.id === selectedVehicleId) ??
      rows.find((v) => v.id === requestedVehicleId) ??
      rows.find((v) => v.is_default) ??
      rows[0] ??
      null;

    setSelectedVehicleId(selected?.id ?? null);
    setEvents(selected ? await getMaintenanceEvents(user.id, selected.id) : []);
  }, [requestedVehicleId, selectedVehicleId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function selectVehicle(vehicleId: string) {
    if (!user?.id) return;
    setSelectedVehicleId(vehicleId);
    setEvents(await getMaintenanceEvents(user.id, vehicleId));
  }

  async function handleAdd() {
    if (!user?.id || !selectedVehicleId) {
      Alert.alert("Nenhum veículo cadastrado", "Cadastre um veículo antes de lançar manutenção.", [
        { text: "Cadastrar veículo", onPress: () => navigation.navigate("Vehicles") },
        { text: "Cancelar", style: "cancel" }
      ]);
      return;
    }

    const costInCents = parseBRLInputToCents(cost);
    if (costInCents < 0) {
      Alert.alert("Custo inválido");
      return;
    }

    const odometerKm = parseOdometer(odometer);
    if (odometerKm !== undefined && (!Number.isFinite(odometerKm) || odometerKm < 0)) {
      Alert.alert("Odômetro inválido");
      return;
    }

    const description = notes.trim() ? `${category} — ${notes.trim()}` : category;

    setSaving(true);
    try {
      await addMaintenanceEvent({
        userId: user.id,
        vehicleId: selectedVehicleId,
        preventivePlanId: requestedPreventivePlanId,
        description,
        costInCents,
        odometerKm
      });
      setNotes("");
      setCost("");
      setOdometer("");
      await selectVehicle(selectedVehicleId);
    } catch (err) {
      if (err instanceof NoVehicleError) {
        Alert.alert("Nenhum veículo cadastrado", err.message, [
          { text: "Cadastrar veículo", onPress: () => navigation.navigate("Vehicles") },
          { text: "Cancelar", style: "cancel" }
        ]);
      } else {
        Alert.alert("Erro", (err as Error)?.message ?? "Erro desconhecido");
      }
    } finally {
      setSaving(false);
    }
  }

  const selectedVehicle = vehicles.find((v) => v.id === selectedVehicleId) ?? null;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            <View style={styles.topActionRow}>
              <Text style={styles.sectionTitle}>Veículo</Text>
              <Pressable onPress={() => navigation.navigate("PreventiveMaintenance")}>
                <Text style={styles.preventiveLink}>Manutenção preventiva →</Text>
              </Pressable>
            </View>
            {vehicles.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.vehicleRow}>
                {vehicles.map((vehicle) => {
                  const selected = vehicle.id === selectedVehicleId;
                  return (
                    <Pressable
                      key={vehicle.id}
                      style={[styles.vehicleChip, selected && styles.vehicleChipActive]}
                      onPress={() => selectVehicle(vehicle.id)}
                    >
                      <Text style={[styles.vehicleChipText, selected && styles.vehicleChipTextActive]}>
                        {vehicle.name}{vehicle.is_default ? " ★" : ""}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            ) : (
              <Pressable style={styles.warningCard} onPress={() => navigation.navigate("Vehicles")}>
                <Text style={styles.warning}>Nenhum veículo cadastrado. Toque para cadastrar.</Text>
              </Pressable>
            )}

            <Text style={styles.sectionTitle}>Categoria</Text>
            <View style={styles.categoryRow}>
              {MAINTENANCE_CATEGORIES.map((item) => (
                <Pressable
                  key={item}
                  style={[styles.categoryChip, category === item && styles.categoryChipActive]}
                  onPress={() => setCategory(item)}
                >
                  <Text style={[styles.categoryText, category === item && styles.categoryTextActive]}>{item}</Text>
                </Pressable>
              ))}
            </View>

            <View style={styles.form}>
              <TextInput
                style={styles.input}
                placeholder="Observação (opcional)"
                placeholderTextColor="#64748B"
                value={notes}
                onChangeText={setNotes}
              />
              <TextInput
                style={styles.input}
                placeholder="Custo (R$)"
                placeholderTextColor="#64748B"
                keyboardType="decimal-pad"
                value={cost}
                onChangeText={setCost}
              />
              <TextInput
                style={styles.input}
                placeholder="Odômetro (opcional)"
                placeholderTextColor="#64748B"
                keyboardType="number-pad"
                value={odometer}
                onChangeText={setOdometer}
              />
              <Pressable style={styles.addButton} onPress={handleAdd} disabled={saving || !selectedVehicleId}>
                <Text style={styles.addButtonText}>{saving ? "Salvando..." : "Registrar manutenção"}</Text>
              </Pressable>
            </View>

            <View style={styles.historyHeader}>
              <View>
                <Text style={styles.sectionTitle}>Histórico</Text>
                <Text style={styles.historySubtitle}>{selectedVehicle ? selectedVehicle.name : "Selecione um veículo"}</Text>
              </View>
              <Pressable onPress={() => navigation.navigate("Vehicles")}>
                <Text style={styles.manageLink}>Gerenciar veículos</Text>
              </Pressable>
            </View>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma manutenção registrada para este veículo.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.description}>{item.description}</Text>
              <Text style={styles.meta}>
                {new Date(item.performed_at).toLocaleDateString("pt-BR")}
                {item.odometer_km != null ? ` • ${item.odometer_km} km` : ""}
              </Text>
              <Text style={styles.syncState}>{item.sync_state === "synced" ? "✓ Sincronizado" : "⏳ Pendente"}</Text>
            </View>
            <Text style={styles.cost}>{formatCentsToBRL(item.cost)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  listContent: { padding: 20, paddingBottom: 40 },
  topActionRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  preventiveLink: { color: "#38BDF8", fontSize: 12, fontWeight: "800" },
  sectionTitle: { color: "#fff", fontSize: 16, fontWeight: "800", marginTop: 6, marginBottom: 10 },
  vehicleRow: { gap: 8, paddingBottom: 6 },
  vehicleChip: { backgroundColor: "#1E293B", borderRadius: 999, paddingVertical: 9, paddingHorizontal: 14 },
  vehicleChipActive: { backgroundColor: "#38BDF8" },
  vehicleChipText: { color: "#CBD5E1", fontWeight: "700" },
  vehicleChipTextActive: { color: "#082F49" },
  warningCard: { backgroundColor: "#422006", borderRadius: 10, padding: 12 },
  warning: { color: "#FBBF24", fontSize: 13 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  categoryChip: { backgroundColor: "#1E293B", borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  categoryChipActive: { backgroundColor: "#F97316" },
  categoryText: { color: "#94A3B8", fontSize: 12, fontWeight: "700" },
  categoryTextActive: { color: "#0F172A" },
  form: { gap: 10, marginBottom: 18 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 15 },
  addButton: { backgroundColor: "#F97316", padding: 14, borderRadius: 10, alignItems: "center" },
  addButtonText: { color: "#0F172A", fontWeight: "800" },
  historyHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 8 },
  historySubtitle: { color: "#64748B", fontSize: 12, marginTop: -6 },
  manageLink: { color: "#38BDF8", fontSize: 12, fontWeight: "700" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 20 },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#1E293B", borderRadius: 10, padding: 14, marginBottom: 10, gap: 12 },
  description: { color: "#fff", fontWeight: "700" },
  meta: { color: "#94A3B8", fontSize: 12, marginTop: 4 },
  syncState: { color: "#64748B", fontSize: 11, marginTop: 4 },
  cost: { color: "#F97316", fontWeight: "800" }
});
