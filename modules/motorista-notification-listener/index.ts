import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeNotificationPermissionStatus = "granted" | "denied" | "unavailable";

export interface CapturedRideNotification {
  packageName: string;
  notificationKey?: string | null;
  postedAt?: number | null;
  appLabel?: string | null;
  title?: string | null;
  text?: string | null;
  bigText?: string | null;
  subText?: string | null;
  summaryText?: string | null;
  infoText?: string | null;
  bigContentTitle?: string | null;
  tickerText?: string | null;
  textLines?: string[];
  hasBasicContent?: boolean | null;
  hasExtendedContent?: boolean | null;
  hasOperationalContent?: boolean | null;
  hasTextLines?: boolean | null;
  hasMessages?: boolean | null;
}

export interface AccessibilityNodeSnapshot {
  text?: string | null;
  viewId?: string | null;
  className?: string | null;
  left?: number | null;
  top?: number | null;
  right?: number | null;
  bottom?: number | null;
  clickable?: boolean | null;
  origin?: "eventText" | "eventDescription" | "eventSource" | "activeRoot" | "window" | string | null;
  windowId?: number | null;
}

export interface AccessibilitySnapshot {
  packageName: string;
  eventType?: number | null;
  capturedAt?: number | null;
  nodeCount?: number | null;
  nodes?: AccessibilityNodeSnapshot[];
  fingerprint?: string | null;
  truncated?: boolean | null;
  origins?: string[];
}

export type RideLifecycleNativeState = "offer" | "in_progress" | "ended" | "payment_confirmed" | "stale_reset";
export type RideLifecycleNativePaymentMethod = "cash" | "pix" | "app";

export interface RideLifecycleNativeEvent {
  platform: "uber" | "99";
  state: RideLifecycleNativeState;
  detectedAt: number;
  paymentMethod?: RideLifecycleNativePaymentMethod | null;
}

type NativeModuleShape = {
  getPermissionStatus(): NativeNotificationPermissionStatus;
  openNotificationAccessSettings(): boolean;
  getPendingNotificationsJson(): string;
  clearPendingNotifications(): boolean;
  getAccessibilityPermissionStatus(): NativeNotificationPermissionStatus;
  getRideLifecyclePermissionStatus(): NativeNotificationPermissionStatus;
  openAccessibilitySettings(): boolean;
  getPendingAccessibilitySnapshotsJson(): string;
  clearPendingAccessibilitySnapshots(): boolean;
  getPendingRideLifecycleEventsJson(): string;
  clearPendingRideLifecycleEvents(): boolean;
};

const NativeModule = requireOptionalNativeModule<NativeModuleShape>("MotoristaNotificationListener");

export function getNotificationAccessStatus(): NativeNotificationPermissionStatus {
  return NativeModule?.getPermissionStatus() ?? "unavailable";
}

export function openNotificationAccessSettings(): boolean {
  return NativeModule?.openNotificationAccessSettings() ?? false;
}

export function getPendingRideNotifications(): CapturedRideNotification[] {
  if (!NativeModule) return [];
  try {
    const parsed = JSON.parse(NativeModule.getPendingNotificationsJson());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearPendingRideNotifications(): boolean {
  return NativeModule?.clearPendingNotifications() ?? false;
}

export function getAccessibilityAccessStatus(): NativeNotificationPermissionStatus {
  return NativeModule?.getAccessibilityPermissionStatus() ?? "unavailable";
}

export function getRideLifecycleAccessStatus(): NativeNotificationPermissionStatus {
  return NativeModule?.getRideLifecyclePermissionStatus() ?? "unavailable";
}

export function openAccessibilitySettings(): boolean {
  return NativeModule?.openAccessibilitySettings() ?? false;
}

export function getPendingAccessibilitySnapshots(): AccessibilitySnapshot[] {
  if (!NativeModule) return [];
  try {
    const parsed = JSON.parse(NativeModule.getPendingAccessibilitySnapshotsJson());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearPendingAccessibilitySnapshots(): boolean {
  return NativeModule?.clearPendingAccessibilitySnapshots() ?? false;
}

export function getPendingRideLifecycleEvents(): RideLifecycleNativeEvent[] {
  if (!NativeModule) return [];
  try {
    const parsed = JSON.parse(NativeModule.getPendingRideLifecycleEventsJson());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearPendingRideLifecycleEvents(): boolean {
  return NativeModule?.clearPendingRideLifecycleEvents() ?? false;
}
