import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {
  createTransaction,
  getPendingTransactions,
  processPendingDeletes,
  getPendingDeletes
} from "@/services/TransactionService";
import { syncVehicle, getPendingVehicles } from "@/services/VehicleService";
import { syncMaintenanceEvent, getPendingMaintenanceEvents } from "@/services/MaintenanceService";
import { syncWorkSession, getPendingWorkSessions } from "@/services/WorkSessionService";
import {
  getPendingPreventiveMaintenancePlans,
  syncPreventiveMaintenancePlan
} from "@/services/PreventiveMaintenanceService";
import { getPendingRideOffers, syncRideOffer } from "@/services/RideOfferService";
import { getPendingRideResults, syncRideResult } from "@/services/RideResultService";
import { processRideLifecycleInbox } from "@/services/RideLifecycleInboxService";
import { pullRemoteState } from "@/services/PullSyncService";
import { useAuth } from "@/context/AuthContext";
import type { SyncStatusSnapshot } from "@/types";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000;
const PERIODIC_SYNC_MS = 10_000;
type RetryMeta = { attempts: number; lastAttemptAt: number };
const retryMeta = new Map<string, RetryMeta>();

function canRetryTransaction(id: string, force: boolean): boolean {
  if (force) return true;
  const meta = retryMeta.get(id);
  if (!meta) return true;
  if (meta.attempts >= MAX_ATTEMPTS) return false;
  const delay = BASE_DELAY_MS * Math.pow(2, Math.max(0, meta.attempts - 1));
  return Date.now() - meta.lastAttemptAt >= delay;
}

function registerTransactionAttempt(id: string) {
  const current = retryMeta.get(id);
  retryMeta.set(id, { attempts: (current?.attempts ?? 0) + 1, lastAttemptAt: Date.now() });
}

export function useTransactionSync() {
  const { user, isAuthenticated } = useAuth();
  const [statusReady, setStatusReady] = useState(false);
  const [status, setStatus] = useState<SyncStatusSnapshot>({
    pendingTransactions: 0,
    pendingVehicles: 0,
    pendingMaintenance: 0,
    pendingWorkSessions: 0,
    pendingPreventiveMaintenance: 0,
    pendingRideOffers: 0,
    pendingRideResults: 0,
    pendingDeletes: 0,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastError: null
  });
  const isSyncing = useRef(false);

  const updateStatus = useCallback(async () => {
    if (!user?.id) return;
    const [tx, veh, maint, ws, preventive, rideOffers, rideResults, del] = await Promise.all([
      getPendingTransactions(user.id),
      getPendingVehicles(user.id),
      getPendingMaintenanceEvents(user.id),
      getPendingWorkSessions(user.id),
      getPendingPreventiveMaintenancePlans(user.id),
      getPendingRideOffers(user.id),
      getPendingRideResults(user.id),
      getPendingDeletes(user.id)
    ]);
    setStatus((s) => ({
      ...s,
      pendingTransactions: tx.length,
      pendingVehicles: veh.length,
      pendingMaintenance: maint.length,
      pendingWorkSessions: ws.length,
      pendingPreventiveMaintenance: preventive.length,
      pendingRideOffers: rideOffers.length,
      pendingRideResults: rideResults.length,
      pendingDeletes: del.length
    }));
    setStatusReady(true);
  }, [user?.id]);

  const syncNow = useCallback(async (opts?: { force?: boolean }) => {
    if (!isAuthenticated || !user?.id || isSyncing.current) return;

    // Importa primeiro os recebimentos confirmados no overlay nativo. Isso é local-first:
    // a corrida entra no livro-caixa mesmo sem internet; o sync remoto acontece depois.
    try {
      const lifecycle = await processRideLifecycleInbox(user.id);
      if (lifecycle.errors.length > 0) {
        setStatus((s) => ({ ...s, lastError: lifecycle.errors[0] }));
      }
    } catch (err: any) {
      setStatus((s) => ({ ...s, lastError: err?.message ?? "Falha ao importar corrida concluída." }));
    }

    const net = await NetInfo.fetch();
    if (!net.isConnected || net.isInternetReachable === false) {
      await updateStatus();
      return;
    }

    const force = opts?.force === true;
    isSyncing.current = true;
    setStatus((s) => ({ ...s, lastSyncAttemptAt: new Date().toISOString() }));

    try {
      await processPendingDeletes(user.id, { force });
      const pendingTx = await getPendingTransactions(user.id);
      for (const tx of pendingTx) {
        if (!canRetryTransaction(tx.id, force)) continue;
        registerTransactionAttempt(tx.id);
        await createTransaction(tx);
      }
      for (const vehicle of await getPendingVehicles(user.id)) await syncVehicle(vehicle);
      for (const maintenance of await getPendingMaintenanceEvents(user.id)) await syncMaintenanceEvent(maintenance);
      for (const workSession of await getPendingWorkSessions(user.id)) await syncWorkSession(workSession);
      for (const plan of await getPendingPreventiveMaintenancePlans(user.id)) {
        await syncPreventiveMaintenancePlan(plan);
      }
      for (const rideOffer of await getPendingRideOffers(user.id)) await syncRideOffer(rideOffer);
      for (const rideResult of await getPendingRideResults(user.id)) await syncRideResult(rideResult);

      await pullRemoteState(user.id);

      const [
        stillTx,
        stillVeh,
        stillMaint,
        stillWs,
        stillPreventive,
        stillRideOffers,
        stillRideResults,
        stillDeletes
      ] = await Promise.all([
        getPendingTransactions(user.id),
        getPendingVehicles(user.id),
        getPendingMaintenanceEvents(user.id),
        getPendingWorkSessions(user.id),
        getPendingPreventiveMaintenancePlans(user.id),
        getPendingRideOffers(user.id),
        getPendingRideResults(user.id),
        getPendingDeletes(user.id)
      ]);
      const stillPendingIds = new Set(stillTx.map((tx) => tx.id));
      for (const id of retryMeta.keys()) if (!stillPendingIds.has(id)) retryMeta.delete(id);

      const totalPending =
        stillTx.length +
        stillVeh.length +
        stillMaint.length +
        stillWs.length +
        stillPreventive.length +
        stillRideOffers.length +
        stillRideResults.length +
        stillDeletes.length;
      const exhaustedTransactions = stillTx.filter(
        (tx) => (retryMeta.get(tx.id)?.attempts ?? 0) >= MAX_ATTEMPTS
      );
      setStatus((s) => ({
        ...s,
        pendingTransactions: stillTx.length,
        pendingVehicles: stillVeh.length,
        pendingMaintenance: stillMaint.length,
        pendingWorkSessions: stillWs.length,
        pendingPreventiveMaintenance: stillPreventive.length,
        pendingRideOffers: stillRideOffers.length,
        pendingRideResults: stillRideResults.length,
        pendingDeletes: stillDeletes.length,
        lastSyncSuccessAt: totalPending === 0 ? new Date().toISOString() : s.lastSyncSuccessAt,
        lastError: exhaustedTransactions.length > 0
          ? `${exhaustedTransactions.length} transação(ões) atingiram o limite automático de tentativas. Toque em "Sincronizar agora" para tentar novamente.`
          : totalPending > 0
            ? `${totalPending} item(ns) ainda aguardam sincronização.`
            : null
      }));
      setStatusReady(true);
    } catch (err: any) {
      console.log("[SYNC] erro inesperado no syncNow", err);
      setStatus((s) => ({ ...s, lastError: err?.message ?? "Erro desconhecido" }));
      await updateStatus();
    } finally {
      isSyncing.current = false;
    }
  }, [isAuthenticated, user?.id, updateStatus]);

  const forceSyncNow = useCallback(async () => {
    retryMeta.clear();
    await syncNow({ force: true });
  }, [syncNow]);

  useEffect(() => {
    retryMeta.clear();
    setStatusReady(false);
  }, [user?.id]);

  useEffect(() => {
    if (isAuthenticated) {
      updateStatus();
      syncNow();
    }
  }, [isAuthenticated, syncNow, updateStatus]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") syncNow();
    });
    const netSub = NetInfo.addEventListener((state) => {
      if (state.isConnected && state.isInternetReachable !== false) syncNow();
    });
    return () => {
      appStateSub.remove();
      netSub();
    };
  }, [syncNow]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      syncNow();
    }, PERIODIC_SYNC_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated, syncNow]);

  return { status, statusReady, syncNow: forceSyncNow };
}
