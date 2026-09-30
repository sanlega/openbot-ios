import { useEffect, useState } from "react";
import type { ComputerImageStatus } from "@openbot/contracts";
import { useOpenBot } from "../../state/context.js";
import { SettingRow, SettingsGroup, StatusPill } from "./SettingsPrimitives.js";

type Tone = "success" | "warning" | "danger" | "muted" | "accent";

const STATE_LABEL: Record<ComputerImageStatus["state"], string> = {
  missing: "Not downloaded",
  pulling: "Downloading…",
  building: "Building…",
  ready: "Ready",
  error: "Failed",
};

const STATE_TONE: Record<ComputerImageStatus["state"], Tone> = {
  missing: "muted",
  pulling: "accent",
  building: "accent",
  ready: "success",
  error: "danger",
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** Settings > Computer: get/reset the shared desktop image bots use for Computer tasks (D-020). Hidden when this OpenBot isn't using the docker provider — checks `/api/computer/status` first (never fails) so it never has to call the docker-only `/api/computer/image` and hit its 501. */
export function ComputerImageCard() {
  const { transport, state } = useOpenBot();
  const [status, setStatus] = useState<ComputerImageStatus | null>(null);
  const [wired, setWired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void transport
      .get<{ provider?: string }>("/api/computer/status")
      .then((s) => {
        if (cancelled || s.provider !== "docker") return;
        setWired(true);
        return transport.get<ComputerImageStatus>("/api/computer/image").then((image) => {
          if (!cancelled) setStatus(image);
        });
      })
      .catch((err) => {
        if (!cancelled) setError(errorText(err, "Could not load the desktop image status."));
      });
    return () => {
      cancelled = true;
    };
  }, [transport]);

  // Live progress arrives as `computer.image_status` events over the same WS the rest of the app uses.
  useEffect(() => {
    if (state.computerImage) setStatus(state.computerImage);
  }, [state.computerImage]);

  if (!wired) return null;

  const busy = status?.state === "pulling" || status?.state === "building";

  const get = async (source: "registry" | "local") => {
    setError(null);
    setConfirmingReset(false);
    try {
      const next = await transport.post<ComputerImageStatus>("/api/computer/image/build", {
        source,
      });
      setStatus(next);
    } catch (err) {
      setError(errorText(err, "Could not start the download."));
    }
  };

  const reset = async () => {
    setError(null);
    setConfirmingReset(false);
    try {
      await transport.post("/api/computer/image/reset", { removeImage: true });
      setStatus((prev) => (prev ? { ...prev, state: "missing" } : prev));
    } catch (err) {
      setError(errorText(err, "Could not reset the desktop image."));
    }
  };

  return (
    <SettingsGroup title="Desktop image">
      <SettingRow
        label="Computer desktop image"
        help={
          status?.state === "error"
            ? (status.detail ?? "Something went wrong getting the image.")
            : "The shared virtual desktop bots use for Computer tasks. Downloads once, then stays cached."
        }
      >
        <div className="set-inline-actions">
          <StatusPill tone={status ? STATE_TONE[status.state] : "muted"}>
            {status ? STATE_LABEL[status.state] : "…"}
          </StatusPill>
          {confirmingReset ? (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={busy}
                onClick={() => setConfirmingReset(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                disabled={busy}
                onClick={() => void reset()}
              >
                Reset and re-download
              </button>
            </>
          ) : (
            <>
              {status?.state !== "ready" ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={busy}
                  onClick={() => void get("registry")}
                >
                  {busy ? "Working…" : "Get desktop image"}
                </button>
              ) : null}
              {status?.localBuildAvailable && status.state !== "ready" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => void get("local")}
                >
                  Build from source
                </button>
              ) : null}
              {status && status.state !== "missing" ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={busy}
                  onClick={() => setConfirmingReset(true)}
                >
                  Reset
                </button>
              ) : null}
            </>
          )}
        </div>
      </SettingRow>
      {error ? <div className="set-row-error">{error}</div> : null}
    </SettingsGroup>
  );
}
