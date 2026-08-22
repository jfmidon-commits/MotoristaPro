import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ScrollView, RefreshControl } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { useTransactionSync } from "@/hooks/useTransactionSync";
import {
  computeMetrics,
  endOfDayIso,
  startOfDayIso,
  startOfMonthIso,
  startOfWeekIso,
  type PeriodMetrics
} from "@/services/MetricsService";
import { getActiveWorkSession } from "@/services/WorkSessionService";
import {
  computeWorkSessionMetrics,
  formatDuration,
  type WorkSessionMetrics
} from "@/services/WorkSessionMetricsService";
import { getVehicles } from "@/services/VehicleService";
import { getPreventiveMaintenanceOverviewForVehicle } from "@/services/PreventiveMaintenanceService";
import { formatCentsToBRL } from "@/utils/formatters";
import type { Vehicle, WorkSession } from "@/types";

type PeriodKey = "today" | "week" | "month";
type PreventiveSummary = { total: number; overdue: number; soon: number };

function formatHours(hours: number): string {
  const totalMinutes = Math.round(hours * 60);
  const h = Math.floor(totalMinutes / 60);
  const min = totalMinutes % 60;
  return `${h}h ${String(min).padStart(2, "0")}min`;
}

function moneyOrDash(value: number | null): string {
  return value == null ? "—" : formatCentsToBRL(value);
}

function periodStartIso(period: PeriodKey, date: Date): string {
  if (period === "week") return startOfWeekIso(date);
  if (period === "month") return startOfMonthIso(date);
  return startOfDayIso(date);
}

export default function DashboardScreen({ navigation }: any) {
  const { user, signOut } = useAuth();
  const { status, syncNow } = useTransactionSync();
  const [metrics, setMetrics] = useState<PeriodMetrics | null>(null);
  const [period, setPeriod] = useState<PeriodKey>("today");
  const [activeSession, setActiveSession] = useState<WorkSession | null>(null);
  const [sessionMetrics, setSessionMetrics] = useState<WorkSessionMetrics | null>(null);
  const [sessionVehicle, setSessionVehicle] = useState<Vehicle | null>(null);
  const [preventiveSummary, setPreventiveSummary] = useState<PreventiveSummary>({ total: 0, overdue: 0, soon: 0 });
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const now = new Date();
    const [periodResult, session, vehicles] = await Promise.all([
      computeMetrics(user.id, periodStartIso(period, now), endOfDayIso(now)),
      getActiveWorkSession(user.id),
      getVehicles(user.id)
    ]);

    setMetrics(periodResult);
    setActiveSession(session);
    setSessionVehicle(session?.vehicle_id ? vehicles.find((v) => v.id === session.vehicle_id) ?? null : null);
    setSessionMetrics(session ? await computeWorkSessionMetrics(user.id, session, now) : null);

    const preventiveByVehicle = await Promise.all(
      vehicles.map((vehicle) => getPreventiveMaintenanceOverviewForVehicle(user.id, vehicle.id, now))
    );
    const allPreventive = preventiveByVehicle.flat();
    setPreventiveSummary({
      total: allPreventive.length,
      overdue: allPreventive.filter((item) => item.status === "overdue").length,
      soon: allPreventive.filter((item) => item.status === "soon").length
    });
  }, [period, user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!activeSession) return;
    const timer = setInterval(() => {
      load();
    }, 30_000);
    return () => clearInterval(timer);
  }, [activeSession?.id, load]);

  async function onRefresh() {
    setRefreshing(true);
    try {
      await syncNow();
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  const totalPending =
    status.pendingTransactions +
    status.pendingVehicles +
    status.pendingMaintenance +
    status.pendingWorkSessions +
    status.pendingPreventiveMaintenance +
    status.pendingDeletes;

  const preventiveAttention = preventiveSummary.overdue + preventiveSummary.soon;

  return (
    <SafeAreaView style={styles.container} edges={["top"]}>
      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={{ padding: 20 }}
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>MotoristaPro</Text>
            <Text style={styles.subtitle}>{user?.email}</Text>
          </View>
          <Pressable onPress={signOut}>
            <Text style={styles.logout}>Sair</Text>
          </Pressable>
        </View>

        {activeSession && sessionMetrics ? (
          <Pressable style={styles.activeSessionCard} onPress={() => navigation.navigate("WorkSession")}>
            <View style={styles.activeSessionHeader}>
              <View>
                <Text style={styles.activeSessionEyebrow}>TURNO ATIVO</Text>
                <Text style={styles.activeSessionVehicle}>
                  {sessionVehicle
                    ? `${sessionVehicle.name}${sessionVehicle.plate ? ` • ${sessionVehicle.plate}` : ""}`
                    : "Veículo do turno"}
                </Text>
              </View>
              <Text style={styles.activeSessionDuration}>{formatDuration(sessionMetrics.durationHours)}</Text>
            </View>
            <View style={styles.activeSessionMetrics}>
              <View style={styles.activeMetric}>
                <Text style={styles.activeMetricLabel}>Receita</Text>
                <Text style={[styles.activeMetricValue, styles.income]}>
                  {formatCentsToBRL(sessionMetrics.grossIncome)}
                </Text>
              </View>
              <View style={styles.activeMetric}>
                <Text style={styles.activeMetricLabel}>Lucro</Text>
                <Text style={styles.activeMetricValue}>{formatCentsToBRL(sessionMetrics.netProfit)}</Text>
              </View>
              <View style={styles.activeMetric}>
                <Text style={styles.activeMetricLabel}>Lucro / hora</Text>
                <Text style={styles.activeMetricValue}>{moneyOrDash(sessionMetrics.perHourCents)}</Text>
              </View>
            </View>
            <Text style={styles.activeSessionAction}>Toque para encerrar o turno →</Text>
          </Pressable>
        ) : null}

        <View style={styles.periodTabs}>
          {([
            ["today", "Hoje"],
            ["week", "Semana"],
            ["month", "Mês"]
          ] as const).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.periodTab, period === key && styles.periodTabActive]}
              onPress={() => setPeriod(key)}
            >
              <Text style={[styles.periodTabText, period === key && styles.periodTabTextActive]}>{label}</Text>
            </Pressable>
          ))}
        </View>

        <View style={styles.profitCard}>
          <Text style={styles.cardLabel}>Lucro líquido</Text>
          <Text style={styles.profitValue}>{formatCentsToBRL(metrics?.netProfit ?? 0)}</Text>
          <View style={styles.row}>
            <Text style={styles.income}>+ {formatCentsToBRL(metrics?.grossIncome ?? 0)}</Text>
            <Text style={styles.expenseText}>- {formatCentsToBRL(metrics?.totalExpense ?? 0)}</Text>
          </View>
        </View>

        <View style={styles.metricsGrid}>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Horas</Text><Text style={styles.metricValue}>{metrics && metrics.totalHours > 0 ? formatHours(metrics.totalHours) : "—"}</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Km rodados</Text><Text style={styles.metricValue}>{metrics && metrics.totalKm > 0 ? `${metrics.totalKm.toFixed(0)} km` : "—"}</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Lucro / hora</Text><Text style={styles.metricValue}>{moneyOrDash(metrics?.perHourCents ?? null)}</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Lucro / km</Text><Text style={styles.metricValue}>{moneyOrDash(metrics?.perKmCents ?? null)}</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Custo / km</Text><Text style={styles.metricValue}>{moneyOrDash(metrics?.costPerKmCents ?? null)}</Text></View>
          <View style={styles.metricCard}><Text style={styles.metricLabel}>Lançamentos</Text><Text style={styles.metricValue}>{metrics?.transactionCount ?? 0}</Text></View>
        </View>

        <Pressable
          style={[
            styles.maintenanceSummary,
            preventiveSummary.overdue > 0 && styles.maintenanceSummaryOverdue,
            preventiveSummary.overdue === 0 && preventiveSummary.soon > 0 && styles.maintenanceSummarySoon
          ]}
          onPress={() => navigation.navigate("PreventiveMaintenance")}
        >
          <Text style={styles.maintenanceTitle}>Manutenção preventiva</Text>
          <Text style={styles.maintenanceText}>
            {preventiveSummary.total === 0
              ? "Configure seus intervalos de manutenção →"
              : preventiveAttention === 0
                ? "Manutenção em dia →"
                : `${preventiveAttention} item(ns) precisam de atenção • ${preventiveSummary.overdue} vencido(s) →`}
          </Text>
        </Pressable>

        <Pressable
          style={[styles.workButton, activeSession && styles.workButtonActive]}
          onPress={() => navigation.navigate("WorkSession")}
        >
          <Text style={styles.workButtonTitle}>{activeSession ? "Encerrar turno" : "Iniciar turno"}</Text>
          <Text style={styles.workButtonText}>
            {activeSession ? "Confira o resumo e informe o odômetro final →" : "Registre horário e odômetro inicial →"}
          </Text>
        </Pressable>

        <Pressable style={styles.syncStatus} onPress={() => navigation.navigate("SyncStatus")}>
          <Text style={styles.syncStatusText}>
            {totalPending > 0 ? `${totalPending} item(ns) aguardando sincronização` : "Tudo sincronizado"}
          </Text>
        </Pressable>

        <View style={styles.actions}>
          <Pressable style={[styles.actionButton, styles.incomeButton]} onPress={() => navigation.navigate("AddTransaction", { type: "income" })}>
            <Text style={styles.actionButtonText}>+ Receita</Text>
          </Pressable>
          <Pressable style={[styles.actionButton, styles.expenseButton]} onPress={() => navigation.navigate("AddTransaction", { type: "expense" })}>
            <Text style={styles.actionButtonText}>- Despesa</Text>
          </Pressable>
        </View>

        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Transactions")}><Text style={styles.linkText}>Transações →</Text></Pressable>
        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Vehicles")}><Text style={styles.linkText}>Veículos →</Text></Pressable>
        <Pressable style={styles.linkRow} onPress={() => navigation.navigate("Maintenance")}><Text style={styles.linkText}>Manutenção →</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  title: { color: "#fff", fontSize: 22, fontWeight: "800" },
  subtitle: { color: "#64748B", marginTop: 2, fontSize: 12 },
  logout: { color: "#F87171" },
  activeSessionCard: { backgroundColor: "#172554", borderWidth: 1, borderColor: "#22C55E", borderRadius: 16, padding: 16, marginBottom: 14 },
  activeSessionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  activeSessionEyebrow: { color: "#22C55E", fontSize: 12, fontWeight: "900", letterSpacing: 1 },
  activeSessionVehicle: { color: "#CBD5E1", fontSize: 13, marginTop: 4 },
  activeSessionDuration: { color: "#fff", fontSize: 20, fontWeight: "900" },
  activeSessionMetrics: { flexDirection: "row", gap: 8, marginTop: 14 },
  activeMetric: { flex: 1, backgroundColor: "#0F172A", borderRadius: 10, padding: 10 },
  activeMetricLabel: { color: "#94A3B8", fontSize: 10 },
  activeMetricValue: { color: "#fff", fontSize: 13, fontWeight: "800", marginTop: 4 },
  activeSessionAction: { color: "#38BDF8", fontSize: 12, fontWeight: "700", marginTop: 12 },
  periodTabs: { flexDirection: "row", backgroundColor: "#1E293B", borderRadius: 12, padding: 4, marginBottom: 12 },
  periodTab: { flex: 1, paddingVertical: 9, alignItems: "center", borderRadius: 9 },
  periodTabActive: { backgroundColor: "#38BDF8" },
  periodTabText: { color: "#94A3B8", fontWeight: "700", fontSize: 13 },
  periodTabTextActive: { color: "#082F49" },
  profitCard: { backgroundColor: "#1E293B", borderRadius: 16, padding: 20, marginBottom: 12 },
  cardLabel: { color: "#94A3B8", fontSize: 14 },
  profitValue: { color: "#fff", fontSize: 32, fontWeight: "800", marginVertical: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 8 },
  income: { color: "#22C55E", fontWeight: "700" },
  expenseText: { color: "#EF4444", fontWeight: "700" },
  metricsGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 16 },
  metricCard: { width: "48%", backgroundColor: "#1E293B", borderRadius: 12, padding: 14 },
  metricLabel: { color: "#94A3B8", fontSize: 12 },
  metricValue: { color: "#fff", fontWeight: "800", fontSize: 17, marginTop: 5 },
  maintenanceSummary: { backgroundColor: "#1E293B", borderRadius: 14, padding: 15, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: "#22C55E" },
  maintenanceSummarySoon: { borderLeftColor: "#F59E0B" },
  maintenanceSummaryOverdue: { borderLeftColor: "#EF4444" },
  maintenanceTitle: { color: "#fff", fontWeight: "800" },
  maintenanceText: { color: "#CBD5E1", marginTop: 4, fontSize: 13 },
  workButton: { backgroundColor: "#0EA5E9", borderRadius: 14, padding: 16, marginBottom: 12 },
  workButtonActive: { backgroundColor: "#F59E0B" },
  workButtonTitle: { color: "#082F49", fontSize: 16, fontWeight: "800" },
  workButtonText: { color: "#082F49", marginTop: 2, fontSize: 13 },
  syncStatus: { backgroundColor: "#1E293B", borderRadius: 10, padding: 12, marginBottom: 16 },
  syncStatusText: { color: "#FBBF24", fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", gap: 12, marginBottom: 20 },
  actionButton: { flex: 1, padding: 16, borderRadius: 10, alignItems: "center" },
  incomeButton: { backgroundColor: "#22C55E" },
  expenseButton: { backgroundColor: "#EF4444" },
  actionButtonText: { color: "#0F172A", fontWeight: "800" },
  linkRow: { paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: "#1E293B" },
  linkText: { color: "#38BDF8", fontSize: 15 }
});
