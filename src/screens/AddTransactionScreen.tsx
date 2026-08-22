import React, { useCallback, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { addTransaction, getTransactionById, updateTransaction } from "@/services/TransactionService";
import { getActiveWorkSession } from "@/services/WorkSessionService";
import { getVehicles } from "@/services/VehicleService";
import { centsToBRLInput, formatBRLDigitsInput, parseBRLInputToCents } from "@/utils/formatters";
import type { Vehicle } from "@/types";

const INCOME_CATEGORIES = ["Corrida", "Gorjeta", "Bônus", "Promoções", "Outros"];
const EXPENSE_CATEGORIES = [
  "Combustível",
  "Pedágio",
  "Estacionamento",
  "Lavagem",
  "Manutenção",
  "Alimentação",
  "Multa",
  "Seguro",
  "Financiamento/locação",
  "Outros"
];

export default function AddTransactionScreen({ route, navigation }: any) {
  const type: "income" | "expense" = route.params?.type ?? "income";
  const transactionId: string | undefined = route.params?.transactionId;
  const isEditing = Boolean(transactionId);
  const { user } = useAuth();
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState((type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadedEdit, setLoadedEdit] = useState(false);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const load = useCallback(async () => {
    if (!user?.id) return;

    const [availableVehicles, activeSession, existing] = await Promise.all([
      getVehicles(user.id),
      getActiveWorkSession(user.id),
      transactionId ? getTransactionById(user.id, transactionId) : Promise.resolve(null)
    ]);
    setVehicles(availableVehicles);

    if (transactionId && existing && !loadedEdit) {
      setAmount(centsToBRLInput(existing.amount));
      setDescription(existing.description ?? "");
      setSelectedVehicleId(existing.vehicle_id);
      if (categories.includes(existing.category)) {
        setCategory(existing.category);
        setCustomCategory("");
      } else {
        setCategory("Outros");
        setCustomCategory(existing.category);
      }
      setLoadedEdit(true);
      return;
    }

    if (!transactionId) {
      setSelectedVehicleId((current) => {
        if (current && availableVehicles.some((vehicle) => vehicle.id === current)) return current;
        if (activeSession?.vehicle_id && availableVehicles.some((vehicle) => vehicle.id === activeSession.vehicle_id)) {
          return activeSession.vehicle_id;
        }
        return availableVehicles.find((vehicle) => vehicle.is_default)?.id ?? availableVehicles[0]?.id ?? null;
      });
    }
  }, [categories, loadedEdit, transactionId, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function handleSave() {
    if (!user?.id) return;
    const amountInCents = parseBRLInputToCents(amount);
    if (amountInCents <= 0) {
      Alert.alert("Informe um valor válido");
      return;
    }

    const finalCategory = category === "Outros" ? customCategory.trim() || "Outros" : category;

    setSaving(true);
    try {
      if (transactionId) {
        await updateTransaction({
          userId: user.id,
          id: transactionId,
          vehicleId: selectedVehicleId,
          category: finalCategory,
          amountInCents,
          description: description.trim() || undefined
        });
      } else {
        await addTransaction({
          userId: user.id,
          vehicleId: selectedVehicleId,
          type,
          category: finalCategory,
          amountInCents,
          description: description.trim() || undefined
        });
      }
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Erro ao salvar", err?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>
          {isEditing ? "Editar lançamento" : type === "income" ? "Nova receita" : "Nova despesa"}
        </Text>

        <Text style={styles.label}>Valor (R$)</Text>
        <TextInput
          style={[styles.input, styles.amountInput]}
          keyboardType="number-pad"
          placeholder="0,00"
          placeholderTextColor="#64748B"
          value={amount}
          onChangeText={(text) => setAmount(formatBRLDigitsInput(text))}
          selectTextOnFocus
        />
        <Text style={styles.helper}>Digite apenas os números. Ex.: 1111 vira 11,11.</Text>

        <Text style={styles.label}>Categoria</Text>
        <View style={styles.chipRow}>
          {categories.map((item) => (
            <Pressable
              key={item}
              style={[styles.chip, category === item && styles.chipActive]}
              onPress={() => setCategory(item)}
            >
              <Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text>
            </Pressable>
          ))}
        </View>

        {category === "Outros" ? (
          <TextInput
            style={[styles.input, styles.extraInput]}
            placeholder="Nome da categoria"
            placeholderTextColor="#64748B"
            value={customCategory}
            onChangeText={setCustomCategory}
          />
        ) : null}

        <Text style={styles.label}>Veículo</Text>
        <Text style={styles.helper}>Durante um turno, o veículo do turno é selecionado automaticamente.</Text>
        <View style={styles.chipRow}>
          <Pressable
            style={[styles.chip, selectedVehicleId === null && styles.chipActive]}
            onPress={() => setSelectedVehicleId(null)}
          >
            <Text style={[styles.chipText, selectedVehicleId === null && styles.chipTextActive]}>Geral</Text>
          </Pressable>
          {vehicles.map((vehicle) => (
            <Pressable
              key={vehicle.id}
              style={[styles.chip, selectedVehicleId === vehicle.id && styles.chipActive]}
              onPress={() => setSelectedVehicleId(vehicle.id)}
            >
              <Text style={[styles.chipText, selectedVehicleId === vehicle.id && styles.chipTextActive]}>
                {vehicle.name}{vehicle.is_default ? " ★" : ""}
              </Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.label}>Descrição (opcional)</Text>
        <TextInput
          style={styles.input}
          placeholder={type === "income" ? "Ex: shopping → aeroporto" : "Ex: abastecimento posto central"}
          placeholderTextColor="#64748B"
          value={description}
          onChangeText={setDescription}
        />

        <Pressable
          style={[styles.saveButton, { backgroundColor: type === "income" ? "#22C55E" : "#EF4444" }]}
          onPress={handleSave}
          disabled={saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? "Salvando..." : isEditing ? "Salvar alterações" : "Salvar lançamento"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 8 },
  label: { color: "#94A3B8", fontSize: 13, marginBottom: 6, marginTop: 16 },
  helper: { color: "#64748B", fontSize: 11, marginTop: 6, marginBottom: 8 },
  input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 16 },
  amountInput: { fontSize: 24, fontWeight: "700", textAlign: "right" },
  extraInput: { marginTop: 10 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: "#1E293B"
  },
  chipActive: { backgroundColor: "#38BDF8" },
  chipText: { color: "#94A3B8", fontSize: 13 },
  chipTextActive: { color: "#0F172A", fontWeight: "700" },
  saveButton: { marginTop: 32, padding: 16, borderRadius: 10, alignItems: "center" },
  saveButtonText: { color: "#0F172A", fontWeight: "700", fontSize: 16 }
});
