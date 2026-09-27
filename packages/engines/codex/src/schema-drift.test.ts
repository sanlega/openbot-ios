import { describe, expect, it } from "vitest";
import { CODEX_SERVER_REQUEST_METHODS } from "./generated/protocol.js";
import { listServerRequestMethods } from "./schema-utils.js";

describe("Codex schema drift", () => {
  it("matches pinned v2 approval methods in ServerRequest.json", async () => {
    const methods = await listServerRequestMethods("codex-schema/ServerRequest.json");
    for (const method of [
      "item/commandExecution/requestApproval",
      "item/fileChange/requestApproval",
      "item/permissions/requestApproval",
    ]) {
      expect(methods).toContain(method);
    }
    expect(CODEX_SERVER_REQUEST_METHODS).toContain("item/commandExecution/requestApproval");
  });
});
