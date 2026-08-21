import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getDefaultVehicle } from "@/services/VehicleService";
import {
  endWorkSession,
  getActiveWorkSession,
  startWorkSession
} from "@/services/WorkSessionService";
import type { Vehicle, WorkSession } from "@/types";

function parseOdometer(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function formatElapsed(startedAt: string, nowMs: number): string {
  const elapsedMs = Math.max(0, nowMs - new Date(startedAt).getTime());
  const totalMinutes = Math.floor(elapsedMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}min`;
}

export default function WorkSessionScreen({ navigation }: any) {
  const { user } = useAuth();
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [activeSession, setActiveSession] = useState<WorkSession | null>(null);
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [defaultVehicle, session] = await Promise.all([
      getDefaultVehicle(user.id),
      getActiveWorkSession(user.id)
    ]);
    setVehicle(defaultVehicle);
    setActiveSession(session);
    if (session?.start_odometer_km != null && !session.ended_at) {
      setOdometer("");
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  useEffect(() => {
    if (!activeSession) return;
    setNowMs(Date.now());
    const timer = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, [activeSession?.id]);

  const elapsed = useMemo(
    () => (activeSession ? formatElapsed(activeSession.started_at, nowMs) : null),
    [activeSession, nowMs]
  );

  async function handleStart() {
    if (!user?.id) return;
    if (!vehicle) {
      Alert.alert("Cadastre um veículo", "Você precisa de um veículo para iniciar o turno.", [
        { text: "Agora não", style: "cancel" },
        { text: "Cadastrar veículo", onPress: () => navigation.navigate("Vehicles") }
      ]);
      return;
    }

    const startKm = parseOdometer(odometer);
    if (startKm == null || startKm < 0) {
      Alert.alert("Odômetro inválido", "Informe a quilometragem atual do veículo.");
      return;
    }

    setSaving(true);
    try {
      await startWorkSession({
        userId: user.id,
        vehicleId: vehicle.id,
        startOdometerKm: startKm
      });
      setOdometer("");
      await load();
    } catch (err) {
      Alert.alert("Não foi possível iniciar o turno", (err as Error)?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  async function handleEnd() {
    if (!activeSession) return;
    const endKm = parseOdometer(odometer);
    if (endKm == null || endKm < 0) {
      Alert.alert("Odômetro inválido", "Informe a quilometragem atual para encerrar o turno.");
      return;
    }

    setSaving(true);
    try {
      await endWorkSession({ sessionId: activeSession.id, endOdometerKm: endKm });
      setOdometer("");
      await load();
      Alert.alert("Turno encerrado", "Horas e quilômetros já podem entrar nas suas métricas.");
    } catch (err) {
      Alert.alert("Não foi possível encerrar o turno", (err as Error)?.message ?? "Erro desconhecido");
    } finally {
      setSaving(false);
    }
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.content}>
        <View style={styles.card}>
          <Text style={styles.eyebrow}>{activeSession ? "TURNO ATIVO" : "PRONTO PARA TRABALHAR"}</Text>
          <Text style={styles.title}>{activeSession ? elapsed : "Inicie seu turno"}</Text>
          <Text style={styles.subtitle}>
            {vehicle ? `${vehicle.name}${vehicle.plate ? ` • ${vehicle.plate}` : ""}` : "Nenhum veículo padrão"}
          </Text>

          {activeSession?.start_odometer_km != null ? (
            <Text style={styles.info}>Odômetro inicial: {activeSession.start_odometer_km} km</Text>
          ) : null}
        </View>

        <Text style={styles.label}>
          {activeSession ? "Odômetro atual para encerrar" : "Odômetro atual"}
        </Text>
        <TextInput
          value={odometer}
          onChangeText={setOdometer}
          keyboardType="number-pad"
          placeholder="Ex: 123456"
          placeholderTextColor="#64748B"
          style={styles.input}
        />

        <Pressable
          style={[styles.primaryButton, activeSession ? styles.endButton : styles.startButton]}
          onPress={activeSession ? handleEnd : handleStart}
          disabled={saving}
        >
          <Text style={styles.primaryButtonText}>
            {saving ? "Salvando..." : activeSession ? "Encerrar turno" : "Iniciar turno"}
          </Text>
        </Pressable>

        {!vehicle ? (
          <Pressable style={styles.secondaryButton} onPress={() => navigation.navigate("Vehicles")}>
            <Text style={styles.secondaryButtonText}>Cadastrar veículo</Text>
          </Pressable>
        ) : null}

        <Text style={styles.help}>
          O turno é salvo primeiro no celular. Se estiver sem internet, a sincronização acontece depois.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, gap: 12 },
  card: { backgroundColor: "#1E293B", borderRadius: 16, padding: 20, marginBottom: 8 },
  eyebrow: { color: "#38BDF8", fontSize: 12, fontWeight: "800", letterSpacing: 1 },
  title: { color: "#fff", fontSize: 28, fontWeight: "800", marginTop: 6 },
  subtitle: { color: "#94A3B8", marginTop: 6 },
  info: { color: "#CBD5E1", marginTop: 14, fontSize: 13 },
  label: { color: "#CBD5E1", fontSize: 13, fontWeight: "600" },
  input: {
    backgroundColor: "#1E293B",
    borderRadius: 10,
    padding: 15,
    color: "#fff",
    fontSize: 18
  },
  primaryButton: { padding: 16, borderRadius: 12, alignItems: "center", marginTop: 4 },
  startButton: { backgroundColor: "#22C55E" },
  endButton: { backgroundColor: "#F97316" },
  primaryButtonText: { color: "#0F172A", fontSize: 16, fontWeight: "800" },
  secondaryButton: {
    borderWidth: 1,
    borderColor: "#38BDF8",
    padding: 14,
    borderRadius: 10,
    alignItems: "center"
  },
  secondaryButtonText: { color: "#38BDF8", fontWeight: "700" },
  help: { color: "#64748B", fontSize: 12, lineHeight: 18, marginTop: 8 }
});
