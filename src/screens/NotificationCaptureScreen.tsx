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
import { assessUberStructuralOffer } from "@/services/AccessibilityStructuralDiagnostics";
import { normalizeRideOffer } from "@/services/RideOfferNormalizer";
import { calculateOfferEconomics, classifyOffer, dedupeOffers } from "@/services/RideOfferDecision";

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

function formatRawAmount(value?: number | string | null): string {
  if (value == null || value === "") return "—";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value.toFixed(2).replace(".", ",") : "—";
  }
  return value.trim() || "—";
}

function formatMoneyMetric(value: number | null, suffix: string): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `R$ ${value.toFixed(2).replace(".", ",")}${suffix}`;
}

function semaphoreGlyph(value: ReturnType<typeof classifyOffer>): string {
  if (value === "green") return "🟢";
  if (value === "yellow") return "🟡";
  if (value === "red") return "🔴";
  return "⚪";
}

function snapshotPreview(snapshot: AccessibilitySnapshot): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];

  for (const node of snapshot.nodes ?? []) {
    const text = (node.text ?? "").trim().replace(/\s+/g, " ");
    const viewId = (node.viewId ?? "").trim();
    const className = (node.className ?? "").trim();
    const origin = (node.origin ?? "").trim();
    const windowId = node.windowId;
    const bounds = `[${node.left ?? "?"},${node.top ?? "?"} → ${node.right ?? "?"},${node.bottom ?? "?"}]`;
    const interactive = node.clickable ? " • clicável" : "";
    const source = [
      origin ? `origem:${origin}` : null,
      windowId != null ? `janela:${windowId}` : null
    ].filter(Boolean).join(" • ");

    let line = "";
    if (text) {
      line = `${text}  ${bounds}${interactive}${source ? ` • ${source}` : ""}`;
    } else if (viewId || className || node.clickable || source) {
      const structural = [
        viewId ? `id:${viewId}` : null,
        className ? `class:${className}` : null,
        source || null
      ].filter(Boolean).join(" • ");
      line = `[sem texto] ${structural || "nó estrutural"}  ${bounds}${interactive}`;
    } else {
      continue;
    }

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push(line);
    if (lines.length >= 24) break;
  }

  return lines;
}

function notificationPreview(notification: CapturedRideNotification): string[] {
  const values = [
    ...(notification.textLines ?? []),
    notification.text,
    notification.bigText,
    notification.summaryText,
    notification.infoText,
    notification.bigContentTitle,
    notification.tickerText,
    notification.title,
    notification.subText
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(values)).slice(0, 12);
}

export default function NotificationCaptureScreen() {
  const [status, setStatus] = useState<NativeNotificationPermissionStatus>("unavailable");
  const [a11yStatus, setA11yStatus] = useState<NativeNotificationPermissionStatus>("unavailable");
  const [notifications, setNotifications] = useState<CapturedRideNotification[]>([]);
  const [snapshots, setSnapshots] = useState<AccessibilitySnapshot[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const load = useCallback(() => {
    setStatus(getNotificationAccessStatus());
    setA11yStatus(getAccessibilityAccessStatus());
    setNotifications(getPendingRideNotifications());
    setSnapshots(getPendingAccessibilitySnapshots());
    setLastUpdatedAt(Date.now());
  }, []);

  const refreshDiagnostic = useCallback(() => {
    if (refreshing) return;
    setRefreshing(true);
    load();
    setTimeout(() => {
      load();
      setRefreshing(false);
    }, 450);
  }, [load, refreshing]);

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

  const parsed = dedupeOffers([...parsedA11y, ...parsedNotifications]);
  const latestNotifications = notifications.slice().reverse().slice(0, 5);
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
          <Text style={styles.statusText}>Última leitura da tela: {formatCapturedAt(lastUpdatedAt)}</Text>
        </View>

        <Pressable style={styles.primaryButton} onPress={() => openNotificationAccessSettings()}>
          <Text style={styles.primaryButtonText}>Abrir acesso às notificações</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={() => openAccessibilitySettings()}>
          <Text style={styles.primaryButtonText}>Abrir configurações de acessibilidade</Text>
        </Pressable>
        <Pressable style={styles.secondaryButton} onPress={refreshDiagnostic} disabled={refreshing}>
          <Text style={styles.secondaryButtonText}>{refreshing ? "Atualizando..." : "Atualizar diagnóstico"}</Text>
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
          parsed.map((offer, index) => {
            const economics = calculateOfferEconomics(offer);
            const semaphore = classifyOffer(offer, null);
            return (
              <View key={`${offer.capturedAtIso}-${index}`} style={styles.offerCard}>
                <Text style={styles.offerTitle}>
                  {offer.platform.toUpperCase()} • R$ {(offer.offeredAmountCents / 100).toFixed(2).replace(".", ",")}
                  {offer.category ? ` • ${offer.category}` : ""}
                </Text>
                <Text style={styles.offerText}>
                  TOTAL {offer.totalExpectedDistanceKm != null ? `${offer.totalExpectedDistanceKm.toFixed(1)} km` : "km —"}
                  {" • "}
                  {offer.totalExpectedDurationMinutes != null ? `${offer.totalExpectedDurationMinutes.toFixed(0)} min` : "tempo —"}
                </Text>
                <Text style={styles.offerMetrics}>
                  {formatMoneyMetric(economics.reaisPerKm, "/km")} • {formatMoneyMetric(economics.reaisPerHour, "/h")} • {semaphoreGlyph(semaphore)}
                </Text>
                <Text style={styles.offerMeta}>
                  semáforo aguardando suas metas • {offer.captureSource}
                </Text>
              </View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>Diagnóstico das notificações</Text>
        <Text style={styles.diagnosticHint}>
          Mostra apenas fragmentos operacionais sanitizados e sinais de quais extras Android existiam. Não exibe mensagens, nomes ou endereços brutos.
        </Text>
        {latestNotifications.length === 0 ? (
          <Text style={styles.empty}>Nenhuma notificação de app de corrida capturada ainda.</Text>
        ) : (
          latestNotifications.map((notification, index) => {
            const raw = parseRideNotification(notification);
            const preview = notificationPreview(notification);
            return (
              <View key={`${notification.notificationKey ?? notification.postedAt ?? index}-${index}`} style={styles.snapshotCard}>
                <Text style={styles.snapshotTitle}>#{notifications.length - index} • {notification.packageName}</Text>
                <Text style={styles.snapshotMeta}>{formatCapturedAt(notification.postedAt)}</Text>
                <Text style={styles.snapshotMeta}>
                  extras: básico {notification.hasBasicContent ? "sim" : "não"} • estendido {notification.hasExtendedContent ? "sim" : "não"} • textLines {notification.hasTextLines ? "sim" : "não"} • messages {notification.hasMessages ? "sim" : "não"}
                </Text>
                <Text style={[styles.parserBadge, raw ? styles.parserOk : styles.parserMiss]}>
                  {raw ? "NOTIFICAÇÃO: OFERTA RECONHECIDA" : "NOTIFICAÇÃO: NÃO RECONHECEU"}
                </Text>
                {preview.length === 0 ? (
                  <Text style={styles.empty}>Nenhum fragmento operacional sanitizado encontrado nos extras.</Text>
                ) : (
                  preview.map((line, lineIndex) => (
                    <Text key={`${index}-notification-${lineIndex}`} style={styles.snapshotLine}>{line}</Text>
                  ))
                )}
              </View>
            );
          })
        )}

        <Text style={styles.sectionTitle}>Diagnóstico dos snapshots</Text>
        <Text style={styles.diagnosticHint}>
          Mostra somente conteúdo sanitizado e metadados estruturais locais (classe, viewId, bounds, janela, origem e clicável). Um card pode ser marcado como candidato estrutural mesmo quando a Uber não expõe o valor em texto; nesse caso o MotoristaPro não inventa o preço.
        </Text>
        {latestSnapshots.length === 0 ? (
          <Text style={styles.empty}>Nenhum snapshot capturado ainda.</Text>
        ) : (
          latestSnapshots.map((snapshot, index) => {
            const raw = parseAccessibilitySnapshot(snapshot);
            const structural = assessUberStructuralOffer(snapshot);
            const preview = snapshotPreview(snapshot);
            const parserLabel = raw
              ? "PARSER: OFERTA RECONHECIDA"
              : structural.candidate
                ? `ESTRUTURA DE OFERTA CANDIDATA • ${structural.confidence.toUpperCase()} • VALOR INDISPONÍVEL`
                : "PARSER: NÃO RECONHECEU";
            const parserStyle = raw
              ? styles.parserOk
              : structural.candidate
                ? styles.parserCandidate
                : styles.parserMiss;

            return (
              <View key={`${snapshot.fingerprint ?? snapshot.capturedAt ?? index}-${index}`} style={styles.snapshotCard}>
                <Text style={styles.snapshotTitle}>
                  #{snapshots.length - index} • {snapshot.packageName}
                </Text>
                <Text style={styles.snapshotMeta}>
                  {formatCapturedAt(snapshot.capturedAt)} • {snapshot.nodeCount ?? snapshot.nodes?.length ?? 0} nodes
                  {snapshot.truncated ? " • truncado" : ""}
                </Text>
                {snapshot.origins?.length ? (
                  <Text style={styles.snapshotMeta}>origens: {snapshot.origins.join(", ")}</Text>
                ) : null}
                <Text style={[styles.parserBadge, parserStyle]}>{parserLabel}</Text>
                {structural.candidate && !raw ? (
                  <Text style={styles.snapshotMeta}>
                    estrutura: janela {structural.windowId ?? "—"} • {structural.reasons.join(" • ")}
                  </Text>
                ) : null}
                {raw ? (
                  <Text style={styles.snapshotMeta}>
                    bruto: R$ {formatRawAmount(raw.offeredAmount)} • pickup {raw.pickupDistanceKm ?? "—"} km / {raw.pickupDurationMinutes ?? "—"} min • viagem {raw.tripDistanceKm ?? "—"} km / {raw.tripDurationMinutes ?? "—"} min
                  </Text>
                ) : null}
                {preview.length === 0 ? (
                  <Text style={styles.empty}>Snapshot sem texto operacional nem metadado estrutural útil.</Text>
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
  offerText: { color: "#E2E8F0", marginTop: 7, fontWeight: "800" },
  offerMetrics: { color: "#F8FAFC", marginTop: 7, fontSize: 16, fontWeight: "900" },
  offerMeta: { color: "#94A3B8", marginTop: 5, fontSize: 12 },
  diagnosticHint: { color: "#94A3B8", fontSize: 13, lineHeight: 18, marginBottom: 10 },
  snapshotCard: { backgroundColor: "#111827", borderRadius: 12, padding: 14, marginBottom: 12, borderWidth: 1, borderColor: "#334155" },
  snapshotTitle: { color: "#F8FAFC", fontWeight: "900", fontSize: 14 },
  snapshotMeta: { color: "#94A3B8", fontSize: 12, lineHeight: 18, marginTop: 4 },
  parserBadge: { fontSize: 12, fontWeight: "900", marginTop: 8, marginBottom: 6 },
  parserOk: { color: "#4ADE80" },
  parserCandidate: { color: "#FBBF24" },
  parserMiss: { color: "#F87171" },
  snapshotLine: { color: "#CBD5E1", fontSize: 12, lineHeight: 17, marginTop: 3 }
});