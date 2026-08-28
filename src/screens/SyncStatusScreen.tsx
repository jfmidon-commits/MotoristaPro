import React from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import { useAuth } from "@/context/AuthContext";
import { runSyncDiagnostics, type SyncDiagnosticsResult } from "@/services/SyncDiagnosticsService";
import { resetOperationalData } from "@/services/AccountDataService";

export default function SyncStatusScreen() {
  const { status, syncNow } = useTransactionSync();
  const { user } = useAuth();
  const [syncing, setSyncing] = React.useState(false);
  const [diagnosing, setDiagnosing] = React.useState(false);
  const [resetting, setResetting] = React.useState(false);
  const [diagnostics, setDiagnostics] = React.useState<SyncDiagnosticsResult | null>(null);

  async function handleSync() {
    setSyncing(true);
    try { await syncNow(); } finally { setSyncing(false); }
  }

  async function handleDiagnostics() {
    setDiagnosing(true);
    try { setDiagnostics(await runSyncDiagnostics(user?.id)); } finally { setDiagnosing(false); }
  }

  function handleResetRequest() {
    if (!user?.id || resetting) return;
    Alert.alert(
      "Reiniciar dados da conta?",
      "Isso apaga definitivamente veículos, turnos, receitas, despesas, manutenções e planos preventivos deste usuário no celular e na nuvem. Sua conta de acesso será preservada. Use apenas com internet.",
      [
        { text: "Cancelar", style: "cancel" },
        {
          text: "Continuar",
          style: "destructive",
          onPress: () => {
            Alert.alert(
              "Confirmação final",
              "Esta ação não pode ser desfeita. Deseja realmente começar do zero?",
              [
                { text: "Não", style: "cancel" },
                { text: "SIM, APAGAR DADOS", style: "destructive", onPress: handleConfirmedReset }
              ]
            );
          }
        }
      ]
    );
  }

  async function handleConfirmedReset() {
    if (!user?.id || resetting) return;
    setResetting(true);
    try {
      await resetOperationalData(user.id);
      setDiagnostics(null);
      Alert.alert(
        "Dados reiniciados",
        "Os dados operacionais foram apagados do celular e da nuvem. Sua conta foi preservada. Você pode começar o uso real do MotoristaPro."
      );
    } catch (error) {
      Alert.alert("Não foi possível reiniciar", error instanceof Error ? error.message : "Erro inesperado.");
    } finally {
      setResetting(false);
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
          <Row label="Deleções pendentes" value={String(status.pendingDeletes)} />
          <Row label="Última tentativa" value={status.lastSyncAttemptAt ? new Date(status.lastSyncAttemptAt).toLocaleString("pt-BR") : "—"} />
          <Row label="Última sincronização OK" value={status.lastSyncSuccessAt ? new Date(status.lastSyncSuccessAt).toLocaleString("pt-BR") : "—"} />
          <Row label="Último erro" value={status.lastError ?? "Nenhum"} isError={!!status.lastError} />
        </View>

        <Text style={styles.sectionTitle}>Diagnóstico antes do teste</Text>
        <Text style={styles.helper}>Esta verificação não cria nem altera dados. Ela confirma se o celular está pronto para o smoke test.</Text>
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
            <Text style={[styles.readiness, diagnostics.ok ? styles.ok : styles.fail]}>{diagnostics.ok ? "Pronto para o teste offline → online." : "Ainda há um bloqueio antes do teste físico."}</Text>
          </View>
        )}

        <Pressable style={styles.secondaryButton} onPress={handleDiagnostics} disabled={diagnosing || resetting}>
          {diagnosing ? <ActivityIndicator color="#E2E8F0" /> : <Text style={styles.secondaryButtonText}>Verificar se está pronto</Text>}
        </Pressable>
        <Pressable style={styles.button} onPress={handleSync} disabled={syncing || resetting}>
          {syncing ? <ActivityIndicator color="#0F172A" /> : <Text style={styles.buttonText}>Sincronizar agora</Text>}
        </Pressable>

        <View style={styles.dangerZone}>
          <Text style={styles.dangerTitle}>Zona de segurança</Text>
          <Text style={styles.helper}>Use apenas para reiniciar uma conta de testes ou quando você realmente quiser apagar todos os dados operacionais. A conta/login não é excluída.</Text>
          <Pressable style={styles.dangerButton} onPress={handleResetRequest} disabled={resetting}>
            {resetting ? <ActivityIndicator color="#FCA5A5" /> : <Text style={styles.dangerButtonText}>Apagar meus dados e começar do zero</Text>}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ label, value, isError }: { label: string; value: string; isError?: boolean }) {
  return <View style={styles.row}><Text style={styles.label}>{label}</Text><Text style={[styles.value, isError && styles.fail]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "700", marginBottom: 20 },
  sectionTitle: { color: "#fff", fontSize: 18, fontWeight: "700", marginTop: 24, marginBottom: 6 },
  helper: { color: "#94A3B8", lineHeight: 20, marginBottom: 12 },
  card: { backgroundColor: "#1E293B", borderRadius: 12, padding: 16 },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#334155" },
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
  secondaryButton: { borderWidth: 1, borderColor: "#64748B", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 16 },
  secondaryButtonText: { color: "#E2E8F0", fontWeight: "700" },
  dangerZone: { marginTop: 32, borderWidth: 1, borderColor: "#7F1D1D", backgroundColor: "#1F1518", borderRadius: 12, padding: 16 },
  dangerTitle: { color: "#FCA5A5", fontSize: 17, fontWeight: "800", marginBottom: 6 },
  dangerButton: { borderWidth: 1, borderColor: "#EF4444", padding: 14, borderRadius: 10, alignItems: "center", marginTop: 4 },
  dangerButtonText: { color: "#FCA5A5", fontWeight: "800", textAlign: "center" }
});
