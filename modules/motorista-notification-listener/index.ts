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

type NativeModuleShape = {
  getPermissionStatus(): NativeNotificationPermissionStatus;
  openNotificationAccessSettings(): boolean;
  getPendingNotificationsJson(): string;
  clearPendingNotifications(): boolean;
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
