import { router } from "expo-router";
import { useEffect } from "react";
import { useConnection } from "@/connection/ConnectionProvider";

/**
 * Development builds only: lets a debugger session (Metro's CDP endpoint) navigate
 * and pair the simulator, which has no camera and no scripted touch input.
 */
export function DevBridge() {
  const { pair, client } = useConnection();
  useEffect(() => {
    if (!__DEV__) return;
    (globalThis as { __openbotDev?: unknown }).__openbotDev = { router, pair, client };
  }, [pair, client]);
  return null;
}
