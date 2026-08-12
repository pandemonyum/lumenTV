import { getPlatform } from "./platform";

const BACK_KEY = 461;
const PLAY_KEY = 415;
const PAUSE_KEY = 19;

function focusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-focusable='true']:not([disabled])"))
    .filter((element) => element.offsetParent !== null);
}

function focusFirst(): void {
  const first = focusableElements()[0];
  if (first && document.activeElement === document.body) first.focus();
}

function moveFocus(direction: "left" | "right" | "up" | "down"): void {
  const elements = focusableElements();
  if (!elements.length) return;
  const current = document.activeElement instanceof HTMLElement && elements.includes(document.activeElement)
    ? document.activeElement
    : elements[0];
  const source = current.getBoundingClientRect();
  const sourceX = source.left + source.width / 2;
  const sourceY = source.top + source.height / 2;

  let best: { element: HTMLElement; score: number } | null = null;
  for (const element of elements) {
    if (element === current) continue;
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const dx = x - sourceX;
    const dy = y - sourceY;
    const valid =
      (direction === "left" && dx < -4) ||
      (direction === "right" && dx > 4) ||
      (direction === "up" && dy < -4) ||
      (direction === "down" && dy > 4);
    if (!valid) continue;
    const primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    const secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    const score = primary + secondary * 2.6;
    if (!best || score < best.score) best = { element, score };
  }
  if (best) {
    best.element.focus();
    try {
      best.element.scrollIntoView({ block: "nearest", inline: "nearest" });
    } catch {
      // Chromium 53 on webOS 4.x only supports the boolean overload.
      best.element.scrollIntoView(false);
    }
  }
}

export function installLgNavigation(): () => void {
  if (getPlatform() !== "webos") return () => {};

  const keydown = (event: KeyboardEvent) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        moveFocus("left");
        break;
      case "ArrowRight":
        event.preventDefault();
        moveFocus("right");
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus("up");
        break;
      case "ArrowDown":
        event.preventDefault();
        moveFocus("down");
        break;
      case "Enter":
        if (document.activeElement instanceof HTMLElement) {
          event.preventDefault();
          document.activeElement.click();
        }
        break;
      default:
        if (event.keyCode === BACK_KEY) {
          event.preventDefault();
          window.history.back();
        } else if (event.keyCode === PLAY_KEY) {
          window.dispatchEvent(new CustomEvent("lumentv:play"));
        } else if (event.keyCode === PAUSE_KEY) {
          window.dispatchEvent(new CustomEvent("lumentv:pause"));
        }
    }
  };

  window.addEventListener("keydown", keydown, true);
  window.setTimeout(focusFirst, 250);
  return () => window.removeEventListener("keydown", keydown, true);
}
