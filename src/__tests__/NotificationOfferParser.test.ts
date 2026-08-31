import { parseRideNotification } from "@/services/NotificationOfferParser";
import { normalizeRideOffer } from "@/services/RideOfferNormalizer";

describe("NotificationOfferParser", () => {
  it("extrai oferta Uber com dois trechos sem persistir texto bruto", () => {
    const raw = parseRideNotification({
      packageName: "com.ubercab.driver",
      appLabel: "Uber Driver",
      title: "Nova solicitação",
      text: "R$ 41,45 • 3,9 km • 8 min • 17,4 km • 35 min",
      postedAt: "2026-08-31T12:00:00.000Z"
    });

    expect(raw).not.toBeNull();
    expect(raw).toMatchObject({
      platform: "uber",
      offeredAmount: "R$ 41,45",
      pickupDistanceKm: 3.9,
      pickupDurationMinutes: 8,
      tripDistanceKm: 17.4,
      tripDurationMinutes: 35,
      captureSource: "notification"
    });

    const normalized = normalizeRideOffer(raw!);
    expect(normalized.offeredAmountCents).toBe(4145);
    expect(normalized.totalExpectedDistanceKm).toBe(21.3);
    expect(normalized.totalExpectedDurationMinutes).toBe(43);
  });

  it("usa métrica única como total esperado", () => {
    const raw = parseRideNotification({
      packageName: "com.taxis99.driver",
      appLabel: "99 Motorista",
      text: "Oferta R$ 18,40 • 7,2 km • 14 minutos"
    });

    expect(raw).toMatchObject({
      platform: "99",
      offeredAmount: "R$ 18,40",
      totalExpectedDistanceKm: 7.2,
      totalExpectedDurationMinutes: 14
    });
  });

  it("ignora notificações sem valor de corrida", () => {
    expect(parseRideNotification({
      packageName: "com.ubercab.driver",
      text: "Você está online"
    })).toBeNull();
  });

  it("ignora apps desconhecidos para reduzir falso positivo", () => {
    expect(parseRideNotification({
      packageName: "com.example.bank",
      text: "R$ 18,40 • 7,2 km • 14 min"
    })).toBeNull();
  });

  it("reconhece inDrive pelo pacote", () => {
    const raw = parseRideNotification({
      packageName: "sinet.startup.inDriver",
      title: "Nova corrida",
      bigText: "R$ 25,00 • 10 km • 20 min"
    });
    expect(raw?.platform).toBe("indrive");
  });
});
