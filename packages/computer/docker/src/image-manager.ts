import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ComputerImageManager as ComputerImageManagerContract,
  ComputerImageStatus,
} from "@openbot/contracts";
import { DEFAULT_CONTAINER, DEFAULT_IMAGE } from "./docker-provider.js";

/** The slice of dockerode's `Docker` this module needs — mirrors `DockerEngine` in `docker-provider.ts` but for image (not container-lifecycle) operations. */
export interface DockerImageEngine {
  getImage(tag: string): {
    inspect(): Promise<unknown>;
    remove(options?: { force?: boolean }): Promise<unknown>;
  };
  pull(tag: string, options?: unknown): Promise<NodeJS.ReadableStream>;
  modem: {
    followProgress(
      stream: NodeJS.ReadableStream,
      onFinished: (err: Error | null, output: unknown[]) => void,
    ): void;
  };
  listContainers(options?: unknown): Promise<Array<{ Id: string; Names: string[] }>>;
  getContainer(id: string): {
    inspect(): Promise<{ State: { Running: boolean } }>;
    stop(options?: unknown): Promise<unknown>;
    remove(options?: unknown): Promise<unknown>;
  };
}

export interface ImageManagerOptions {
  docker?: DockerImageEngine;
  tag?: string;
  containerName?: string;
  /** Absolute path to a monorepo checkout's `images/desktop/Dockerfile`, when one is reachable (D-020: dev-checkout convenience only). */
  localDockerfile?: string;
  onStatus?: (status: ComputerImageStatus) => void;
  /** Runs `docker build` — overridable so tests never shell out for real. */
  runBuild?: (args: string[]) => Promise<void>;
}

/** Walks up from `startDir` (default: this module's own directory) looking for `images/desktop/Dockerfile`, present only in a monorepo checkout, never in a packaged install (D-020). */
export function findLocalDockerfile(
  startDir: string = dirname(fileURLToPath(import.meta.url)),
): string | undefined {
  let dir = startDir;
  for (let i = 0; i < 8; i++) {
    const candidate = join(dir, "images", "desktop", "Dockerfile");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
  return undefined;
}

function defaultRunBuild(args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, { stdio: "ignore" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`docker build exited with code ${code}`));
    });
  });
}

/**
 * Gets/resets the docker provider's desktop image (D-020: pulled from GHCR by
 * default; local `docker build` is a dev-checkout-only fallback). Distinct
 * from `DockerProvider`, which owns the container's lifecycle once the image
 * is present.
 */
export class ImageManager implements ComputerImageManagerContract {
  private readonly tag: string;
  private readonly containerName: string;
  private readonly runBuild: (args: string[]) => Promise<void>;
  private busy = false;
  private status: ComputerImageStatus;
  private dockerInstance: DockerImageEngine | undefined;

  constructor(private readonly options: ImageManagerOptions = {}) {
    this.tag = options.tag ?? DEFAULT_IMAGE;
    this.containerName = options.containerName ?? DEFAULT_CONTAINER;
    this.runBuild = options.runBuild ?? defaultRunBuild;
    this.status = {
      state: "missing",
      tag: this.tag,
      localBuildAvailable: Boolean(options.localDockerfile),
    };
  }

  getStatus(): ComputerImageStatus {
    return this.status;
  }

  isBusy(): boolean {
    return this.busy;
  }

  private setStatus(next: Partial<ComputerImageStatus>): void {
    this.status = { ...this.status, ...next, tag: this.tag };
    this.options.onStatus?.(this.status);
  }

  /** Lazily resolves dockerode (never imported when a fake `docker` is injected, e.g. in tests). */
  private async docker(): Promise<DockerImageEngine> {
    if (this.options.docker) return this.options.docker;
    if (this.dockerInstance) return this.dockerInstance;
    const Docker = (await import("dockerode")).default;
    this.dockerInstance = new Docker() as unknown as DockerImageEngine;
    return this.dockerInstance;
  }

  /** Refreshes `getStatus()` from Docker without pulling/building (missing <-> ready only; never overwrites an in-progress pulling/building state). */
  async refresh(): Promise<ComputerImageStatus> {
    if (this.busy) return this.status;
    try {
      await (await this.docker()).getImage(this.tag).inspect();
      this.setStatus({ state: "ready", detail: undefined });
    } catch {
      this.setStatus({ state: "missing", detail: undefined });
    }
    return this.status;
  }

  /** Pulls from the registry (default) or builds locally; throws `already_in_progress` if a get/reset is already running. */
  async get(source: "registry" | "local" = "registry"): Promise<ComputerImageStatus> {
    if (this.busy) throw new Error("already_in_progress");
    if (source === "local" && !this.options.localDockerfile) {
      throw new Error("local build isn't available — images/desktop/Dockerfile wasn't found");
    }
    this.busy = true;
    try {
      if (source === "local") await this.buildLocal();
      else await this.pullFromRegistry();
      this.setStatus({ state: "ready", source, detail: undefined });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      this.setStatus({ state: "error", source, detail });
      throw error;
    } finally {
      this.busy = false;
    }
    return this.status;
  }

  /** Stops/removes the container (if any), optionally removes the image, then re-`get()`s — "wipe and start clean" in one call. */
  async reset(removeImage = true): Promise<ComputerImageStatus> {
    if (this.busy) throw new Error("already_in_progress");
    this.busy = true;
    try {
      await this.removeContainerIfPresent();
      if (removeImage) await this.removeImageIfPresent();
      this.setStatus({ state: "missing", source: undefined, detail: undefined });
    } finally {
      this.busy = false;
    }
    return this.get("registry");
  }

  private async pullFromRegistry(): Promise<void> {
    this.setStatus({ state: "pulling", source: "registry", detail: undefined });
    const docker = await this.docker();
    const stream = await docker.pull(this.tag);
    await new Promise<void>((resolvePromise, reject) => {
      docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolvePromise()));
    });
  }

  private async buildLocal(): Promise<void> {
    this.setStatus({ state: "building", source: "local", detail: undefined });
    const dockerfile = this.options.localDockerfile;
    if (!dockerfile) throw new Error("local build isn't available");
    const context = resolve(dirname(dockerfile), "..", "..");
    await this.runBuild(["build", "-t", this.tag, "-f", dockerfile, context]);
  }

  private async removeContainerIfPresent(): Promise<void> {
    const docker = await this.docker();
    const existing = await docker.listContainers({ all: true });
    const match = existing.find((c) => c.Names.some((n) => n === `/${this.containerName}`));
    if (!match) return;
    const container = docker.getContainer(match.Id);
    const info = await container.inspect();
    if (info.State.Running) await container.stop();
    await container.remove();
  }

  private async removeImageIfPresent(): Promise<void> {
    try {
      await (await this.docker()).getImage(this.tag).remove({ force: true });
    } catch {
      // already gone — reset() is idempotent either way.
    }
  }
}

export function createImageManager(options?: ImageManagerOptions): ImageManager {
  return new ImageManager(options);
}
