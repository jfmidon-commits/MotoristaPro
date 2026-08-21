import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { createTransaction, getPendingTransactions, processPendingDeletes, getPendingDeletes } from "@/services/TransactionService";
import { syncVehicle, getPendingVehicles } from "@/services/VehicleService";
import { syncMaintenanceEvent, getPendingMaintenanceEvents } from "@/services/MaintenanceService";
import { syncWorkSession, getPendingWorkSessions } from "@/services/WorkSessionService";
import { useAuth } from "@/context/AuthContext";
import type { SyncStatusSnapshot } from "@/types";

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 5000;

// Contador de tentativas em memória por id de transação
const attemptCounts = new Map<string, number>();

/**
 * Reprocessa entidades pendentes (transactions, vehicles, maintenance, work_sessions)
 * e deleções pendentes quando:
 * - o app volta pro foreground;
 * - a conexão volta (NetInfo);
 * - o usuário loga;
 * - chamado manualmente via `syncNow()`.
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
    setStatus(s => ({
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

      isSyncing.current = true;
      setStatus((s) => ({ ...s, lastSyncAttemptAt: new Date().toISOString() }));

      try {
        // 1. Processar deleções pendentes primeiro
        await processPendingDeletes(user.id);

        // 2. Transações pendentes
        const pendingTx = await getPendingTransactions(user.id);
        console.log("[SYNC] reprocessando", pendingTx.length, "transações pendentes");
        for (const tx of pendingTx) {
          const attempts = attemptCounts.get(tx.id) ?? 0;
          if (!opts?.force && attempts >= MAX_ATTEMPTS) {
            console.log("[SYNC] limite de tentativas atingido, pulando", tx.id);
            continue;
          }
          if (!opts?.force && attempts > 0) {
            const delay = BASE_DELAY_MS * Math.pow(2, attempts - 1);
            const elapsed = Date.now() - new Date(tx.created_at).getTime();
            if (elapsed < delay) continue;
          }
          attemptCounts.set(tx.id, attempts + 1);
          await createTransaction(tx);
        }

        // 3. Veículos pendentes
        const pendingVeh = await getPendingVehicles(user.id);
        console.log("[SYNC] reprocessando", pendingVeh.length, "veículos pendentes");
        for (const v of pendingVeh) {
          await syncVehicle(v);
        }

        // 4. Manutenções pendentes
        const pendingMaint = await getPendingMaintenanceEvents(user.id);
        console.log("[SYNC] reprocessando", pendingMaint.length, "manutenções pendentes");
        for (const m of pendingMaint) {
          await syncMaintenanceEvent(m);
        }

        // 5. Work sessions pendentes
        const pendingWs = await getPendingWorkSessions(user.id);
        console.log("[SYNC] reprocessando", pendingWs.length, "turnos pendentes");
        for (const ws of pendingWs) {
          await syncWorkSession(ws);
        }

        await updateStatus();

        const stillPending = await getPendingTransactions(user.id);
        const permanentlyFailed = stillPending.filter(
          (t) => (attemptCounts.get(t.id) ?? 0) >= MAX_ATTEMPTS
        );

        setStatus((s) => ({
          ...s,
          lastSyncSuccessAt: new Date().toISOString(),
          lastError:
            permanentlyFailed.length > 0
              ? `${permanentlyFailed.length} transação(ões) falharam após ${MAX_ATTEMPTS} tentativas. Toque em "Sincronizar agora" para tentar de novo.`
              : null
        }));
      } catch (err: any) {
        console.log("[SYNC] erro inesperado no syncNow", err);
        setStatus((s) => ({ ...s, lastError: err?.message ?? "Erro desconhecido" }));
      } finally {
        isSyncing.current = false;
      }
    },
    [isAuthenticated, user?.id, updateStatus]
  );

  /** Reseta o contador de tentativas — usado pelo botão manual "Sincronizar agora". */
  const forceSyncNow = useCallback(async () => {
    attemptCounts.clear();
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
