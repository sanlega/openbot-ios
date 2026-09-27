import { describe, expect, it } from "vitest";
import { CURATED_CONNECTORS, toCatalogEntry } from "./catalog/curated.js";
import { REMOTE_LAUNCHER_PATH, renderServer, templateKeys } from "./catalog/template.js";
import { matchTool, serverBaseName } from "./connector-service.js";
import { registryEntry, registryPlan, type RegistryServer } from "./mcp-registry.js";
import { assertNoSecrets, containsLikelySecret, redactSecrets } from "./redaction.js";

describe("redaction", () => {
  it("flags and redacts common secret patterns", () => {
    const raw = "authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz0123";
    expect(containsLikelySecret(raw)).toBe(true);
    expect(redactSecrets(raw)).not.toContain("ghp_abcdef");
  });

  it("assertNoSecrets throws on a known secret", () => {
    expect(() => assertNoSecrets("safe output", ["leaked_secret_value"])).not.toThrow();
    expect(() => assertNoSecrets("leaked_secret_value", ["leaked_secret_value"])).toThrow();
  });
});

describe("curated catalogue", () => {
  it("has unique slugs, known categories, and a docs link per entry", () => {
    const slugs = CURATED_CONNECTORS.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).not.toContain("openbot");
    expect(CURATED_CONNECTORS.length).toBeGreaterThanOrEqual(15);
    const categories = new Set([
      "Development",
      "Productivity",
      "Communication",
      "Knowledge",
      "Data",
      "Web",
      "System",
    ]);
    for (const c of CURATED_CONNECTORS) {
      expect(categories.has(c.category), c.slug).toBe(true);
      expect(c.setup?.docsUrl, c.slug).toMatch(/^https:\/\//);
      expect(c.kind).toBe(c.template.transport);
    }
  });

  it("every placeholder has a setup field, and secrets never go into argv", () => {
    for (const c of CURATED_CONNECTORS) {
      const fields = new Map((c.setup?.fields ?? []).map((f) => [f.key, f]));
      const keys = templateKeys(c.template);
      for (const key of [...keys.args, ...keys.secretSafe]) {
        expect(fields.has(key), `${c.slug}: ${key}`).toBe(true);
      }
      for (const key of keys.args) {
        expect(fields.get(key)?.secret, `${c.slug}: ${key} is in argv`).toBe(false);
      }
      if (c.auth === "token") {
        expect(
          [...fields.values()].some((f) => f.secret),
          c.slug,
        ).toBe(true);
      }
      if (c.template.transport === "remote") expect(c.template.url).toMatch(/^https:\/\//);
    }
  });

  it("public entries hide the spawn template", () => {
    const entry = toCatalogEntry(CURATED_CONNECTORS[0]!);
    expect(entry.id).toBe(`curated:${CURATED_CONNECTORS[0]!.slug}`);
    expect(entry).not.toHaveProperty("template");
    expect(entry.connected).toBe(false);
    expect(entry).not.toHaveProperty("connectionId");
  });
});

describe("renderServer", () => {
  it("fills local args and env, dropping groups for empty optional values", () => {
    const spec = renderServer(
      "git",
      {
        transport: "local",
        command: "uvx",
        args: ["mcp-server-git", ["--repository", "${REPO}"]],
        env: { TOKEN: "${TOKEN}", MISSING: "${NOPE}" },
      },
      { TOKEN: "t0k3n" },
    );
    expect(spec).toEqual({
      name: "git",
      command: "uvx",
      args: ["mcp-server-git"],
      env: { TOKEN: "t0k3n" },
    });
  });

  it("runs remote servers through the launcher with headers in env only", () => {
    const secret = "github_pat_supersecretvalue123456";
    const spec = renderServer(
      "github",
      {
        transport: "remote",
        url: "https://api.githubcopilot.com/mcp/",
        headers: { Authorization: "Bearer ${GITHUB_TOKEN}", "X-Optional": "${NONE}" },
      },
      { GITHUB_TOKEN: secret },
    );
    expect(spec.command).toBe(process.execPath);
    expect(spec.args).toEqual([REMOTE_LAUNCHER_PATH]);
    expect(spec.args!.join(" ")).not.toContain(secret);
    expect(spec.env).toEqual({
      OPENBOT_REMOTE_URL: "https://api.githubcopilot.com/mcp/",
      OPENBOT_REMOTE_HEADER_NAMES: "Authorization",
      OPENBOT_REMOTE_HEADER_0: `Bearer ${secret}`,
    });
  });
});

describe("tool matching", () => {
  it("parses Claude MCP names, input fields, and dotted names", () => {
    const servers = ["github", "fs"];
    expect(matchTool("mcp__github__issue_write", {}, servers)).toEqual({
      server: "github",
      tool: "issue_write",
    });
    expect(matchTool("mcp__other__x", {}, servers)).toBeUndefined();
    expect(matchTool("mcpToolCall", { server: "fs", tool: "write_file" }, servers)).toEqual({
      server: "fs",
      tool: "write_file",
    });
    expect(matchTool("fs.read_text_file", {}, servers)).toEqual({
      server: "fs",
      tool: "read_text_file",
    });
    expect(matchTool("Bash", { command: "ls" }, servers)).toBeUndefined();
  });

  it("derives engine-safe server names", () => {
    expect(serverBaseName("curated:github")).toBe("github");
    expect(serverBaseName("registry:io.github.acme/Weather_MCP")).toBe("weather-mcp");
  });
});

describe("MCP Registry mapping", () => {
  const npmServer: RegistryServer = {
    name: "io.github.acme/weather",
    description: "Weather",
    version: "1.2.3",
    packages: [
      {
        registryType: "npm",
        identifier: "@acme/weather-mcp",
        version: "1.2.3",
        transport: { type: "stdio" },
        environmentVariables: [
          { name: "WEATHER_API_KEY", isRequired: true, isSecret: true, description: "Key" },
        ],
      },
    ],
  };

  it("maps an npm package to a pinned npx command with env fields", () => {
    const plan = registryPlan(npmServer);
    expect(plan?.template).toEqual({
      transport: "local",
      command: "npx",
      args: ["-y", "@acme/weather-mcp@1.2.3"],
      env: { WEATHER_API_KEY: "${WEATHER_API_KEY}" },
    });
    const entry = registryEntry(npmServer);
    expect(entry).toMatchObject({
      id: "registry:io.github.acme/weather",
      name: "weather",
      publisher: "io.github.acme",
      category: "Community",
      kind: "local",
      auth: "token",
      verified: false,
      connected: false,
    });
    expect(entry.setup?.fields[0]).toMatchObject({ key: "WEATHER_API_KEY", optional: false });
  });

  it("prefers an HTTPS remote, and reports servers it cannot run", () => {
    const remote = registryPlan({
      name: "x/remote",
      remotes: [{ type: "streamable-http", url: "https://example.com/mcp" }],
    });
    expect(remote?.template).toEqual({
      transport: "remote",
      url: "https://example.com/mcp",
      headers: {},
    });
    const docker: RegistryServer = {
      name: "x/docker",
      packages: [{ registryType: "oci", identifier: "x/y" }],
    };
    expect(registryPlan(docker)).toBeUndefined();
    expect(registryEntry(docker).setup?.steps?.[0]).toMatch(/cannot run/);
  });
});
