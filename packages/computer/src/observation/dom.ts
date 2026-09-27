import type { CdpClient } from "./cdp-client.js";
import { normalizeElements, type ObservationResult } from "./types.js";

const DOM_SCRIPT = `(() => {
  const INTERACTIVE = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','SUMMARY']);
  const nodes = Array.from(document.querySelectorAll('a,button,input,select,textarea,[role],[tabindex]'));
  return nodes.slice(0, 80).map((el, index) => {
    const role = el.getAttribute('role') || el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label')
      || el.getAttribute('placeholder')
      || el.getAttribute('name')
      || (el.innerText || '').trim().slice(0, 120)
      || el.tagName.toLowerCase());
    const value = 'value' in el ? String(el.value ?? '') : undefined;
    const rect = el.getBoundingClientRect();
    return {
      role,
      label,
      value,
      selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + ':nth(' + index + ')',
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  }).filter(item => item.label || item.role);
})()`;

export async function observeDom(client: CdpClient): Promise<ObservationResult> {
  const pageInfo = await client.evaluate<{ url: string; title: string }>(`({
    url: location.href,
    title: document.title,
  })`);
  const items = await client.evaluate<
    Array<{
      role: string;
      label: string;
      value?: string;
      bounds?: { x: number; y: number; width: number; height: number };
      selector?: string;
    }>
  >(DOM_SCRIPT);
  const observation = normalizeElements(items ?? []);
  observation.url = pageInfo?.url;
  observation.title = pageInfo?.title;
  observation.source = "dom";
  return observation;
}
