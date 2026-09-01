import { requireOptionalNativeModule } from "expo-modules-core";

export type NativeNotificationPermissionStatus = "granted" | "denied" | "unavailable";

export interface CapturedRideNotification {
  packageName: string;
  notificationKey?: string | null;
  postedAt?: number | null;
  title?: string | null;
  text?: string | null;
  bigText?: string | null;
  subText?: string | null;
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

type NativeModuleShape = {
  getPermissionStatus(): NativeNotificationPermissionStatus;
  openNotificationAccessSettings(): boolean;
  getPendingNotificationsJson(): string;
  clearPendingNotifications(): boolean;
  getAccessibilityPermissionStatus(): NativeNotificationPermissionStatus;
  openAccessibilitySettings(): boolean;
  getPendingAccessibilitySnapshotsJson(): string;
  clearPendingAccessibilitySnapshots(): boolean;
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
