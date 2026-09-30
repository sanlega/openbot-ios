import { join, parse, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { isOutside, writeFenceDenies } from "./write-fence.js";

describe("writeFenceDenies", () => {
  it("denies every existing sibling along the path to the workspace, never the path itself", () => {
    const root = parse(resolve("/")).root;
    const tree: Record<string, string[]> = {
      [root]: ["Users", "Windows", "tmp"],
      [join(root, "Users")]: ["me", "other"],
      [join(root, "Users", "me")]: [".openbot", "Desktop", "notes.txt"],
      [join(root, "Users", "me", ".openbot")]: ["workspace", "vault.bin"],
    };
    const workspace = join(root, "Users", "me", ".openbot", "workspace");
    const denies = writeFenceDenies([workspace], { listDir: (d) => tree[d] ?? [] });
    const has = (p: string) => denies.includes(p) && denies.includes(`${p}${sep}**`);
    expect(has(join(root, "Windows"))).toBe(true);
    expect(has(join(root, "Users", "other"))).toBe(true);
    expect(has(join(root, "Users", "me", "Desktop"))).toBe(true);
    expect(has(join(root, "Users", "me", "notes.txt"))).toBe(true);
    expect(has(join(root, "Users", "me", ".openbot", "vault.bin"))).toBe(true);
    for (const p of [workspace, join(root, "Users"), join(root, "Users", "me")]) {
      expect(denies).not.toContain(p);
      expect(denies).not.toContain(`${p}${sep}**`);
    }
  });

  it("keeps several allowed folders open", () => {
    const root = parse(resolve("/")).root;
    const tree: Record<string, string[]> = { [root]: ["a", "b", "c"] };
    const denies = writeFenceDenies([join(root, "a"), join(root, "b")], {
      listDir: (d) => tree[d] ?? [],
    });
    expect(denies.filter((d) => !/^[A-Z]:\\\*\*$/.test(d))).toEqual([
      join(root, "c"),
      `${join(root, "c")}${sep}**`,
    ]);
  });
});

describe("isOutside", () => {
  const ws = resolve("/work/space");
  it("tells inside from outside, relative paths counting from the workspace", () => {
    expect(isOutside(join(ws, "a", "b.txt"), [ws], ws)).toBe(false);
    expect(isOutside("a/b.txt", [ws], ws)).toBe(false);
    expect(isOutside("../escape.txt", [ws], ws)).toBe(true);
    expect(isOutside(resolve("/etc/passwd"), [ws], ws)).toBe(true);
    expect(isOutside(resolve("/work/spaceship/x"), [ws], ws)).toBe(true);
  });
});
