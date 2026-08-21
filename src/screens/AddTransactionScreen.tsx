import React, { useState } from "react";
import { View, Text, TextInput, Pressable, StyleSheet, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "@/context/AuthContext";
import { addTransaction } from "@/services/TransactionService";
import { getDefaultVehicle } from "@/services/VehicleService";
import { parseBRLInputToCents } from "@/utils/formatters";

const INCOME_CATEGORIES = ["Corrida", "Gorjeta", "Bônus", "Outro"];
const EXPENSE_CATEGORIES = ["Combustível", "Manutenção", "Alimentação", "Pedágio", "Outro"];

export default function AddTransactionScreen({ route, navigation }: any) {
  const type: "income" | "expense" = route.params?.type ?? "income";
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState((type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]);
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  async function handleSave() {
    if (!user?.id) return;
    const amountInCents = parseBRLInputToCents(amount);
    if (amountInCents <= 0) {
      Alert.alert("Informe um valor válido");
      return;
    }

    setSaving(true);
    try {
      const defaultVehicle = await getDefaultVehicle(user.id);
      await addTransaction({
        userId: user.id,
        vehicleId: defaultVehicle?.id ?? null,
        type,
        category,
        amountInCents,
        description: description || undefined
      });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Erro ao salvar", err?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.title}>{type === "income" ? "Nova entrada" : "Nova saída"}</Text>

      <Text style={styles.label}>Valor (R$)</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="0,00"
        placeholderTextColor="#64748B"
        value={amount}
        onChangeText={setAmount}
      />

      <Text style={styles.label}>Categoria</Text>
      <View style={styles.categoryRow}>
        {categories.map((c) => (
          <Pressable
            key={c}
            style={[styles.categoryChip, category === c && styles.categoryChipActive]}
            onPress={() => setCategory(c)}
          >
            <Text style={[styles.categoryText, category === c && styles.categoryTextActive]}>{c}</Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.label}>Descrição (opcional)</Text>
      <TextInput
        style={styles.input}
        placeholder="Ex: corrida shopping → aeroporto"
        placeholderTextColor="#64748B"
        value={description}
        onChangeText={setDescription}
      />

      <Pressable
        style={[styles.saveButton, { backgroundColor: type === "income" ? "#22C55E" : "#EF4444" }]}
        onPress={handleSave}
        disabled={saving}
      >
        <Text style={styles.saveButtonText}>{saving ? "Salvando..." : "Salvar"}</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A", padding: 20 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 20 },
  label: { color: "#94A3B8", fontSize: 13, marginBottom: 6, marginTop: 14 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 16 },
  categoryRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryChip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#1E293B"
  },
  categoryChipActive: { backgroundColor: "#38BDF8" },
  categoryText: { color: "#94A3B8", fontSize: 13 },
  categoryTextActive: { color: "#0F172A", fontWeight: "700" },
  saveButton: { marginTop: 32, padding: 16, borderRadius: 10, alignItems: "center" },
  saveButtonText: { color: "#0F172A", fontWeight: "700", fontSize: 16 }
});
