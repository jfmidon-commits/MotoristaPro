import React, { useCallback, useRef, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { addTransaction } from "@/services/TransactionService";
import { getActiveWorkSession } from "@/services/WorkSessionService";
import { getVehicles } from "@/services/VehicleService";
import { parseBRLInputToCents } from "@/utils/formatters";
import type { Vehicle } from "@/types";

const INCOME_CATEGORIES = ["Corrida", "Gorjeta", "Bônus", "Promoções", "Outros"];
const EXPENSE_CATEGORIES = ["Combustível", "Pedágio", "Estacionamento", "Lavagem", "Manutenção", "Alimentação", "Multa", "Seguro", "Financiamento/locação", "Outros"];
const INCOME_QUICK_AMOUNTS = [10, 20, 30, 50];
const EXPENSE_QUICK_AMOUNTS = [10, 20, 50, 100];

function formatCurrencyDigits(raw: string): string {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (!digits) return "";
  const cents = Number(digits);
  const reais = Math.floor(cents / 100).toLocaleString("pt-BR");
  return `${reais},${String(cents % 100).padStart(2, "0")}`;
}

export default function AddTransactionScreen({ route, navigation }: any) {
  const type: "income" | "expense" = route.params?.type ?? "income";
  const { user } = useAuth();
  const amountRef = useRef<TextInput>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState((type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES)[0]);
  const [customCategory, setCustomCategory] = useState("");
  const [description, setDescription] = useState("");
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null);
  const [activeShiftVehicleId, setActiveShiftVehicleId] = useState<string | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [saving, setSaving] = useState(false);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  const quickAmounts = type === "income" ? INCOME_QUICK_AMOUNTS : EXPENSE_QUICK_AMOUNTS;
  const fastRideMode = type === "income" && !!activeShiftVehicleId && !showDetails && category === "Corrida";
  const compactExpenseMode = type === "expense" && !!activeShiftVehicleId && !showDetails;
  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === selectedVehicleId) ?? null;

  const loadVehicles = useCallback(async () => {
    if (!user?.id) return;
    const [availableVehicles, activeSession] = await Promise.all([getVehicles(user.id), getActiveWorkSession(user.id)]);
    setVehicles(availableVehicles);
    setActiveShiftVehicleId(activeSession?.vehicle_id ?? null);
    setSelectedVehicleId((current) => {
      if (current && availableVehicles.some((vehicle) => vehicle.id === current)) return current;
      if (activeSession?.vehicle_id && availableVehicles.some((vehicle) => vehicle.id === activeSession.vehicle_id)) return activeSession.vehicle_id;
      return availableVehicles.find((vehicle) => vehicle.is_default)?.id ?? availableVehicles[0]?.id ?? null;
    });
  }, [user?.id]);

  useFocusEffect(useCallback(() => {
    loadVehicles();
    const timer = setTimeout(() => amountRef.current?.focus(), 150);
    return () => clearTimeout(timer);
  }, [loadVehicles]));

  function applyQuickAmount(value: number) {
    setAmount(`${value},00`);
    amountRef.current?.focus();
  }

  async function handleSave() {
    if (!user?.id || saving) return;
    const amountInCents = parseBRLInputToCents(amount);
    if (amountInCents <= 0) {
      Alert.alert("Informe um valor válido");
      amountRef.current?.focus();
      return;
    }
    const finalCategory = category === "Outros" ? customCategory.trim() || "Outros" : category;
    setSaving(true);
    try {
      await addTransaction({ userId: user.id, vehicleId: selectedVehicleId, type, category: finalCategory, amountInCents, description: description.trim() || undefined });
      navigation.goBack();
    } catch (err: any) {
      Alert.alert("Erro ao salvar", err?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  function renderCategorySelector() {
    return <>
      <Text style={styles.label}>Categoria</Text>
      <View style={styles.chipRow}>{categories.map((item) => <Pressable key={item} style={[styles.chip, category === item && styles.chipActive]} onPress={() => setCategory(item)}><Text style={[styles.chipText, category === item && styles.chipTextActive]}>{item}</Text></Pressable>)}</View>
      {category === "Outros" ? <TextInput style={[styles.input, styles.extraInput]} placeholder="Nome da categoria" placeholderTextColor="#64748B" value={customCategory} onChangeText={setCustomCategory} /> : null}
    </>;
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{fastRideMode ? "Registrar corrida" : compactExpenseMode ? "Registrar despesa" : type === "income" ? "Nova receita" : "Nova despesa"}</Text>
        <Text style={styles.helperTop}>{fastRideMode ? `Corrida vinculada ao turno${selectedVehicle ? ` • ${selectedVehicle.name}` : ""}.` : compactExpenseMode ? `Despesa vinculada ao turno${selectedVehicle ? ` • ${selectedVehicle.name}` : ""}. Escolha a categoria e salve.` : "Registre o valor primeiro. Os campos principais já vêm pré-selecionados."}</Text>

        <Text style={styles.label}>Valor (R$)</Text>
        <TextInput ref={amountRef} style={[styles.input, styles.amountInput]} keyboardType="number-pad" returnKeyType="done" placeholder="0,00" placeholderTextColor="#64748B" value={amount} onChangeText={(value) => setAmount(formatCurrencyDigits(value))} onSubmitEditing={handleSave} selectTextOnFocus />
        <Text style={styles.amountHint}>Digite somente os números: 1111 vira R$ 11,11.</Text>

        <View style={styles.quickAmountRow}>{quickAmounts.map((value) => <Pressable key={value} style={styles.quickAmountChip} onPress={() => applyQuickAmount(value)}><Text style={styles.quickAmountText}>R$ {value}</Text></Pressable>)}</View>

        {fastRideMode ? <>
          <Pressable style={[styles.saveButton, styles.incomeSave, saving && styles.disabledButton]} onPress={handleSave} disabled={saving}><Text style={styles.saveButtonText}>{saving ? "Salvando..." : "Salvar corrida"}</Text></Pressable>
          <Pressable style={styles.detailsButton} onPress={() => setShowDetails(true)}><Text style={styles.detailsButtonText}>Mais opções: categoria, veículo e descrição</Text></Pressable>
        </> : compactExpenseMode ? <>
          {renderCategorySelector()}
          <Pressable style={[styles.saveButton, styles.expenseSave, saving && styles.disabledButton]} onPress={handleSave} disabled={saving}><Text style={styles.saveButtonText}>{saving ? "Salvando..." : `Salvar ${category.toLowerCase()}`}</Text></Pressable>
          <Pressable style={styles.detailsButton} onPress={() => setShowDetails(true)}><Text style={styles.detailsButtonText}>Mais opções: veículo e descrição</Text></Pressable>
        </> : <>
          {renderCategorySelector()}
          <Text style={styles.label}>Veículo</Text>
          <Text style={styles.helper}>{activeShiftVehicleId ? "O veículo do turno já está selecionado." : "Escolha onde este lançamento deve ser contabilizado."}</Text>
          <View style={styles.chipRow}>
            <Pressable style={[styles.chip, selectedVehicleId === null && styles.chipActive]} onPress={() => setSelectedVehicleId(null)}><Text style={[styles.chipText, selectedVehicleId === null && styles.chipTextActive]}>Geral</Text></Pressable>
            {vehicles.map((vehicle) => <Pressable key={vehicle.id} style={[styles.chip, selectedVehicleId === vehicle.id && styles.chipActive]} onPress={() => setSelectedVehicleId(vehicle.id)}><Text style={[styles.chipText, selectedVehicleId === vehicle.id && styles.chipTextActive]}>{vehicle.name}{vehicle.is_default ? " ★" : ""}</Text></Pressable>)}
          </View>
          <Text style={styles.label}>Descrição (opcional)</Text>
          <TextInput style={styles.input} placeholder={type === "income" ? "Ex: shopping → aeroporto" : "Ex: abastecimento posto central"} placeholderTextColor="#64748B" value={description} onChangeText={setDescription} returnKeyType="done" onSubmitEditing={handleSave} />
          <Pressable style={[styles.saveButton, type === "income" ? styles.incomeSave : styles.expenseSave, saving && styles.disabledButton]} onPress={handleSave} disabled={saving}><Text style={styles.saveButtonText}>{saving ? "Salvando..." : type === "income" ? "Salvar receita" : "Salvar despesa"}</Text></Pressable>
          {activeShiftVehicleId ? <Pressable style={styles.detailsButton} onPress={() => { setDescription(""); setSelectedVehicleId(activeShiftVehicleId); if (type === "income") setCategory("Corrida"); setShowDetails(false); }}><Text style={styles.detailsButtonText}>{type === "income" ? "Voltar ao modo rápido de corrida" : "Voltar ao modo rápido de despesa"}</Text></Pressable> : null}
        </>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" }, content: { padding: 20, paddingBottom: 40 }, title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 4 }, helperTop: { color: "#64748B", fontSize: 12, lineHeight: 18, marginBottom: 4 }, label: { color: "#94A3B8", fontSize: 13, marginBottom: 6, marginTop: 16 }, helper: { color: "#64748B", fontSize: 11, marginTop: -2, marginBottom: 8 }, input: { backgroundColor: "#1E293B", color: "#fff", padding: 14, borderRadius: 10, fontSize: 16 }, amountInput: { fontSize: 30, fontWeight: "800", paddingVertical: 16 }, amountHint: { color: "#64748B", fontSize: 11, marginTop: 6 }, extraInput: { marginTop: 10 }, quickAmountRow: { flexDirection: "row", gap: 8, marginTop: 10 }, quickAmountChip: { flex: 1, backgroundColor: "#172554", borderRadius: 10, paddingVertical: 11, alignItems: "center" }, quickAmountText: { color: "#38BDF8", fontWeight: "800", fontSize: 13 }, chipRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 }, chip: { paddingVertical: 9, paddingHorizontal: 14, borderRadius: 20, backgroundColor: "#1E293B" }, chipActive: { backgroundColor: "#38BDF8" }, chipText: { color: "#94A3B8", fontSize: 13 }, chipTextActive: { color: "#0F172A", fontWeight: "700" }, saveButton: { marginTop: 22, padding: 18, borderRadius: 12, alignItems: "center" }, incomeSave: { backgroundColor: "#22C55E" }, expenseSave: { backgroundColor: "#EF4444" }, disabledButton: { opacity: 0.6 }, saveButtonText: { color: "#0F172A", fontWeight: "800", fontSize: 17 }, detailsButton: { paddingVertical: 14, alignItems: "center" }, detailsButtonText: { color: "#38BDF8", fontSize: 12, fontWeight: "700" }
});