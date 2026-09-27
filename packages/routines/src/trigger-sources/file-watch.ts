import { watch } from "chokidar";
import type { FSWatcher } from "chokidar";
import type { Routine } from "@openbot/contracts";
import type { CoreContext } from "@openbot/core";
import { newId } from "@openbot/contracts";
import { FILE_WATCH_DEBOUNCE_MS } from "../defaults.js";
import { hashPayload } from "../matcher.js";
import type { RoutineOrchestrator } from "../orchestrator.js";
import { resolveWatchPath } from "./file-watch-paths.js";

export interface FileWatchOptions {
  /** Debounce window before emitting a coalesced trigger (default 300 ms). */
  debounceMs?: number;
}

interface PendingBurst {
  routine: Routine;
  changes: FileChange[];
  timer: ReturnType<typeof setTimeout>;
}

export interface FileChange {
  path: string;
  kind: "add" | "change" | "unlink";
}

/**
 * Workspace file-watch trigger (plan §5 WS12): `chokidar` scoped to the shared
 * workspace and the owning bot's screen directory, with per-routine debounce and
 * burst coalescing before handing off to the orchestrator.
 */
export class FileWatchTriggerSource {
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly pending = new Map<string, PendingBurst>();
  private started = false;

  constructor(
    private readonly ctx: CoreContext,
    private readonly orchestrator: RoutineOrchestrator,
    private readonly options: FileWatchOptions = {},
  ) {}

  private get debounceMs(): number {
    return this.options.debounceMs ?? FILE_WATCH_DEBOUNCE_MS;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    for (const routine of this.ctx.repos.routines.list()) {
      this.syncRoutine(routine);
    }
  }

  stop(): void {
    this.started = false;
    for (const [routineId] of this.watchers) this.unwatch(routineId);
    for (const [routineId, burst] of this.pending) {
      clearTimeout(burst.timer);
      this.pending.delete(routineId);
    }
  }

  syncRoutine(routine: Routine): void {
    if (!this.started) return;
    this.unwatch(routine.id);
    if (!routine.enabled || routine.trigger.type !== "event" || routine.trigger.source !== "file") {
      return;
    }

    const watchPath = resolveWatchPath(this.ctx, routine, routine.trigger.path);
    if (!watchPath) return;

    const watcher = watch(watchPath, {
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 25 },
      depth: 99,
    });

    const onFsEvent = (kind: FileChange["kind"]) => (filePath: string) => {
      this.enqueueChange(routine, { path: filePath, kind });
    };

    watcher.on("add", onFsEvent("add"));
    watcher.on("change", onFsEvent("change"));
    watcher.on("unlink", onFsEvent("unlink"));
    this.watchers.set(routine.id, watcher);
  }

  removeRoutine(routineId: string): void {
    this.unwatch(routineId);
    const burst = this.pending.get(routineId);
    if (burst) {
      clearTimeout(burst.timer);
      this.pending.delete(routineId);
    }
  }

  private unwatch(routineId: string): void {
    const watcher = this.watchers.get(routineId);
    if (watcher) {
      void watcher.close();
      this.watchers.delete(routineId);
    }
  }

  private enqueueChange(routine: Routine, change: FileChange): void {
    const existing = this.pending.get(routine.id);
    if (existing) {
      existing.changes.push(change);
      clearTimeout(existing.timer);
      existing.timer = setTimeout(() => this.flushBurst(routine.id), this.debounceMs);
      return;
    }

    const timer = setTimeout(() => this.flushBurst(routine.id), this.debounceMs);
    this.pending.set(routine.id, { routine, changes: [change], timer });
  }

  private flushBurst(routineId: string): void {
    const burst = this.pending.get(routineId);
    if (!burst) return;
    this.pending.delete(routineId);

    const payload = {
      source: "file" as const,
      changes: burst.changes,
      coalesced: burst.changes.length,
    };

    void this.orchestrator.handleTriggerEvent(burst.routine, {
      id: newId("triggerEvent"),
      source: "file",
      payloadHash: hashPayload(payload),
      payload,
      receivedAt: this.ctx.clock.now().toISOString(),
    });
  }

  /** Test helper: number of active chokidar watchers. */
  activeWatcherCount(): number {
    return this.watchers.size;
  }
}
