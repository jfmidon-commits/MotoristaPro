jest.mock("@/lib/database", () => ({ getDb: jest.fn() }));
jest.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: jest.fn() },
    from: jest.fn()
  }
}));
jest.mock("uuid", () => ({ v4: () => "vehicle-test-id" }));

import { getDb } from "@/lib/database";
import { supabase } from "@/lib/supabase";
import {
  archiveVehicle,
  getVehicleById,
  normalizeVehiclePlate,
  restoreVehicle,
  setDefaultVehicle,
  updateVehicle
} from "@/services/VehicleService";

const mockedGetDb = getDb as jest.MockedFunction<typeof getDb>;
const mockedGetSession = supabase.auth.getSession as jest.MockedFunction<typeof supabase.auth.getSession>;

function createDbMock() {
  return {
    getFirstAsync: jest.fn(),
    getAllAsync: jest.fn().mockResolvedValue([]),
    runAsync: jest.fn().mockResolvedValue(undefined)
  };
}

const vehicleRow = {
  id: "vehicle-1",
  user_id: "user-1",
  name: "Onix",
  plate: "ABC1D23",
  is_default: 0,
  is_archived: 0,
  created_at: "2026-08-21T10:00:00.000Z",
  sync_state: "synced",
  sync_error: null
};

describe("VehicleService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSession.mockResolvedValue({ data: { session: null }, error: null } as never);
  });

  it("normaliza placa removendo pontuação, espaço e diferença de caixa", () => {
    expect(normalizeVehiclePlate(" abc-1d23 ")).toBe("ABC1D23");
    expect(normalizeVehiclePlate("ABC 1D23")).toBe("ABC1D23");
    expect(normalizeVehiclePlate("   ")).toBeNull();
  });

  it("busca veículo sempre filtrando pelo usuário e id", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(vehicleRow);
    mockedGetDb.mockResolvedValue(db as never);

    const result = await getVehicleById("user-1", "vehicle-1");

    expect(result?.is_default).toBe(false);
    expect(result?.is_archived).toBe(false);
    expect(db.getFirstAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE user_id = ? AND id = ?"),
      ["user-1", "vehicle-1"]
    );
  });

  it("edita nome e placa localmente como pending antes do sync", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValueOnce(vehicleRow).mockResolvedValueOnce(null);
    mockedGetDb.mockResolvedValue(db as never);

    const result = await updateVehicle({
      userId: "user-1", vehicleId: "vehicle-1", name: " Onix Plus ", plate: " xyz-9a99 "
    });

    expect(result).toMatchObject({ name: "Onix Plus", plate: "XYZ9A99", sync_state: "pending", sync_error: null });
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("WHERE id = ? AND user_id = ?"),
      ["Onix Plus", "XYZ9A99", "vehicle-1", "user-1"]
    );
  });

  it("rejeita placa já cadastrada em outro veículo do usuário", async () => {
    const db = createDbMock();
    db.getFirstAsync
      .mockResolvedValueOnce(vehicleRow)
      .mockResolvedValueOnce({ id: "vehicle-2", name: "Sentra", is_archived: 0 });
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      updateVehicle({ userId: "user-1", vehicleId: "vehicle-1", name: "Onix", plate: "abc-1d23" })
    ).rejects.toThrow("já está cadastrada");
  });

  it("orienta restaurar quando a placa pertence a veículo arquivado", async () => {
    const db = createDbMock();
    db.getFirstAsync
      .mockResolvedValueOnce(vehicleRow)
      .mockResolvedValueOnce({ id: "vehicle-2", name: "Sentra", is_archived: 1 });
    mockedGetDb.mockResolvedValue(db as never);

    await expect(
      updateVehicle({ userId: "user-1", vehicleId: "vehicle-1", name: "Onix", plate: "ABC1D23" })
    ).rejects.toThrow("Restaure esse veículo");
  });

  it("rejeita edição de veículo que não pertence ao usuário", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(null);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(updateVehicle({ userId: "user-2", vehicleId: "vehicle-1", name: "Onix" }))
      .rejects.toThrow("Veículo não encontrado");
  });

  it("arquiva sem apagar o veículo nem seu histórico", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValueOnce(vehicleRow);
    mockedGetDb.mockResolvedValue(db as never);

    await archiveVehicle("user-1", "vehicle-1");

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET is_archived = 1, is_default = 0"),
      ["vehicle-1", "user-1"]
    );
    expect(db.runAsync).not.toHaveBeenCalledWith(expect.stringContaining("DELETE FROM vehicles"), expect.anything());
  });

  it("restaura veículo arquivado e o torna padrão se não houver outro padrão", async () => {
    const db = createDbMock();
    db.getFirstAsync
      .mockResolvedValueOnce({ ...vehicleRow, is_archived: 1 })
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mockedGetDb.mockResolvedValue(db as never);

    await restoreVehicle("user-1", "vehicle-1");

    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET is_archived = 0"),
      ["vehicle-1", "user-1"]
    );
    expect(db.runAsync).toHaveBeenCalledWith(
      expect.stringContaining("SET is_default = 1"),
      ["vehicle-1", "user-1"]
    );
  });

  it("troca o padrão dentro de transação local", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(vehicleRow);
    db.getAllAsync.mockResolvedValue([{ ...vehicleRow, is_default: 1, sync_state: "pending" }]);
    mockedGetDb.mockResolvedValue(db as never);

    await setDefaultVehicle("user-1", "vehicle-1");

    expect(db.runAsync).toHaveBeenNthCalledWith(1, "BEGIN TRANSACTION");
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining("SET is_default = 0"), ["user-1"]);
    expect(db.runAsync).toHaveBeenCalledWith(expect.stringContaining("SET is_default = 1"), ["vehicle-1", "user-1"]);
    expect(db.runAsync).toHaveBeenCalledWith("COMMIT");
  });

  it("faz rollback se a troca de padrão falhar", async () => {
    const db = createDbMock();
    db.getFirstAsync.mockResolvedValue(vehicleRow);
    db.runAsync.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("falha local")).mockResolvedValueOnce(undefined);
    mockedGetDb.mockResolvedValue(db as never);

    await expect(setDefaultVehicle("user-1", "vehicle-1")).rejects.toThrow("falha local");
    expect(db.runAsync).toHaveBeenCalledWith("ROLLBACK");
  });
});
