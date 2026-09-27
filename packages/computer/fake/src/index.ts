import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  Action,
  ActResult,
  ComputerProvider,
  ComputerStatus,
  Observation,
  Screen,
} from "@openbot/contracts";

interface PageFixtureElement {
  role: string;
  label: string;
  value?: string;
}

interface PageFixture {
  url: string;
  title: string;
  elements: PageFixtureElement[];
  /** Element index (as a string key) -> name of the page a `click` navigates to. */
  onClick?: Record<string, string>;
}

interface PagesFixture {
  startPage: string;
  pages: Record<string, PageFixture>;
}

const here = dirname(fileURLToPath(import.meta.url));

function loadFixtures(): PagesFixture {
  const raw = readFileSync(join(here, "../fixtures/pages.json"), "utf8");
  return JSON.parse(raw) as PagesFixture;
}

/**
 * A DOM-fixture-backed `ComputerProvider` (plan §5 WS0 fakes list): a tiny
 * scripted "inbox" web app (`fixtures/pages.json`) that responds to
 * `observe`/`act` exactly like a real browser-backed provider would, with no
 * real OS/Docker/browser behind it. Every other workstream's tests/CI drive
 * bots through this instead of `packages/computer/docker`/`local`.
 */
export class FakeComputerProvider implements ComputerProvider {
  readonly id = "fake";
  private started = false;
  private readonly fixtures: PagesFixture;
  private readonly screens = new Map<string, FakeScreen>();

  constructor(fixtures: PagesFixture = loadFixtures()) {
    this.fixtures = fixtures;
  }

  async status(): Promise<ComputerStatus> {
    return { ready: this.started, detail: this.started ? undefined : "not started" };
  }

  async ensureStarted(): Promise<void> {
    this.started = true;
  }

  async screen(botId: string): Promise<Screen> {
    if (!this.started) {
      throw new Error("FakeComputerProvider.screen() called before ensureStarted()");
    }
    let screen = this.screens.get(botId);
    if (!screen) {
      screen = new FakeScreen(this.fixtures);
      this.screens.set(botId, screen);
    }
    return screen;
  }
}

class FakeScreen implements Screen {
  private currentPageName: string;
  private lastObservedIndices: Set<number> | undefined;
  private takenOver = false;

  constructor(private readonly fixtures: PagesFixture) {
    this.currentPageName = fixtures.startPage;
  }

  private get currentPage(): PageFixture {
    const page = this.fixtures.pages[this.currentPageName];
    if (!page) throw new Error(`FakeScreen: unknown page "${this.currentPageName}"`);
    return page;
  }

  async observe(): Promise<Observation> {
    const page = this.currentPage;
    const elements = page.elements.map((el, index) => ({ index, ...el }));
    this.lastObservedIndices = new Set(elements.map((el) => el.index));
    return { url: page.url, title: page.title, elements };
  }

  async act(action: Action): Promise<ActResult> {
    switch (action.op) {
      case "navigate":
        return this.navigate(action.url);
      case "click":
        return this.click(action.target);
      case "type":
      case "select":
        return this.setValue(action.target, action.text);
      case "key":
      case "scroll":
      case "wait":
        return { ok: true };
      case "done":
        return { ok: true };
      case "blocked":
        return { ok: false, blocked: true, reason: "engine reported itself blocked" };
      default:
        return { ok: false, reason: `unsupported op: ${String(action.op)}` };
    }
  }

  async liveView(): Promise<{ url: string; token: string; expiresAt: string }> {
    return {
      url: `https://fake.local/live/${this.currentPageName}`,
      token: "fake-live-token",
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
    };
  }

  async takeover(on: boolean): Promise<void> {
    this.takenOver = on;
  }

  get isTakenOver(): boolean {
    return this.takenOver;
  }

  private navigate(url: string | undefined): ActResult {
    if (!url) return { ok: false, reason: "navigate requires a url" };
    const match = Object.entries(this.fixtures.pages).find(([, page]) => page.url === url);
    if (!match) return { ok: false, reason: `no fixture page has url ${url}` };
    this.currentPageName = match[0];
    this.lastObservedIndices = undefined;
    return { ok: true };
  }

  private requireObservedTarget(target: number | undefined): ActResult | undefined {
    if (target === undefined) return { ok: false, reason: "action requires a target index" };
    if (!this.lastObservedIndices || !this.lastObservedIndices.has(target)) {
      return { ok: false, reason: `index ${target} was not returned by the last observe()` };
    }
    return undefined;
  }

  private click(target: number | undefined): ActResult {
    const invalid = this.requireObservedTarget(target);
    if (invalid) return invalid;
    const nextPage = this.currentPage.onClick?.[String(target)];
    if (nextPage) {
      this.currentPageName = nextPage;
      this.lastObservedIndices = undefined;
    }
    return { ok: true };
  }

  private setValue(target: number | undefined, text: string | undefined): ActResult {
    const invalid = this.requireObservedTarget(target);
    if (invalid) return invalid;
    const element = target !== undefined ? this.currentPage.elements[target] : undefined;
    if (target !== undefined && element) {
      this.currentPage.elements[target] = { ...element, value: text ?? "" };
    }
    return { ok: true };
  }
}
