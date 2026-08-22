import React, { useCallback, useState } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@/context/AuthContext";
import { getRecentWorkSessions } from "@/services/WorkSessionService";
import { getVehicles } from "@/services/VehicleService";
import { formatDuration } from "@/services/WorkSessionMetricsService";
import type { Vehicle, WorkSession } from "@/types";

function sessionDurationHours(session: WorkSession): number {
  if (!session.ended_at) return 0;
  return Math.max(0, (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 3_600_000);
}

export default function WorkSessionHistoryScreen({ navigation }: any) {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<WorkSession[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);

  const load = useCallback(async () => {
    if (!user?.id) return;
    const [history, vehicleRows] = await Promise.all([
      getRecentWorkSessions(user.id, 50),
      getVehicles(user.id)
    ]);
    setSessions(history);
    setVehicles(vehicleRows);
  }, [user?.id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function vehicleLabel(vehicleId: string | null): string {
    if (!vehicleId) return "Sem veículo";
    const vehicle = vehicles.find((v) => v.id === vehicleId);
    return vehicle ? `${vehicle.name}${vehicle.plate ? ` • ${vehicle.plate}` : ""}` : "Veículo";
  }

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <FlatList
        contentContainerStyle={styles.content}
        data={sessions}
        keyExtractor={(item) => item.id}
        ListEmptyComponent={<Text style={styles.empty}>Nenhum turno encerrado ainda.</Text>}
        renderItem={({ item }) => {
          const km = item.start_odometer_km != null && item.end_odometer_km != null
            ? Math.max(0, item.end_odometer_km - item.start_odometer_km)
            : null;
          return (
            <Pressable
              style={styles.card}
              onPress={() => navigation.navigate("WorkSessionDetail", { sessionId: item.id })}
            >
              <Text style={styles.date}>{new Date(item.started_at).toLocaleDateString("pt-BR")}</Text>
              <Text style={styles.vehicle}>{vehicleLabel(item.vehicle_id)}</Text>
              <View style={styles.row}>
                <Text style={styles.meta}>{formatDuration(sessionDurationHours(item))}</Text>
                <Text style={styles.meta}>{km != null ? `${km} km` : "Km —"}</Text>
              </View>
              <Text style={styles.open}>Ver detalhes →</Text>
            </Pressable>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20 },
  empty: { color: "#64748B", textAlign: "center", marginTop: 40 },
  card: { backgroundColor: "#1E293B", borderRadius: 14, padding: 16, marginBottom: 12 },
  date: { color: "#fff", fontSize: 17, fontWeight: "800" },
  vehicle: { color: "#94A3B8", marginTop: 4 },
  row: { flexDirection: "row", justifyContent: "space-between", marginTop: 12 },
  meta: { color: "#CBD5E1", fontWeight: "600" },
  open: { color: "#38BDF8", marginTop: 12, fontWeight: "700" }
});
