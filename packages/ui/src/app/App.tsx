import { useEffect, useState } from "react";
import { OpenBotProvider, useLocalTransport } from "../state/context.js";
import type { Transport } from "../transport/index.js";
import { AppShell } from "../components/layout/AppShell.js";
import { SetupWizard } from "../components/setup/SetupWizard.js";

export interface OpenBotAppProps {
  transport: Transport;
}

export function OpenBotApp({ transport }: OpenBotAppProps) {
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);

  useEffect(() => {
    void transport.get<{ setup: { completedAt?: string } }>("/api/setup").then((res) => {
      setSetupComplete(Boolean(res.setup.completedAt));
    });
  }, [transport]);

  if (setupComplete === null) {
    return <div className="empty-state">Connecting…</div>;
  }

  return (
    <OpenBotProvider transport={transport}>
      {setupComplete ? (
        <AppShell />
      ) : (
        <SetupWizard transport={transport} onComplete={() => setSetupComplete(true)} />
      )}
    </OpenBotProvider>
  );
}

export interface DevAppProps {
  apiBaseUrl?: string;
}

/** Dev/demo entry — point at mock server or real harness. */
export function DevApp({ apiBaseUrl = "http://127.0.0.1:3847" }: DevAppProps) {
  const transport = useLocalTransport(apiBaseUrl);
  return <OpenBotApp transport={transport} />;
}
