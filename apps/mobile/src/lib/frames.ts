/**
 * Desktop builds before the frame fix send each encrypted WebSocket frame as a
 * JSON string ("\"…\""); unwrap it so those hosts keep working.
 */
export function bareFrame(data: string): string {
  if (data.startsWith('"') && data.endsWith('"')) {
    try {
      const inner: unknown = JSON.parse(data);
      if (typeof inner === "string") return inner;
    } catch {
      // Not JSON: fall through and let decryption report the error.
    }
  }
  return data;
}
