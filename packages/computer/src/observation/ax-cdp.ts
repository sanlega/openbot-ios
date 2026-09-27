import type { CdpClient } from "./cdp-client.js";
import { normalizeElements, type ObservationResult } from "./types.js";

interface AxNode {
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: string };
  backendDOMNodeId?: number;
  childIds?: string[];
}

export async function observeAx(client: CdpClient): Promise<ObservationResult> {
  const tree = (await client.axTree()) as { nodes?: AxNode[] };
  const nodes = tree.nodes ?? [];
  const items: Array<{ role: string; label: string; value?: string; backendNodeId?: number }> = [];

  for (const node of nodes) {
    const role = node.role?.value ?? "unknown";
    const label = node.name?.value?.trim() ?? "";
    if (!label && role === "generic") continue;
    if (!label && !node.value?.value) continue;
    items.push({
      role,
      label: label || role,
      value: node.value?.value,
      backendNodeId: node.backendDOMNodeId,
    });
    if (items.length >= 80) break;
  }

  const pageInfo = await client.evaluate<{ url: string; title: string }>(`({
    url: location.href,
    title: document.title,
  })`);

  const observation = normalizeElements(items);
  observation.url = pageInfo?.url;
  observation.title = pageInfo?.title;
  observation.source = "ax";
  return observation;
}
