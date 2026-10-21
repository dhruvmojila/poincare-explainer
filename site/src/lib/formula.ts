import { Ticker } from './ticker';

/**
 * A formula typeset at build time (see the katex-prerender plugin in vite.config.ts)
 * whose numeric slots `\htmlClass{lf-<name>}{…}` are updated in place; nothing is
 * re-typeset at runtime. Numeric slots tick; text slots are swapped directly.
 */
export class LiveFormula {
  private slots = new Map<string, HTMLElement>();
  private tickers = new Map<string, Ticker>();

  constructor(el: HTMLElement | null, slotNames: string[], digits = 3) {
    if (!el) return;
    for (const name of slotNames) {
      const span = el.querySelector<HTMLElement>(`.lf-${name}`);
      if (span) {
        this.slots.set(name, span);
        this.tickers.set(name, new Ticker(span, (v) => v.toFixed(digits)));
      }
    }
  }

  /** Set a numeric slot (ticks unless `immediate`). */
  set(name: string, value: number, immediate = false): void {
    this.tickers.get(name)?.set(value, immediate);
  }

  /** Set a text slot. */
  text(name: string, text: string): void {
    const span = this.slots.get(name);
    if (span && span.textContent !== text) span.textContent = text;
  }
}
