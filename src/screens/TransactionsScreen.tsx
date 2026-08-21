import React, { useCallback, useState } from "react";
import { View, Text, FlatList, StyleSheet, Pressable, Alert, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getAllTransactions, deleteTransaction } from "@/services/TransactionService";
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

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <FlatList
        contentContainerStyle={{ padding: 20 }}
        data={transactions}
        keyExtractor={(item) => item.id}
        onEndReached={loadMore}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={<Text style={styles.empty}>Nenhuma transação ainda.</Text>}
        ListFooterComponent={loadingMore ? <ActivityIndicator color="#38BDF8" style={{ marginTop: 12 }} /> : null}
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
