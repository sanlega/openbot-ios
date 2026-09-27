/** LRU screen slot manager (plan WS9: maxScreens 4). */
export interface ScreenSlot {
  botId: string;
  display: number;
  lastUsedAt: number;
}

export class ScreenManager {
  private readonly slots = new Map<string, ScreenSlot>();
  private readonly displayToBot = new Map<number, string>();

  constructor(private readonly maxScreens: number = 4) {}

  assign(botId: string): number {
    const existing = this.slots.get(botId);
    if (existing) {
      existing.lastUsedAt = Date.now();
      return existing.display;
    }

    if (this.slots.size >= this.maxScreens) {
      this.evictOldest();
    }

    const display = this.nextFreeDisplay();
    const slot: ScreenSlot = { botId, display, lastUsedAt: Date.now() };
    this.slots.set(botId, slot);
    this.displayToBot.set(display, botId);
    return display;
  }

  release(botId: string): void {
    const slot = this.slots.get(botId);
    if (!slot) return;
    this.displayToBot.delete(slot.display);
    this.slots.delete(botId);
  }

  getDisplay(botId: string): number | undefined {
    return this.slots.get(botId)?.display;
  }

  private evictOldest(): void {
    let oldest: ScreenSlot | undefined;
    for (const slot of this.slots.values()) {
      if (!oldest || slot.lastUsedAt < oldest.lastUsedAt) oldest = slot;
    }
    if (oldest) this.release(oldest.botId);
  }

  private nextFreeDisplay(): number {
    for (let display = 1; display <= this.maxScreens + 10; display += 1) {
      if (!this.displayToBot.has(display)) return display;
    }
    return this.maxScreens + 1;
  }
}
