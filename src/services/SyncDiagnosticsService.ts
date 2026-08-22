import NetInfo from "@react-native-community/netinfo";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";

export type SyncDiagnosticKey = "environment" | "session" | "network" | "localDatabase" | "remoteDatabase";

export type SyncDiagnosticItem = {
  key: SyncDiagnosticKey;
  label: string;
  ok: boolean;
  detail: string;
};

export type SyncDiagnosticsResult = {
  ok: boolean;
  checkedAt: string;
  items: SyncDiagnosticItem[];
};

type DiagnosticsOptions = {
  supabaseUrl?: string;
  supabaseKey?: string;
};

export async function runSyncDiagnostics(
  userId?: string | null,
  options?: DiagnosticsOptions
): Promise<SyncDiagnosticsResult> {
  const items: SyncDiagnosticItem[] = [];

  const url = options?.supabaseUrl ?? process.env.EXPO_PUBLIC_SUPABASE_URL;
  const key = options?.supabaseKey ?? process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
  const environmentOk = Boolean(url && key);
  items.push({
    key: "environment",
    label: "Configuração Supabase",
    ok: environmentOk,
    detail: environmentOk ? "URL e chave pública configuradas." : "Faltam URL ou chave pública do Supabase."
  });

  const net = await NetInfo.fetch();
  const networkOk = Boolean(net.isConnected && net.isInternetReachable !== false);
  items.push({
    key: "network",
    label: "Internet",
    ok: networkOk,
    detail: networkOk ? "Conexão disponível." : "Sem acesso à internet no momento."
  });

  try {
    const db = await getDb();
    await db.getFirstAsync("SELECT 1 AS ok");
    items.push({
      key: "localDatabase",
      label: "Banco local",
      ok: true,
      detail: "SQLite acessível."
    });
  } catch (error: any) {
    items.push({
      key: "localDatabase",
      label: "Banco local",
      ok: false,
      detail: error?.message ?? "Falha ao acessar o SQLite."
    });
  }

  let sessionUserId: string | null = null;
  let sessionOk = false;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    sessionUserId = data.session?.user?.id ?? null;
    sessionOk = Boolean(sessionUserId && (!userId || sessionUserId === userId));
    items.push({
      key: "session",
      label: "Sessão",
      ok: sessionOk,
      detail: sessionOk
        ? "Usuário autenticado e sessão coerente."
        : sessionUserId
          ? "A sessão não corresponde ao usuário atual."
          : "Nenhuma sessão autenticada."
    });
  } catch (error: any) {
    items.push({
      key: "session",
      label: "Sessão",
      ok: false,
      detail: error?.message ?? "Falha ao validar a sessão."
    });
  }

  if (!environmentOk || !networkOk || !sessionOk || !sessionUserId) {
    items.push({
      key: "remoteDatabase",
      label: "Supabase remoto",
      ok: false,
      detail: "Teste remoto não executado porque configuração, internet ou sessão não estão prontas."
    });
  } else {
    try {
      const { error } = await supabase
        .from("vehicles")
        .select("id")
        .eq("user_id", sessionUserId)
        .limit(1);
      if (error) throw error;
      items.push({
        key: "remoteDatabase",
        label: "Supabase remoto",
        ok: true,
        detail: "Data API acessível com RLS e sessão atuais."
      });
    } catch (error: any) {
      items.push({
        key: "remoteDatabase",
        label: "Supabase remoto",
        ok: false,
        detail: error?.message ?? "Falha ao consultar o Supabase."
      });
    }
  }

  return {
    ok: items.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    items
  };
}
