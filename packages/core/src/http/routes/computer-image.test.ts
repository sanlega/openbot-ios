import { afterEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type {
  ComputerImageManager,
  ComputerImageStatus,
  ComputerProvider,
} from "@openbot/contracts";
import { buildServer } from "../server.js";
import { createTestContext, type TestContext } from "../../test-helpers.js";

let testContext: TestContext | undefined;
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  await testContext?.cleanup();
  app = undefined;
  testContext = undefined;
});

class FakeImageManager implements ComputerImageManager {
  status: ComputerImageStatus;
  busy = false;
  getCalls: Array<"registry" | "local"> = [];
  resetCalls: boolean[] = [];

  constructor(initial: Partial<ComputerImageStatus> = {}) {
    this.status = {
      state: "missing",
      tag: "ghcr.io/sanlega/openbot-desktop:latest",
      localBuildAvailable: false,
      ...initial,
    };
  }

  getStatus(): ComputerImageStatus {
    return this.status;
  }

  isBusy(): boolean {
    return this.busy;
  }

  async refresh(): Promise<ComputerImageStatus> {
    return this.status;
  }

  async get(source: "registry" | "local" = "registry"): Promise<ComputerImageStatus> {
    this.getCalls.push(source);
    this.busy = true;
    this.status = { ...this.status, state: source === "local" ? "building" : "pulling", source };
    return this.status;
  }

  async reset(removeImage = true): Promise<ComputerImageStatus> {
    this.resetCalls.push(removeImage);
    this.status = { ...this.status, state: "missing" };
    return this.status;
  }
}

async function setup(
  opts: { image?: FakeImageManager; provider?: Partial<ComputerProvider> } = {},
) {
  testContext = await createTestContext();
  const ctx = testContext.ctx;
  if (opts.image) ctx.computerImageManager = opts.image;
  if (opts.provider) {
    ctx.computerProvider = {
      id: "docker",
      status: async () => ({ ready: true }),
      ensureStarted: async () => {},
      screen: async () => {
        throw new Error("not used in these tests");
      },
      ...opts.provider,
    };
  }
  app = await buildServer(ctx);
  return { app, ctx };
}

describe("GET /api/computer/image", () => {
  it("501s until a ComputerImageManager is wired in (matches other WS9 capabilities)", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "GET", url: "/api/computer/image" });
    expect(res.statusCode).toBe(501);
    expect(res.json<{ error: string }>().error).toBe("not_implemented");
  });

  it("returns the current status once wired", async () => {
    const image = new FakeImageManager({ state: "ready" });
    const { app } = await setup({ image });
    const res = await app.inject({ method: "GET", url: "/api/computer/image" });
    expect(res.statusCode).toBe(200);
    expect(res.json<ComputerImageStatus>().state).toBe("ready");
  });
});

describe("POST /api/computer/image/build", () => {
  it("501s until wired in", async () => {
    const { app } = await setup();
    const res = await app.inject({ method: "POST", url: "/api/computer/image/build" });
    expect(res.statusCode).toBe(501);
  });

  it("kicks off a registry pull by default and returns 202 with the in-progress state", async () => {
    const image = new FakeImageManager();
    const { app } = await setup({ image });
    const res = await app.inject({ method: "POST", url: "/api/computer/image/build" });
    expect(res.statusCode).toBe(202);
    expect(res.json<ComputerImageStatus>().state).toBe("pulling");
    expect(image.getCalls).toEqual(["registry"]);
  });

  it("409s when a build/reset is already in progress", async () => {
    const image = new FakeImageManager();
    image.busy = true;
    const { app } = await setup({ image });
    const res = await app.inject({ method: "POST", url: "/api/computer/image/build" });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("already_in_progress");
  });

  it("400s a local build when no local Dockerfile was found (a packaged install)", async () => {
    const image = new FakeImageManager({ localBuildAvailable: false });
    const { app } = await setup({ image });
    const res = await app.inject({
      method: "POST",
      url: "/api/computer/image/build",
      payload: { source: "local" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("local_build_unavailable");
    expect(image.getCalls).toEqual([]);
  });

  it("allows a local build when a local Dockerfile was found", async () => {
    const image = new FakeImageManager({ localBuildAvailable: true });
    const { app } = await setup({ image });
    const res = await app.inject({
      method: "POST",
      url: "/api/computer/image/build",
      payload: { source: "local" },
    });
    expect(res.statusCode).toBe(202);
    expect(image.getCalls).toEqual(["local"]);
  });
});

describe("POST /api/computer/image/reset", () => {
  it("409s when already in progress, otherwise resets with removeImage defaulting true", async () => {
    const image = new FakeImageManager({ state: "ready" });
    const { app } = await setup({ image });
    const res = await app.inject({ method: "POST", url: "/api/computer/image/reset" });
    expect(res.statusCode).toBe(202);
    expect(res.json<{ state: string }>().state).toBe("missing");
    expect(image.resetCalls).toEqual([true]);
  });

  it("passes removeImage: false through", async () => {
    const image = new FakeImageManager({ state: "ready" });
    const { app } = await setup({ image });
    await app.inject({
      method: "POST",
      url: "/api/computer/image/reset",
      payload: { removeImage: false },
    });
    expect(image.resetCalls).toEqual([false]);
  });
});

describe("POST /api/computer/start with an image manager wired", () => {
  it("409s with image_missing instead of calling ensureStarted when the image isn't ready", async () => {
    let started = false;
    const image = new FakeImageManager({ state: "missing" });
    const { app } = await setup({
      image,
      provider: {
        ensureStarted: async () => {
          started = true;
        },
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/computer/start" });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("image_missing");
    expect(started).toBe(false);
  });

  it("proceeds to ensureStarted() once the image is ready", async () => {
    let started = false;
    const image = new FakeImageManager({ state: "ready" });
    const { app } = await setup({
      image,
      provider: {
        ensureStarted: async () => {
          started = true;
        },
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/computer/start" });
    expect(res.statusCode).toBe(200);
    expect(started).toBe(true);
  });

  it("turns an ensureStarted() failure into a structured 500 instead of an unhandled error", async () => {
    const { app } = await setup({
      provider: {
        ensureStarted: async () => {
          throw new Error("No such image: openbot/desktop:latest");
        },
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/computer/start" });
    expect(res.statusCode).toBe(500);
    expect(res.json<{ error: string; reason: string }>()).toMatchObject({
      error: "start_failed",
      reason: "No such image: openbot/desktop:latest",
    });
  });
});
