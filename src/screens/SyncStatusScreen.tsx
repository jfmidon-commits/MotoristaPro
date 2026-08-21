import React from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTransactionSync } from "@/hooks/useTransactionSync";

export default function SyncStatusScreen() {
  const { status, syncNow } = useTransactionSync();
  const [syncing, setSyncing] = React.useState(false);

  async function handleSync() {
    setSyncing(true);
    await syncNow();
    setSyncing(false);
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <Text style={styles.title}>Status de Sincronização</Text>

      <View style={styles.card}>
        <Row label="Transações pendentes" value={String(status.pendingTransactions)} />
        <Row
          label="Última tentativa"
          value={status.lastSyncAttemptAt ? new Date(status.lastSyncAttemptAt).toLocaleString("pt-BR") : "—"}
        />
        <Row
          label="Última sincronização OK"
          value={status.lastSyncSuccessAt ? new Date(status.lastSyncSuccessAt).toLocaleString("pt-BR") : "—"}
        />
        <Row label="Último erro" value={status.lastError ?? "Nenhum"} isError={!!status.lastError} />
      </View>

      <Pressable style={styles.button} onPress={handleSync} disabled={syncing}>
        {syncing ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.buttonText}>Sincronizar agora</Text>}
      </Pressable>
    </SafeAreaView>
  );
}

function Row({ label, value, isError }: { label: string; value: string; isError?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, isError && { color: "#F87171" }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A", padding: 20 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 20 },
  card: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#334155"
  },
  label: { color: "#94A3B8" },
  value: { color: "#fff", fontWeight: "600", maxWidth: "60%", textAlign: "right" },
  button: { backgroundColor: "#38BDF8", padding: 16, borderRadius: 10, alignItems: "center", marginTop: 24 },
  buttonText: { color: "#0F172A", fontWeight: "700" }
});
