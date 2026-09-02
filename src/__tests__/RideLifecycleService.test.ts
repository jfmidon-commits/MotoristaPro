jest.mock("@/services/RideOfferService", () => ({
  getRideOfferById: jest.fn()
}));

jest.mock("@/services/RideResultService", () => ({
  addRideResult: jest.fn(),
  getRideResultByOfferId: jest.fn()
}));

jest.mock("@/services/TransactionService", () => ({
  addTransaction: jest.fn()
}));

import { incomeCategoryForPlatform, paymentMethodLabel } from "@/services/RideLifecycleService";

describe("RideLifecycleService helpers", () => {
  test("maps quick payment choices to driver-facing labels", () => {
    expect(paymentMethodLabel("cash")).toBe("Dinheiro");
    expect(paymentMethodLabel("pix")).toBe("Pix");
    expect(paymentMethodLabel("app")).toBe("Aplicativo");
  });

  test("maps captured platforms to financial income categories", () => {
    expect(incomeCategoryForPlatform("uber")).toBe("Corrida Uber");
    expect(incomeCategoryForPlatform("99")).toBe("Corrida 99");
    expect(incomeCategoryForPlatform("indrive")).toBe("Corrida inDrive");
    expect(incomeCategoryForPlatform("other")).toBe("Corrida aplicativo");
  });
});
