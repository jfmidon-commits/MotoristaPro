import React, { useCallback, useState } from "react";
import { View, Text, FlatList, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { createVehicle, getVehicles } from "@/services/VehicleService";
import type { Vehicle } from "@/types";

export default function VehiclesScreen() {
  const { user } = useAuth();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [name, setName] = useState("");
  const [plate, setPlate] = useState("");
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

  async function handleAdd() {
    if (!user?.id || !name.trim()) {
      Alert.alert("Informe o nome/modelo do veículo");
      return;
    }
    setSaving(true);
    try {
      await createVehicle({
        userId: user.id,
        name: name.trim(),
        plate: plate.trim() || undefined,
        isDefault: vehicles.length === 0
      });
      setName("");
      setPlate("");
      await load();
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <View style={styles.form}>
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
        <Pressable style={styles.addButton} onPress={handleAdd} disabled={saving}>
          <Text style={styles.addButtonText}>{saving ? "Salvando..." : "Adicionar veículo"}</Text>
        </Pressable>
      </View>

      <FlatList
        contentContainerStyle={{ padding: 20 }}
        data={vehicles}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhum veículo cadastrado.</Text>}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View>
              <Text style={styles.name}>
                {item.name} {item.is_default ? "★" : ""}
              </Text>
              {item.plate ? <Text style={styles.plate}>{item.plate}</Text> : null}
            </View>
            <Text style={styles.syncState}>{item.sync_state === "synced" ? "✓" : "⏳"}</Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  form: { padding: 20, gap: 10 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 15 },
  addButton: { backgroundColor: "#38BDF8", padding: 14, borderRadius: 10, alignItems: "center" },
  addButtonText: { color: "#0F172A", fontWeight: "700" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 20 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10
  },
  name: { color: "#fff", fontWeight: "600" },
  plate: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  syncState: { color: "#64748B" }
});
