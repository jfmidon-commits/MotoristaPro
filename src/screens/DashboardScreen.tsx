import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getAllTransactions } from "@/services/TransactionService";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import { formatCentsToBRL } from "@/utils/formatters";
import type { Transaction } from "@/types";

export default function DashboardScreen({ navigation }: any) {
  const { user, signOut } = useAuth();
  const { status, syncNow } = useTransactionSync();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const rows = await getAllTransactions(user.id);
    setTransactions(rows);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  async function onRefresh() {
    setRefreshing(true);
    await syncNow();
    await load();
    setRefreshing(false);
  }

  const income = transactions
    .filter((t) => t.type === "income")
    .reduce((sum, t) => sum + t.amount, 0);
  const expense = transactions
    .filter((t) => t.type === "expense")
    .reduce((sum, t) => sum + t.amount, 0);
  const balance = income - expense;
  const totalPending =
    status.pendingTransactions +
    status.pendingVehicles +
    status.pendingMaintenance +
    status.pendingWorkSessions +
    status.pendingDeletes;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 20 }}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Olá, {user?.email}</Text>
          <Pressable onPress={signOut}>
            <Text style={styles.logout}>Sair</Text>
          </Pressable>
        </View>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Saldo</Text>
          <Text style={styles.balanceValue}>{formatCentsToBRL(balance)}</Text>
          <View style={styles.row}>
            <Text style={styles.income}>+ {formatCentsToBRL(income)}</Text>
            <Text style={styles.expenseText}>- {formatCentsToBRL(expense)}</Text>
          </View>
        </View>

        <Pressable style={styles.workButton} onPress={() => navigation.navigate("WorkSession")}>
          <Text style={styles.workButtonTitle}>Turno de trabalho</Text>
          <Text style={styles.workButtonText}>Iniciar, acompanhar ou encerrar turno →</Text>
        </Pressable>

        <Pressable style={styles.syncStatus} onPress={() => navigation.navigate("SyncStatus")}>
          <Text style={styles.syncStatusText}>
            {totalPending > 0
              ? `${totalPending} item(ns) aguardando sincronização`
              : "Tudo sincronizado com o Supabase"}
          </Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            style={[styles.actionButton, { backgroundColor: "#22C55E" }]}
            onPress={() => navigation.navigate("AddTransaction", { type: "income" })}
          >
            <Text style={styles.actionButtonText}>+ Entrada</Text>
          </Pressable>
          <Pressable
            style={[styles.actionButton, { backgroundColor: "#EF4444" }]}
            onPress={() => navigation.navigate("AddTransaction", { type: "expense" })}
          >
            <Text style={styles.actionButtonText}>- Saída</Text>
          </Pressable>
        </View>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Transactions")}>
          <Text style={styles.linkText}>Ver todas as transações →</Text>
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Vehicles")}>
          <Text style={styles.linkText}>Veículos →</Text>
        </Pressable>
        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Maintenance")}>
          <Text style={styles.linkText}>Manutenção →</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 20 },
  title: { color: "#fff", fontSize: 18, fontWeight: "600" },
  logout: { color: "#F87171" },
  balanceCard: { backgroundColor: "#1E293B", borderRadius: 16, padding: 20, marginBottom: 16 },
  balanceLabel: { color: "#94A3B8", fontSize: 14 },
  balanceValue: { color: "#fff", fontSize: 32, fontWeight: "700", marginVertical: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  income: { color: "#22C55E", fontWeight: "600" },
  expenseText: { color: "#EF4444", fontWeight: "600" },
  workButton: { backgroundColor: "#0EA5E9", borderRadius: 14, padding: 16, marginBottom: 12 },
  workButtonTitle: { color: "#082F49", fontSize: 16, fontWeight: "800" },
  workButtonText: { color: "#082F49", marginTop: 2, fontSize: 13 },
  syncStatus: { backgroundColor: "#1E293B", borderRadius: 10, padding: 12, marginBottom: 16 },
  syncStatusText: { color: "#FBBF24", fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionButton: { flex: 1, padding: 16, borderRadius: 10, alignItems: "center" },
  actionButtonText: { color: "#0F172A", fontWeight: "700" },
  linkRow: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  linkText: { color: "#38BDF8", fontSize: 15 }
});
