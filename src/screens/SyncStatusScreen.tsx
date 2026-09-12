import React from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import { useAuth } from "@/context/AuthContext";
import { runSyncDiagnostics, type SyncDiagnosticsResult } from "@/services/SyncDiagnosticsService";

export default function SyncStatusScreen({ navigation }: any) {
  const { status, syncNow } = useTransactionSync();
  const { user } = useAuth();
  const [syncing, setSyncing] = React.useState(false);
  const [diagnosing, setDiagnosing] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState<SyncDiagnosticsResult | null>(null);

  async function handleSync() {
    setSyncing(true);
    try {
      await syncNow();
    } finally {
      setSyncing(false);
    }
  }

  async function handleDiagnostics() {
    setDiagnosing(true);
    try {
      setDiagnostics(await runSyncDiagnostics(user?.id));
    } finally {
      setDiagnosing(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Status de Sincronização</Text>

        <View style={styles.card}>
          <Row label="Transações pendentes" value={String(status.pendingTransactions)} />
          <Row label="Veículos pendentes" value={String(status.pendingVehicles)} />
          <Row label="Manutenções pendentes" value={String(status.pendingMaintenance)} />
          <Row label="Planos preventivos pendentes" value={String(status.pendingPreventiveMaintenance)} />
          <Row label="Turnos pendentes" value={String(status.pendingWorkSessions)} />
          <Row label="Ofertas de corrida pendentes" value={String(status.pendingRideOffers)} />
          <Row label="Resultados de corrida pendentes" value={String(status.pendingRideResults)} />
          <Row label="Deleções pendentes" value={String(status.pendingDeletes)} />
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

        <Text style={styles.sectionTitle}>Diagnóstico antes do teste</Text>
        <Text style={styles.helper}>
          Esta verificação não cria nem altera dados. Ela confirma se o celular está pronto para o smoke test.
        </Text>

        {diagnostics && (
          <View style={styles.card}>
            {diagnostics.items.map((item) => (
              <View key={item.key} style={styles.diagnosticRow}>
                <Text style={[styles.diagnosticIcon, item.ok ? styles.ok : styles.fail]}>{item.ok ? "✓" : "✕"}</Text>
                <View style={styles.diagnosticText}>
                  <Text style={styles.diagnosticLabel}>{item.label}</Text>
                  <Text style={styles.diagnosticDetail}>{item.detail}</Text>
                </View>
              </View>
            ))}
            <Text style={[styles.readiness, diagnostics.ok ? styles.ok : styles.fail]}>
              {diagnostics.ok ? "Pronto para o teste offline → online." : "Ainda há um bloqueio antes do teste físico."}
            </Text>
          </View>
        )}

        <Pressable style={styles.secondaryButton} onPress={handleDiagnostics} disabled={diagnosing}>
          {diagnosing ? (
            <ActivityIndicator color="#E2E8F0" />
          ) : (
            <Text style={styles.secondaryButtonText}>Verificar se está pronto</Text>
          )}
        </Pressable>

        <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("NotificationCapture")}>
          <Text style={styles.secondaryButtonText}>Captura automática de ofertas</Text>
        </Pressable>

        <Pressable style={styles.button} onPress={handleSync} disabled={syncing}>
          {syncing ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.buttonText}>Sincronizar agora</Text>}
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, isError }: { label: string; value: string; isError?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, isError && styles.fail]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 20 },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 24, marginBottom: 6 },
  helper: { color: "#94A3B8", lineHeight: 20, marginBottom: 12 },
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
  diagnosticRow: { flexDirection: "row", paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: "#334155" },
  diagnosticIcon: { width: 24, fontSize: 18, fontWeight: "800" },
  diagnosticText: { flex: 1 },
  diagnosticLabel: { color: "#E2E8F0", fontWeight: "700" },
  diagnosticDetail: { color: "#94A3B8", marginTop: 2, lineHeight: 18 },
  readiness: { marginTop: 14, fontWeight: "800" },
  ok: { color: "#4ADE80" },
  fail: { color: "#F87171" },
  button: { backgroundColor: "#38BDF8", padding: 16, borderRadius: 10, alignItems: "center", marginTop: 12 },
  buttonText: { color: "#0F172A", fontWeight: "700" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#64748B",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 16
  },
  secondaryButtonText: { color: "#E2E8F0", fontWeight: "700" }
});
