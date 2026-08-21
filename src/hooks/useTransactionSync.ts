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
import {
  syncMaintenanceEvent,
  getPendingMaintenanceEvents
} from "@/services/MaintenanceService";
import { syncWorkSession, getPendingWorkSessions } from "@/services/WorkSessionService";
import { useAuth } from "@/context/AuthContext";
import type { SyncStatusSnapshot } from "@/types";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000;

type RetryMeta = {
  attempts: number;
  lastAttemptAt: number;
};

// Controle em memória apenas para cadenciar retries durante a sessão atual.
// O estado persistente continua sendo sync_state/sync_error no SQLite.
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
  retryMeta.set(id, {
    attempts: (current?.attempts ?? 0) + 1,
    lastAttemptAt: Date.now()
  });
}

/**
 * Reprocessa entidades pendentes e deleções quando:
 * - o app volta pro foreground;
 * - a conexão volta;
 * - o usuário loga;
 * - chamado manualmente via syncNow().
 */
export function useTransactionSync() {
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<SyncStatusSnapshot>({
    pendingTransactions: 0,
    pendingVehicles: 0,
    pendingMaintenance: 0,
    pendingWorkSessions: 0,
    pendingDeletes: 0,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastError: null
  });
  const isSyncing = useRef(false);

  const updateStatus = useCallback(async () => {
    if (!user?.id) return;
    const [tx, veh, maint, ws, del] = await Promise.all([
      getPendingTransactions(user.id),
      getPendingVehicles(user.id),
      getPendingMaintenanceEvents(user.id),
      getPendingWorkSessions(user.id),
      getPendingDeletes(user.id)
    ]);
    setStatus((s) => ({
      ...s,
      pendingTransactions: tx.length,
      pendingVehicles: veh.length,
      pendingMaintenance: maint.length,
      pendingWorkSessions: ws.length,
      pendingDeletes: del.length
    }));
  }, [user?.id]);

  const syncNow = useCallback(
    async (opts?: { force?: boolean }) => {
      if (!isAuthenticated || !user?.id || isSyncing.current) return;

      const net = await NetInfo.fetch();
      if (!net.isConnected || net.isInternetReachable === false) {
        console.log("[SYNC] sem conexão de rede — adiando sincronização");
        return;
      }

      const force = opts?.force === true;
      isSyncing.current = true;
      setStatus((s) => ({ ...s, lastSyncAttemptAt: new Date().toISOString() }));

      try {
        // Deleções primeiro para não reenviar registros que o usuário já removeu.
        await processPendingDeletes(user.id);

        const pendingTx = await getPendingTransactions(user.id);
        console.log("[SYNC] reprocessando", pendingTx.length, "transações pendentes");
        for (const tx of pendingTx) {
          if (!canRetryTransaction(tx.id, force)) continue;
          registerTransactionAttempt(tx.id);
          await createTransaction(tx);
        }

        const pendingVeh = await getPendingVehicles(user.id);
        console.log("[SYNC] reprocessando", pendingVeh.length, "veículos pendentes");
        for (const vehicle of pendingVeh) {
          await syncVehicle(vehicle);
        }

        const pendingMaint = await getPendingMaintenanceEvents(user.id);
        console.log("[SYNC] reprocessando", pendingMaint.length, "manutenções pendentes");
        for (const maintenance of pendingMaint) {
          await syncMaintenanceEvent(maintenance);
        }

        const pendingWs = await getPendingWorkSessions(user.id);
        console.log("[SYNC] reprocessando", pendingWs.length, "turnos pendentes");
        for (const workSession of pendingWs) {
          await syncWorkSession(workSession);
        }

        const [stillTx, stillVeh, stillMaint, stillWs, stillDeletes] = await Promise.all([
          getPendingTransactions(user.id),
          getPendingVehicles(user.id),
          getPendingMaintenanceEvents(user.id),
          getPendingWorkSessions(user.id),
          getPendingDeletes(user.id)
        ]);

        // Limpa metadados de retry das transações que já sincronizaram.
        const stillPendingIds = new Set(stillTx.map((tx) => tx.id));
        for (const id of retryMeta.keys()) {
          if (!stillPendingIds.has(id)) retryMeta.delete(id);
        }

        const totalPending =
          stillTx.length +
          stillVeh.length +
          stillMaint.length +
          stillWs.length +
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
          pendingDeletes: stillDeletes.length,
          lastSyncSuccessAt: totalPending === 0 ? new Date().toISOString() : s.lastSyncSuccessAt,
          lastError:
            exhaustedTransactions.length > 0
              ? `${exhaustedTransactions.length} transação(ões) atingiram o limite automático de tentativas. Toque em "Sincronizar agora" para tentar novamente.`
              : totalPending > 0
                ? `${totalPending} item(ns) ainda aguardam sincronização.`
                : null
        }));
      } catch (err: any) {
        console.log("[SYNC] erro inesperado no syncNow", err);
        setStatus((s) => ({ ...s, lastError: err?.message ?? "Erro desconhecido" }));
      } finally {
        isSyncing.current = false;
      }
    },
    [isAuthenticated, user?.id]
  );

  const forceSyncNow = useCallback(async () => {
    retryMeta.clear();
    await syncNow({ force: true });
  }, [syncNow]);

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
      if (state.isConnected && state.isInternetReachable !== false) {
        console.log("[SYNC] conexão restaurada, tentando sincronizar");
        syncNow();
      }
    });
    return () => {
      appStateSub.remove();
      netSub();
    };
  }, [syncNow]);

  return { status, syncNow: forceSyncNow };
}
