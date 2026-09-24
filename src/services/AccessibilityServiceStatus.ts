import type {
  AccessibilityServicesStatus,
  NativeNotificationPermissionStatus
} from "../../modules/motorista-notification-listener";

export type AccessibilityConfigurationState =
  | "granted"
  | "partial"
  | "denied"
  | "unavailable";

export function getAccessibilityConfigurationState(
  nativeStatus: NativeNotificationPermissionStatus,
  services: AccessibilityServicesStatus
): AccessibilityConfigurationState {
  if (nativeStatus === "unavailable") return "unavailable";

  const hasCaptureService = services.uberCapture || services.capture99;
  if (services.lifecycle && hasCaptureService) return "granted";

  const hasAnyService = services.lifecycle || hasCaptureService;
  return hasAnyService ? "partial" : "denied";
}

export function accessibilityConfigurationLabel(
  state: AccessibilityConfigurationState
): string {
  if (state === "granted") return "Acesso autorizado";
  if (state === "partial") return "Configuração incompleta";
  if (state === "denied") return "Acesso ainda não autorizado";
  return "Recurso nativo indisponível nesta instalação";
}

