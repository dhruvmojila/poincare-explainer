/**
 * Live slots inside the "fig. NN" lines that each card carries. A slot is any element with
 * `data-fig="<name>"`; a scene writes the same text to every element of that name, and only
 * when it changed, so calling this from a scrubbed tween is cheap.
 */
const cache = new Map<string, HTMLElement[]>();

export function setFig(name: string, text: string): void {
  let els = cache.get(name);
  if (!els) {
    els = Array.from(document.querySelectorAll<HTMLElement>(`[data-fig="${name}"]`));
    cache.set(name, els);
  }
  for (const el of els) if (el.textContent !== text) el.textContent = text;
}
