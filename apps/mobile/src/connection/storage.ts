import * as SecureStore from "expo-secure-store";
import { z } from "zod";

const Credentials = z.object({
  baseUrl: z.string().url(),
  deviceId: z.string().min(1),
  token: z.string().min(1),
  hostPub: z.string().min(1),
  devicePrivateKey: z.string().min(1),
});

export type DeviceCredentials = z.infer<typeof Credentials>;

const STORAGE_KEY = "openbot.device.v1";
const CURSOR_PREFIX = "openbot.cursor.v1.";

export async function loadCredentials(): Promise<DeviceCredentials | undefined> {
  const value = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!value) return undefined;
  try {
    return Credentials.parse(JSON.parse(value));
  } catch {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    return undefined;
  }
}

export async function saveCredentials(credentials: DeviceCredentials): Promise<void> {
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(Credentials.parse(credentials)));
}

export async function clearCredentials(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}

export async function loadEventCursor(deviceId: string): Promise<number> {
  const value = await SecureStore.getItemAsync(`${CURSOR_PREFIX}${deviceId}`);
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export async function saveEventCursor(deviceId: string, cursor: number): Promise<void> {
  await SecureStore.setItemAsync(`${CURSOR_PREFIX}${deviceId}`, String(cursor));
}
