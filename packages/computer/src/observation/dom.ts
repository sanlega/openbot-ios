import type { CdpClient } from "./cdp-client.js";
import { normalizeElements, type ObservationResult } from "./types.js";

const DOM_SCRIPT = `(() => {
  const SELECTOR = 'a,button,input,select,textarea,[role],[tabindex]';
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  // An open modal (cookie consent, sign-in prompt…) blocks the page: list its
  // controls first so they are never cut off by the element limit.
  const modal = Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]'))
    .find((el) => visible(el));
  const pool = modal
    ? [...modal.querySelectorAll(SELECTOR), ...document.querySelectorAll(SELECTOR)]
    : Array.from(document.querySelectorAll(SELECTOR));
  const seen = new Set();
  const nodes = pool.filter((el) => !seen.has(el) && seen.add(el) && visible(el));
  return nodes.slice(0, 80).map((el, index) => {
    const type = el.tagName === 'INPUT' ? (el.getAttribute('type') || 'text').toLowerCase() : '';
    const inputRole = { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', image: 'button', search: 'searchbox', range: 'slider', password: 'password' }[type] || (type ? 'textbox' : '');
    const role = el.getAttribute('role') || inputRole || el.tagName.toLowerCase();
    const label = (el.getAttribute('aria-label')
      || el.getAttribute('placeholder')
      || el.getAttribute('title')
      || (el.innerText || '').trim().slice(0, 120)
      || el.getAttribute('name')
      || el.tagName.toLowerCase());
    // A password field never reveals what is in it, to Jev or anyone else.
    const value = type === 'password' ? (el.value ? '••••••' : '') : ('value' in el ? String(el.value ?? '') : undefined);
    const rect = el.getBoundingClientRect();
    return {
      role,
      label,
      value,
      selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + ':nth(' + index + ')',
      // Viewport CSS pixels: clicked through CDP, not with screen coordinates.
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
    };
  });
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
