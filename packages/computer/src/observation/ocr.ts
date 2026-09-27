import { mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { CdpClient } from "./cdp-client.js";
import type { ShellExec } from "./types.js";
import { normalizeElements, type ObservationResult } from "./types.js";

/** OCR fallback via tesseract when DOM/AX yield too few elements. */
export async function observeOcr(
  client: CdpClient,
  shell: ShellExec,
  display: string,
): Promise<ObservationResult> {
  const png = await client.screenshot();
  const dir = await mkdtemp(join(tmpdir(), "openbot-ocr-"));
  const imagePath = join(dir, "screen.png");
  await writeFile(imagePath, png);

  const result = await shell.run("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "11"], {
    ...process.env,
    DISPLAY: display,
  });

  await unlink(imagePath).catch(() => undefined);
  await rmdir(dir).catch(() => undefined);

  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .slice(0, 40);

  const observation = normalizeElements(lines.map((label) => ({ role: "text", label })));
  observation.title = "OCR screen";
  observation.source = "ocr";
  return observation;
}

export async function observeOcrFromFile(
  shell: ShellExec,
  imagePath: string,
  display: string,
): Promise<ObservationResult> {
  const result = await shell.run("tesseract", [imagePath, "stdout", "-l", "eng", "--psm", "11"], {
    ...process.env,
    DISPLAY: display,
  });
  const lines = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .slice(0, 40);
  const observation = normalizeElements(lines.map((label) => ({ role: "text", label })));
  observation.source = "ocr";
  return observation;
}
