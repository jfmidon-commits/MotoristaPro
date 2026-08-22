jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("@react-native-community/netinfo", () => ({ fetch: jest.fn() }));

import NetInfo from "@react-native-community/netinfo";
import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import { runSyncDiagnostics } from "@/services/SyncDiagnosticsService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;
const mockedNetFetch = NetInfo.fetch as jest.MockedFunction<typeof NetInfo.fetch>;
const configuredEnvironment = {
  supabaseUrl: "https://motorista-pro.supabase.co",
  supabaseKey: "public-key"
};

function mockRemoteQuery(error: { message: string } | null = null) {
  const limit = jest.fn().mockResolvedValue({ data: [], error });
  const eq = jest.fn().mockReturnValue({ limit });
  const select = jest.fn().mockReturnValue({ eq });
  (supabase.from as jest.Mock).mockReturnValue({ select });
  return { select, eq, limit };
}

describe("SyncDiagnosticsService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedNetFetch.mockResolvedValue({ isConnected: true, isInternetReachable: true } as never);
    mockedGetDb.mockResolvedValue({ getFirstAsync: jest.fn().mockResolvedValue({ ok: 1 }) } as never);
    mockedGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
      error: null
    } as never);
    mockRemoteQuery();
  });

  it("fica totalmente verde quando ambiente, sessão, rede e bancos estão prontos", async () => {
    const result = await runSyncDiagnostics("user-1", configuredEnvironment);

    expect(result.ok).toBe(true);
    expect(result.items).toHaveLength(5);
    expect(result.items.every((item) => item.ok)).toBe(true);
    expect(supabase.from).toHaveBeenCalledWith("vehicles");
  });

  it("não tenta o remoto quando está offline", async () => {
    mockedNetFetch.mockResolvedValue({ isConnected: false, isInternetReachable: false } as never);

    const result = await runSyncDiagnostics("user-1", configuredEnvironment);

    expect(result.ok).toBe(false);
    expect(result.items.find((item) => item.key === "network")?.ok).toBe(false);
    expect(result.items.find((item) => item.key === "remoteDatabase")?.ok).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("detecta sessão de outro usuário e bloqueia readiness", async () => {
    mockedGetSession.mockResolvedValue({
      data: { session: { user: { id: "user-2" } } },
      error: null
    } as never);

    const result = await runSyncDiagnostics("user-1", configuredEnvironment);

    expect(result.ok).toBe(false);
    expect(result.items.find((item) => item.key === "session")?.ok).toBe(false);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("expõe falha da Data API sem alterar dados", async () => {
    mockRemoteQuery({ message: "RLS denied" });

    const result = await runSyncDiagnostics("user-1", configuredEnvironment);

    expect(result.ok).toBe(false);
    expect(result.items.find((item) => item.key === "remoteDatabase")?.detail).toBe("RLS denied");
  });
});
