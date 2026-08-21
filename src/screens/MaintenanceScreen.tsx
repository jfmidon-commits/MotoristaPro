import React, { useCallback, useState } from "react";
import { View, Text, TextInput, Pressable, FlatList, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { addMaintenanceEvent, getMaintenanceEvents, NoVehicleError } from "@/services/MaintenanceService";
import { getDefaultVehicle } from "@/services/VehicleService";
import { formatCentsToBRL, parseBRLInputToCents } from "@/utils/formatters";
import type { MaintenanceEvent, Vehicle } from "@/types";

export default function MaintenanceScreen({ navigation }: any) {
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [events, setEvents] = useState<MaintenanceEvent[]>([]);
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const v = await getDefaultVehicle(user.id);
    setVehicle(v);
    if (v) setEvents(await getMaintenanceEvents(v.id));
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleAdd() {
    if (!user?.id || !description.trim()) {
      Alert.alert("Descreva o serviço de manutenção");
      return;
    }
    setSaving(true);
    try {
      await addMaintenanceEvent({
        userId: user.id,
        description: description.trim(),
        costInCents: parseBRLInputToCents(cost)
      });
      setDescription("");
      setCost("");
      await load();
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      {vehicle ? (
        <Text style={styles.vehicleLabel}>Veículo: {vehicle.name}</Text>
      ) : (
        <Text style={styles.warning}>
          Nenhum veículo cadastrado ainda. Cadastre um veículo antes de lançar manutenção.
        </Text>
      )}

      <View style={styles.form}>
        <TextInput
          style={styles.input}
          placeholder="Descrição (ex: troca de óleo)"
          placeholderTextColor="#64748B"
          value={description}
          onChangeText={setDescription}
        />
        <TextInput
          style={styles.input}
          placeholder="Custo (R$)"
          placeholderTextColor="#64748B"
          keyboardType="decimal-pad"
          value={cost}
          onChangeText={setCost}
        />
        <Pressable style={styles.addButton} onPress={handleAdd} disabled={saving}>
          <Text style={styles.addButtonText}>{saving ? "Salvando..." : "Registrar manutenção"}</Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 20 }}
        data={events}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma manutenção registrada.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.description}>{item.description}</Text>
            <Text style={styles.cost}>{formatCentsToBRL(item.cost)}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  vehicleLabel: { color: "#94A3B8", paddingHorizontal: 20, paddingTop: 12 },
  warning: { color: "#FBBF24", paddingHorizontal: 20, paddingTop: 12, fontSize: 13 },
  form: { padding: 20, gap: 10 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 15 },
  addButton: { backgroundColor: "#F97316", padding: 14, borderRadius: 10, alignItems: "center" },
  addButtonText: { color: "#0F172A", fontWeight: "700" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10
  },
  description: { color: "#fff" },
  cost: { color: "#F97316", fontWeight: "700" }
});
