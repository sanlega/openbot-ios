import { existsSync, readdirSync } from "node:fs";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Deny patterns that keep an agent's file tool inside `allowed` directories, for agents whose
 * permission rules only have allow and deny (deny wins) and whose `*` crosses folders (Cursor,
 * verified live): "everything except the workspace" cannot be one pattern. So deny every other
 * drive, and along the path to each allowed folder, every sibling that exists now. A folder
 * created later next to an ancestor is not covered: `AcpDriver` also stops a turn that writes
 * outside without asking (`isOutside`).
 */
export function writeFenceDenies(
  allowed: string[],
  options: { maxEntries?: number; listDir?: (dir: string) => string[] } = {},
): string[] {
  const listDir = options.listDir ?? safeList;
  const max = options.maxEntries ?? 2_000;
  const dirs = [...new Set(allowed.map((d) => resolve(d)))];
  const denies: string[] = [];
  const add = (path: string) => {
    if (denies.length < max) denies.push(path, `${path}${sep}**`);
  };

  const roots = new Set(dirs.map((d) => parse(d).root));
  if (process.platform === "win32") {
    for (const letter of "ABCDEFGHIJKLMNOPQRSTUVWXYZ") {
      const root = `${letter}:\\`;
      if (![...roots].some((r) => r.toUpperCase() === root) && existsSync(root)) {
        denies.push(`${letter}:\\**`);
      }
    }
  }

  const walk = (dir: string) => {
    for (const name of listDir(dir)) {
      const full = join(dir, name);
      if (dirs.some((d) => samePath(d, full))) continue;
      if (dirs.some((d) => isInside(d, full))) walk(full);
      else add(full);
    }
  };
  for (const root of roots) walk(root);
  return denies;
}

/** True when `path` is not inside any of `allowed` (relative paths count from `cwd`). */
export function isOutside(path: string, allowed: string[], cwd: string): boolean {
  const full = isAbsolute(path) ? resolve(path) : resolve(cwd, path);
  return !allowed.some((d) => samePath(d, full) || isInside(full, resolve(d)));
}

/** `child` is strictly inside `parent`. */
function isInside(child: string, parent: string): boolean {
  const rel = relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function samePath(a: string, b: string): boolean {
  return relative(resolve(a), resolve(b)) === "";
}

function safeList(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
