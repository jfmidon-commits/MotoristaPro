import type { RawRideOfferInput } from "@/services/RideOfferNormalizer";

export type CapturePermissionState = "granted" | "denied" | "unavailable" | "unknown";

export interface CaptureAdapter<TPayload = unknown> {
  readonly id: string;
  readonly source: RawRideOfferInput["captureSource"];
  isAvailable(): Promise<boolean>;
  getPermissionState(): Promise<CapturePermissionState>;
  requestPermission?(): Promise<CapturePermissionState>;
  parse(payload: TPayload): RawRideOfferInput | null;
}

export interface RideNotificationPayload {
  packageName?: string | null;
  appLabel?: string | null;
  title?: string | null;
  text?: string | null;
  bigText?: string | null;
  subText?: string | null;
  summaryText?: string | null;
  infoText?: string | null;
  bigContentTitle?: string | null;
  tickerText?: string | null;
  textLines?: string[] | null;
  hasBasicContent?: boolean | null;
  hasExtendedContent?: boolean | null;
  hasOperationalContent?: boolean | null;
  hasTextLines?: boolean | null;
  hasMessages?: boolean | null;
  postedAt?: number | string | Date | null;
}
