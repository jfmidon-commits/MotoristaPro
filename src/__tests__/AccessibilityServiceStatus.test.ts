import {
  accessibilityConfigurationLabel,
  getAccessibilityConfigurationState
} from "@/services/AccessibilityServiceStatus";

describe("AccessibilityServiceStatus", () => {
  it("accepts lifecycle plus either supported capture service", () => {
    expect(getAccessibilityConfigurationState("granted", {
      uberCapture: true,
      capture99: false,
      lifecycle: true
    })).toBe("granted");

    expect(getAccessibilityConfigurationState("granted", {
      uberCapture: false,
      capture99: true,
      lifecycle: true
    })).toBe("granted");
  });

  it("shows a partial setup instead of incorrectly saying that nothing is authorized", () => {
    expect(getAccessibilityConfigurationState("denied", {
      uberCapture: true,
      capture99: true,
      lifecycle: false
    })).toBe("partial");
    expect(accessibilityConfigurationLabel("partial")).toBe("Configuração incompleta");
  });

  it("keeps unavailable installations distinct from disabled services", () => {
    expect(getAccessibilityConfigurationState("unavailable", {
      uberCapture: false,
      capture99: false,
      lifecycle: false
    })).toBe("unavailable");
    expect(getAccessibilityConfigurationState("denied", {
      uberCapture: false,
      capture99: false,
      lifecycle: false
    })).toBe("denied");
  });
});

