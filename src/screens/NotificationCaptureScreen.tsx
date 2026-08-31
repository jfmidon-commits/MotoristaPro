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
  offerText: { color: "#94A3B8", marginTop: 5 }
});
