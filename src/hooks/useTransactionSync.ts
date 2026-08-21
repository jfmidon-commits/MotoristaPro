import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { createTransaction, getPendingTransactions } from "@/services/TransactionService";
import { useAuth } from "@/context/AuthContext";
import type { SyncStatusSnapshot } from "@/types";

const MAX_ATTEMPTS = 5;
// Backoff exponencial simples: 5s, 10s, 20s, 40s, 80s
const BASE_DELAY_MS = 5000;

// Contador de tentativas em memória por id de transação (não precisa persistir:
// se o app reiniciar, é razoável dar mais uma chance do zero).
const attemptCounts = new Map<string, number>();

/**
 * Reprocessa transações pendentes/com erro quando:
 * - o app volta pro foreground;
 * - a conexão volta (NetInfo);
 * - o usuário loga;
 * - chamado manualmente via `syncNow()`.
 *
 * Não roda em polling constante — sync é orientado a evento pra não gastar
 * bateria/dados à toa. Transações que falham repetidamente (MAX_ATTEMPTS)
 * ficam marcadas como erro permanente e param de ser retentadas automaticamente,
 * exigindo ação manual do usuário (botão "Sincronizar agora").
 */
export function useTransactionSync() {
  const { user, isAuthenticated } = useAuth();
  const [status, setStatus] = useState<SyncStatusSnapshot>({
    pendingTransactions: 0,
    pendingVehicles: 0,
    pendingMaintenance: 0,
    lastSyncAttemptAt: null,
    lastSyncSuccessAt: null,
    lastError: null
  });
  const isSyncing = useRef(false);

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
        const pending = await getPendingTransactions(user.id);
        console.log("[SYNC] useTransactionSync: reprocessando", pending.length, "transações pendentes");

        for (const tx of pending) {
          const attempts = attemptCounts.get(tx.id) ?? 0;

          if (!opts?.force && attempts >= MAX_ATTEMPTS) {
            console.log("[SYNC] limite de tentativas atingido, pulando", tx.id);
            continue;
          }

          if (!opts?.force && attempts > 0) {
            // respeita o backoff: só tenta de novo depois do delay esperado
            const delay = BASE_DELAY_MS * Math.pow(2, attempts - 1);
            const elapsed = Date.now() - new Date(tx.created_at).getTime();
            if (elapsed < delay) continue;
          }

          attemptCounts.set(tx.id, attempts + 1);
          await createTransaction(tx);
        }

        const stillPending = await getPendingTransactions(user.id);
        const permanentlyFailed = stillPending.filter(
          (t) => (attemptCounts.get(t.id) ?? 0) >= MAX_ATTEMPTS
        );

        setStatus((s) => ({
          ...s,
          pendingTransactions: stillPending.length,
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
    [isAuthenticated, user?.id]
  );

  /** Reseta o contador de tentativas — usado pelo botão manual "Sincronizar agora". */
  const forceSyncNow = useCallback(async () => {
    attemptCounts.clear();
    await syncNow({ force: true });
  }, [syncNow]);

  useEffect(() => {
    if (isAuthenticated) {
      syncNow();
    }
  }, [isAuthenticated, syncNow]);

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
