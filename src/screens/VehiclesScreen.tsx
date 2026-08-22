import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import {
  createVehicle,
  getVehicles,
  setDefaultVehicle,
  updateVehicle
} from "@/services/VehicleService";
import type { Vehicle } from "@/types";

export default function VehiclesScreen() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    setVehicles(await getVehicles(user.id));
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  function resetForm() {
    setName("");
    setPlate("");
    setEditingId(null);
  }

  function startEditing(vehicle: Vehicle) {
    setEditingId(vehicle.id);
    setName(vehicle.name);
    setPlate(vehicle.plate ?? "");
  }

  async function handleSave() {
    if (!user?.id || !name.trim()) {
      Alert.alert("Informe o nome/modelo do veículo");
      return;
    }

    setSaving(true);
    try {
      if (editingId) {
        await updateVehicle({
          userId: user.id,
          vehicleId: editingId,
          name,
          plate
        });
      } else {
        await createVehicle({
          userId: user.id,
          name: name.trim(),
          plate: plate.trim() || undefined,
          isDefault: vehicles.length === 0
        });
      }
      resetForm();
      await load();
    } catch (err) {
      Alert.alert("Não foi possível salvar o veículo", (err as Error)?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  async function handleSetDefault(vehicle: Vehicle) {
    if (!user?.id || vehicle.is_default) return;
    try {
      await setDefaultVehicle(user.id, vehicle.id);
      await load();
    } catch (err) {
      Alert.alert("Não foi possível definir o veículo padrão", (err as Error)?.message ?? "Erro desconhecido");
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.form}>
        <Text style={styles.formTitle}>{editingId ? "Editar veículo" : "Novo veículo"}</Text>
        <TextInput
          style={styles.input}
          placeholder="Modelo (ex: Onix 2021)"
          placeholderTextColor="#64748B"
          value={name}
          onChangeText={setName}
        />
        <TextInput
          style={styles.input}
          placeholder="Placa (opcional)"
          placeholderTextColor="#64748B"
          value={plate}
          onChangeText={setPlate}
          autoCapitalize="characters"
        />
        <View style={styles.formActions}>
          {editingId ? (
            <Pressable style={styles.cancelButton} onPress={resetForm} disabled={saving}>
              <Text style={styles.cancelButtonText}>Cancelar</Text>
            </Pressable>
          ) : null}
          <Pressable style={styles.addButton} onPress={handleSave} disabled={saving}>
            <Text style={styles.addButtonText}>
              {saving ? "Salvando..." : editingId ? "Salvar alterações" : "Adicionar veículo"}
            </Text>
          </Pressable>
        </View>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 20 }}
        data={vehicles}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhum veículo cadastrado.</Text>}
        renderItem={({ item }) => (
          <View style={[styles.row, item.is_default && styles.defaultRow]}>
            <View style={styles.vehicleInfo}>
              <Text style={styles.name}>
                {item.name} {item.is_default ? "★" : ""}
              </Text>
              {item.plate ? <Text style={styles.plate}>{item.plate}</Text> : null}
              <Text style={styles.syncState}>
                {item.sync_state === "synced" ? "✓ Sincronizado" : item.sync_state === "error" ? "⚠ Erro de sync" : "⏳ Pendente"}
              </Text>
            </View>
            <View style={styles.rowActions}>
              {!item.is_default ? (
                <Pressable style={styles.smallButton} onPress={() => handleSetDefault(item)}>
                  <Text style={styles.smallButtonText}>Tornar padrão</Text>
                </Pressable>
              ) : (
                <Text style={styles.defaultBadge}>Padrão</Text>
              )}
              <Pressable style={styles.editButton} onPress={() => startEditing(item)}>
                <Text style={styles.editButtonText}>Editar</Text>
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
  form: { padding: 20, gap: 10 },
  formTitle: { color: "#fff", fontSize: 18, fontWeight: "800", marginBottom: 2 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 15 },
  formActions: { flexDirection: "row", gap: 10 },
  addButton: { flex: 1, backgroundColor: "#38BDF8", padding: 14, borderRadius: 10, alignItems: "center" },
  addButtonText: { color: "#0F172A", fontWeight: "700" },
  cancelButton: { borderWidth: 1, borderColor: "#64748B", padding: 14, borderRadius: 10, alignItems: "center" },
  cancelButtonText: { color: "#CBD5E1", fontWeight: "700" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    gap: 12
  },
  defaultRow: { borderWidth: 1, borderColor: "#38BDF8" },
  vehicleInfo: { flex: 1 },
  name: { color: "#fff", fontWeight: "700" },
  plate: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  syncState: { color: "#64748B", fontSize: 11, marginTop: 5 },
  rowActions: { alignItems: "flex-end", gap: 8 },
  smallButton: { backgroundColor: "#0EA5E9", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  smallButtonText: { color: "#082F49", fontWeight: "800", fontSize: 11 },
  defaultBadge: { color: "#38BDF8", fontSize: 11, fontWeight: "800" },
  editButton: { borderWidth: 1, borderColor: "#475569", borderRadius: 8, paddingVertical: 7, paddingHorizontal: 10 },
  editButtonText: { color: "#CBD5E1", fontWeight: "700", fontSize: 11 }
});
