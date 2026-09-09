import React, { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { cleanupDuplicateRideTransactions, getAllTransactions, deleteTransaction } from "@/services/TransactionService";
import { formatCentsToBRL } from "@/utils/formatters";
import type { Transaction } from "@/types";

const PAGE_SIZE = 30;

const SYNC_LABEL: Record<Transaction["sync_state"], string> = {
  synced: "✓ Sincronizado",
  pending: "⏳ Pendente",
  error: "⚠ Erro"
};

export default function TransactionsScreen() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cleaningDuplicates, setCleaningDuplicates] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  const loadFirstPage = useCallback(async () => {
    if (!user?.id) return;
    const rows = await getAllTransactions(user.id, { limit: PAGE_SIZE, offset: 0 });
    setTransactions(rows);
    setHasMore(rows.length === PAGE_SIZE);
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadFirstPage();
    }, [loadFirstPage])
  );

  async function loadMore() {
    if (!user?.id || loadingMore || !hasMore) return;
    setLoadingMore(true);
    const rows = await getAllTransactions(user.id, { limit: PAGE_SIZE, offset: transactions.length });
    setTransactions((prev) => [...prev, ...rows]);
    setHasMore(rows.length === PAGE_SIZE);
    setLoadingMore(false);
  }

  function confirmDelete(item: Transaction) {
    if (!user?.id) return;
    const userId = user.id;

    Alert.alert(
      "Excluir transação",
      `Excluir "${item.category}" de ${formatCentsToBRL(item.amount)}?`,
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Excluir",
          style: "destructive",
          onPress: async () => {
            await deleteTransaction(userId, item.id);
            setTransactions((prev) => prev.filter((t) => t.id !== item.id));
          }
        }
      ]
    );
  }

  function confirmCleanupDuplicates() {
    if (!user?.id || cleaningDuplicates) return;
    const userId = user.id;

    Alert.alert(
      "Limpar duplicados",
      "Vou procurar apenas lançamentos de corridas capturadas automaticamente que representam a mesma oferta. O lançamento mais antigo de cada grupo será mantido; lançamentos manuais não serão alterados.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Limpar",
          style: "destructive",
          onPress: async () => {
            setCleaningDuplicates(true);
            try {
              const removed = await cleanupDuplicateRideTransactions(userId);
              await loadFirstPage();
              Alert.alert(
                "Limpeza concluída",
                removed === 0
                  ? "Nenhum lançamento duplicado foi encontrado."
                  : `${removed} lançamento(s) duplicado(s) foram removido(s).`
              );
            } catch (error: any) {
              Alert.alert("Não foi possível limpar", error?.message ?? "Tente novamente.");
            } finally {
              setCleaningDuplicates(false);
            }
          }
        }
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        contentContainerStyle={{ padding: 20, paddingBottom: 24 }}
        data={transactions}
        keyExtractor={(item) => item.id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListHeaderComponent={
          <View style={styles.actions}>
            <Pressable
              style={[styles.cleanupButton, cleaningDuplicates && styles.cleanupButtonDisabled]}
              onPress={confirmCleanupDuplicates}
              disabled={cleaningDuplicates}
            >
              {cleaningDuplicates ? (
                <ActivityIndicator />
              ) : (
                <Text style={styles.cleanupText}>🧹 Limpar lançamentos duplicados</Text>
              )}
            </Pressable>
            <Text style={styles.cleanupHint}>
              Remove somente duplicações identificadas nas corridas automáticas.
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma transação ainda.</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator style={{ marginTop: 12 }} /> : null}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onLongPress={() => confirmDelete(item)} delayLongPress={350}>
            <View style={{ flex: 1 }}>
              <Text style={styles.category}>{item.category}</Text>
              {item.description ? <Text style={styles.description}>{item.description}</Text> : null}
              <Text style={styles.syncState}>{SYNC_LABEL[item.sync_state]}</Text>
            </View>
            <Text style={[styles.amount, { color: item.type === "income" ? "#22C55E" : "#EF4444" }]}>
              {item.type === "income" ? "+" : "-"} {formatCentsToBRL(item.amount)}
            </Text>
          </Pressable>
        )}
      />
      {transactions.length > 0 && <Text style={styles.hint}>Segure uma transação para excluir</Text>}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  empty: { color: "#64748B", textAlign: "center", marginTop: 40 },
  hint: { color: "#475569", textAlign: "center", fontSize: 12, paddingBottom: 12 },
  actions: { marginBottom: 16 },
  cleanupButton: {
    backgroundColor: "#334155",
    borderRadius: 10,
    padding: 13,
    alignItems: "center"
  },
  cleanupButtonDisabled: { opacity: 0.6 },
  cleanupText: { color: "#F8FAFC", fontWeight: "700", fontSize: 14 },
  cleanupHint: { color: "#64748B", fontSize: 11, textAlign: "center", marginTop: 6 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 14,
    marginBottom: 10
  },
  category: { color: "#fff", fontWeight: "600", fontSize: 15 },
  description: { color: "#94A3B8", fontSize: 13, marginTop: 2 },
  syncState: { color: "#64748B", fontSize: 11, marginTop: 4 },
  amount: { fontWeight: "700", fontSize: 15 }
});
