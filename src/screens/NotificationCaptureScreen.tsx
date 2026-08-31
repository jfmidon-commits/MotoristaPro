import React, { useCallback, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import {
  clearPendingAccessibilitySnapshots,
  clearPendingRideNotifications,
  getAccessibilityAccessStatus,
  getNotificationAccessStatus,
  getPendingAccessibilitySnapshots,
  getPendingRideNotifications,
  openAccessibilitySettings,
  openNotificationAccessSettings,
  type AccessibilitySnapshot,
  type CapturedRideNotification,
  type NativeNotificationPermissionStatus
} from "../../modules/motorista-notification-listener";
import { parseRideNotification } from "@/services/NotificationOfferParser";
import { parseAccessibilitySnapshot } from "@/services/AccessibilityOfferParser";
import { normalizeRideOffer } from "@/services/RideOfferNormalizer";

function permissionLabel(status: NativeNotificationPermissionStatus): string {
  if (status === "granted") return "Acesso autorizado";
  if (status === "denied") return "Acesso ainda não autorizado";
  return "Recurso nativo indisponível nesta instalação";
}

function formatCapturedAt(value?: number | null): string {
  if (!value) return "horário —";
  try {
    return new Date(value).toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    });
  } catch {
    return "horário inválido";
  }
}

function snapshotPreview(snapshot: AccessibilitySnapshot): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const node of snapshot.nodes ?? []) {
    const text = (node.text ?? "").trim().replace(/\s+/g, " ");
    if (!text) continue;
    const key = `${text.toLowerCase()}@${node.left ?? 0},${node.top ?? 0},${node.right ?? 0},${node.bottom ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(
      `${text}  [${node.left ?? "?"},${node.top ?? "?"} → ${node.right ?? "?"},${node.bottom ?? "?"}]${node.clickable ? " • clicável" : ""}`
    );
    if (lines.length >= 18) break;
  }
  return lines;
}

export default function NotificationCaptureScreen() {
  const [status, setStatus] = useState<NativeNotificationPermissionStatus>("unavailable");
  const [a11yStatus, setA11yStatus] = useState<NativeNotificationPermissionStatus>("unavailable");
  const [notifications, setNotifications] = useState<CapturedRideNotification[]>([]);
  const [snapshots, setSnapshots] = useState<AccessibilitySnapshot[]>([]);

  const load = useCallback(() => {
    setStatus(getNotificationAccessStatus());
    setA11yStatus(getAccessibilityAccessStatus());
    setNotifications(getPendingRideNotifications());
    setSnapshots(getPendingAccessibilitySnapshots());
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const parsedNotifications = notifications
    .map((notification) => {
      const raw = parseRideNotification(notification);
      return raw ? normalizeRideOffer(raw) : null;
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .slice()
    .reverse();

  const parsedA11y = snapshots
    .map((snapshot) => {
      const raw = parseAccessibilitySnapshot(snapshot);
      return raw ? normalizeRideOffer(raw) : null;
    })
    .filter((item): item is NonNullable<typeof item> => item != null)
    .slice()
    .reverse();

  const parsed = [...parsedA11y, ...parsedNotifications];
  const latestSnapshots = snapshots.slice().reverse().slice(0, 5);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Captura automática de ofertas</Text>
        <Text style={styles.body}>
          O MotoristaPro pode receber notificações e capturar snapshots sanitizados da tela de apps de corrida para identificar valor, distância e tempo sem exigir digitação durante a condução.
        </Text>

        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Privacidade</Text>
          <Text style={styles.body}>
            O listener de notificação e o serviço de acessibilidade filtram apenas pacotes de apps de corrida e mantêm filas locais curtas. Textos operacionais são preferidos; nomes e endereços completos não são persistidos quando podem ser descartados. Nada é enviado ao Supabase nesta etapa.
          </Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Notificações: {permissionLabel(status)}</Text>
          <Text style={styles.statusText}>{notifications.length} notificação(ões) candidata(s) na fila local.</Text>
        </View>

        <View style={styles.statusCard}>
          <Text style={styles.statusTitle}>Acessibilidade: {permissionLabel(a11yStatus)}</Text>
          <Text style={styles.statusText}>{snapshots.length} snapshot(s) sanitizado(s) na fila local.</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => openNotificationAccessSettings()}>
          <Text style={styles.primaryButtonText}>Abrir acesso às notificações</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => openAccessibilitySettings()}>
          <Text style={styles.primaryButtonText}>Abrir configurações de acessibilidade</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={load}>
          <Text style={styles.secondaryButtonText}>Atualizar diagnóstico</Text>
        </Pressable>
        <Pressable
          style={styles.secondaryButton}
          onPress={() => {
            clearPendingRideNotifications();
            clearPendingAccessibilitySnapshots();
            load();
          }}
        >
          <Text style={styles.secondaryButtonText}>Limpar filas de diagnóstico</Text>
        </Pressable>

        <Text style={styles.sectionTitle}>Ofertas reconhecidas</Text>
        {parsed.length === 0 ? (
          <Text style={styles.empty}>Ainda não há oferta reconhecida. Depois de autorizar, deixe Uber/99/inDrive emitirem uma oferta e volte aqui quando estiver parado.</Text>
        ) : (
          parsed.map((offer, index) => (
            <View key={`${offer.capturedAtIso}-${index}`} style={styles.offerCard}>
              <Text style={styles.offerTitle}>{offer.platform.toUpperCase()} • R$ {(offer.offeredAmountCents / 100).toFixed(2).replace(".", ",")} • {offer.captureSource}</Text>
              <Text style={styles.offerText}>
                {offer.totalExpectedDistanceKm != null ? `${offer.totalExpectedDistanceKm.toFixed(1)} km` : "km —"}
                {" • "}
                {offer.totalExpectedDurationMinutes != null ? `${offer.totalExpectedDurationMinutes.toFixed(0)} min` : "tempo —"}
                {" • confiança "}{Math.round((offer.extractionConfidence ?? 0) * 100)}%
              </Text>
            </View>
          ))
        )}

        <Text style={styles.sectionTitle}>Diagnóstico dos snapshots</Text>
        <Text style={styles.diagnosticHint}>
          Mostra somente o conteúdo já sanitizado e mantido localmente. Use esta área para confirmar o que Uber/99 realmente expuseram ao serviço de acessibilidade.
        </Text>
        {latestSnapshots.length === 0 ? (
          <Text style={styles.empty}>Nenhum snapshot capturado ainda.</Text>
        ) : (
          latestSnapshots.map((snapshot, index) => {
            const raw = parseAccessibilitySnapshot(snapshot);
            const preview = snapshotPreview(snapshot);
            return (
              <View key={`${snapshot.fingerprint ?? snapshot.capturedAt ?? index}-${index}`} style={styles.snapshotCard}>
                <Text style={styles.snapshotTitle}>
                  #{snapshots.length - index} • {snapshot.packageName}
                </Text>
                <Text style={styles.snapshotMeta}>
                  {formatCapturedAt(snapshot.capturedAt)} • {snapshot.nodeCount ?? snapshot.nodes?.length ?? 0} nodes
                  {snapshot.truncated ? " • truncado" : ""}
                </Text>
                <Text style={[styles.parserBadge, raw ? styles.parserOk : styles.parserMiss]}>
                  {raw ? "PARSER: OFERTA RECONHECIDA" : "PARSER: NÃO RECONHECEU"}
                </Text>
                {raw ? (
                  <Text style={styles.snapshotMeta}>
                    bruto: R$ {raw.offeredAmount?.toFixed(2).replace(".", ",") ?? "—"} • pickup {raw.pickupDistanceKm ?? "—"} km / {raw.pickupDurationMinutes ?? "—"} min • viagem {raw.tripDistanceKm ?? "—"} km / {raw.tripDurationMinutes ?? "—"} min
                  </Text>
                ) : null}
                {preview.length === 0 ? (
                  <Text style={styles.empty}>Snapshot sem texto operacional persistido.</Text>
                ) : (
                  preview.map((line, lineIndex) => (
                    <Text key={`${index}-${lineIndex}`} style={styles.snapshotLine}>{line}</Text>
                  ))
                )}
              </View>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0F172A" },
  content: { padding: 20, paddingBottom: 40 },
  title: { color: "#fff", fontSize: 22, fontWeight: "900", marginBottom: 10 },
  body: { color: "#CBD5E1", fontSize: 14, lineHeight: 20 },
  notice: { backgroundColor: "#1E293B", borderRadius: 14, padding: 14, marginTop: 16 },
  noticeTitle: { color: "#FBBF24", fontWeight: "900", marginBottom: 6 },
  statusCard: { backgroundColor: "#172554", borderRadius: 14, padding: 16, marginTop: 16, marginBottom: 14 },
  statusTitle: { color: "#fff", fontWeight: "900", fontSize: 16 },
  statusText: { color: "#CBD5E1", marginTop: 5 },
  primaryButton: { backgroundColor: "#38BDF8", borderRadius: 12, padding: 14, alignItems: "center", marginBottom: 10 },
  primaryButtonText: { color: "#082F49", fontWeight: "900" },
  secondaryButton: { backgroundColor: "#1E293B", borderRadius: 12, padding: 13, alignItems: "center", marginBottom: 10 },
  secondaryButtonText: { color: "#E2E8F0", fontWeight: "800" },
  sectionTitle: { color: "#fff", fontWeight: "900", fontSize: 17, marginTop: 18, marginBottom: 10 },
  empty: { color: "#94A3B8", lineHeight: 20 },
  offerCard: { backgroundColor: "#1E293B", borderRadius: 12, padding: 14, marginBottom: 10 },
  offerTitle: { color: "#fff", fontWeight: "900" },
  offerText: { color: "#94A3B8", marginTop: 5 },
  diagnosticHint: { color: "#94A3B8", fontSize: 13, lineHeight: 18, marginBottom: 10 },
  snapshotCard: { backgroundColor: "#111827", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  snapshotTitle: { color: "#F8FAFC", fontWeight: "900", fontSize: 14 },
  snapshotMeta: { color: "#94A3B8", fontSize: 12, lineHeight: 18, marginTop: 4 },
  parserBadge: { fontSize: 12, fontWeight: "900", marginTop: 8, marginBottom: 6 },
  parserOk: { color: "#4ADE80" },
  parserMiss: { color: "#F87171" },
  snapshotLine: { color: "#CBD5E1", fontSize: 12, lineHeight: 17, marginTop: 3 }
});
