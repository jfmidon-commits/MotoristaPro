import { requireNativeModule } from "expo-modules-core";

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

const NativeModule = requireNativeModule<NativeModuleShape>("MotoristaNotificationListener");

export function getNotificationAccessStatus(): NativeNotificationPermissionStatus {
  return NativeModule.getPermissionStatus();
}

export function openNotificationAccessSettings(): boolean {
  return NativeModule.openNotificationAccessSettings();
}

export function getPendingRideNotifications(): CapturedRideNotification[] {
  try {
    const parsed = JSON.parse(NativeModule.getPendingNotificationsJson());
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function clearPendingRideNotifications(): boolean {
  return NativeModule.clearPendingNotifications();
}
