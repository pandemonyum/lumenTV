import { getPlatform } from "./platform";

const BACK_KEY = 461;
const PLAY_KEY = 415;
const PAUSE_KEY = 19;

// Permette a un overlay (es. il pannello episodi nel player) di intercettare il tasto Back e
// chiudersi da solo invece di far uscire l'utente dall'intera schermata. Il gestore ritorna true
// se ha gestito lui il tasto, false per lasciar fare il comportamento predefinito.
let backHandler: (() => boolean) | null = null;

export function setBackHandler(handler: (() => boolean) | null): void {
  backHandler = handler;
}

const TEXT_ENTRY_INPUT_TYPES = new Set([
  "text", "search", "email", "password", "tel", "url", "number",
  "date", "time", "datetime-local", "month", "week"
]);

function isTextField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.isContentEditable) return true;
  if (element instanceof HTMLTextAreaElement) return true;
  if (element instanceof HTMLInputElement) return TEXT_ENTRY_INPUT_TYPES.has(element.type);
  return false;
}

function isMultilineField(element: Element | null): boolean {
  if (!(element instanceof HTMLElement)) return false;
  return element.isContentEditable || element instanceof HTMLTextAreaElement;
}

function isRangeField(element: Element | null): boolean {
  return element instanceof HTMLInputElement && element.type === "range";
}

function ancestorHandlesVerticalScroll(start: Element | null, deltaY: number): boolean {
  let node = start;
  while (node && node !== document.documentElement) {
    if (node instanceof HTMLElement) {
      const overflowY = window.getComputedStyle(node).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") {
        const canGoUp = node.scrollTop > 0;
        const canGoDown = node.scrollTop + node.clientHeight < node.scrollHeight;
        if ((deltaY < 0 && canGoUp) || (deltaY > 0 && canGoDown)) return true;
      }
    }
    node = node.parentElement;
  }
  return false;
}

function focusableElements(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-focusable='true']:not([disabled])"))
    .filter((element) => element.offsetParent !== null);
}

function focusFirst(): void {
  const first = focusableElements()[0];
  if (first && document.activeElement === document.body) first.focus();
}

function moveFocus(direction: "left" | "right" | "up" | "down"): boolean {
  const elements = focusableElements();
  if (!elements.length) return false;
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
  if (!best) return false;
  best.element.focus();
  try {
    best.element.scrollIntoView({ block: "nearest", inline: "nearest" });
  } catch {
    // Chromium 53 on webOS 4.x only supports the boolean overload.
    best.element.scrollIntoView(false);
  }
  return true;
}

export function installLgNavigation(): () => void {
  if (getPlatform() !== "webos") return () => {};

  const keydown = (event: KeyboardEvent) => {
    const active = document.activeElement;
    switch (event.key) {
      case "ArrowLeft":
        // Su un campo di testo o su uno slider, sinistra/destra deve muovere il cursore o il
        // valore nativo, non saltare ad un altro elemento.
        if (isTextField(active) || isRangeField(active)) return;
        // preventDefault solo se lo spostamento riesce: se non c'e nulla di focusabile in quella
        // direzione (es. ultima riga di una schermata), si lascia lo scroll nativo della pagina,
        // altrimenti la freccia non farebbe letteralmente nulla.
        if (moveFocus("left")) event.preventDefault();
        break;
      case "ArrowRight":
        if (isTextField(active) || isRangeField(active)) return;
        if (moveFocus("right")) event.preventDefault();
        break;
      case "ArrowUp":
        // Su/giu restano di navigazione anche quando il focus e su uno slider, altrimenti col
        // solo D-pad non ci sarebbe modo di uscirne verso un altro controllo.
        if (isMultilineField(active)) return;
        if (moveFocus("up")) event.preventDefault();
        break;
      case "ArrowDown":
        if (isMultilineField(active)) return;
        if (moveFocus("down")) event.preventDefault();
        break;
      case "Enter":
        if (isTextField(active)) return;
        if (active instanceof HTMLElement) {
          event.preventDefault();
          active.click();
        }
        break;
      default:
        if (event.keyCode === BACK_KEY) {
          event.preventDefault();
          if (!backHandler || !backHandler()) window.history.back();
        } else if (event.keyCode === PLAY_KEY) {
          window.dispatchEvent(new CustomEvent("lumentv:play"));
        } else if (event.keyCode === PAUSE_KEY) {
          window.dispatchEvent(new CustomEvent("lumentv:pause"));
        }
    }
  };

  // Scroll della rotellina ammorbidito manualmente con requestAnimationFrame invece di
  // {behavior: "smooth"}: su Chromium 53 (webOS 4.x) l'overload a oggetto non e garantito,
  // stesso motivo del fallback gia presente su scrollIntoView piu sotto.
  let scrollTarget: number | null = null;
  let scrollFrame: number | null = null;

  const stepScroll = () => {
    if (scrollTarget === null) {
      scrollFrame = null;
      return;
    }
    const current = window.scrollY;
    const diff = scrollTarget - current;
    if (Math.abs(diff) < 1) {
      window.scrollTo(0, scrollTarget);
      scrollTarget = null;
      scrollFrame = null;
      return;
    }
    window.scrollTo(0, current + diff * 0.28);
    scrollFrame = window.requestAnimationFrame(stepScroll);
  };

  const wheel = (event: WheelEvent) => {
    if (!event.deltaY) return;
    // La rotellina del Magic Remote scorre "il contenuto sotto il cursore": se il puntatore e
    // sopra un rail (orizzontale, overflow-y: hidden) l'evento non arriva mai alla pagina.
    // Se nessun antenato puo davvero scorrere in verticale, si scorre la pagina a mano.
    if (ancestorHandlesVerticalScroll(event.target instanceof Element ? event.target : null, event.deltaY)) return;
    const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const base = scrollTarget === null ? window.scrollY : scrollTarget;
    scrollTarget = Math.min(maxScroll, Math.max(0, base + event.deltaY));
    if (scrollFrame === null) scrollFrame = window.requestAnimationFrame(stepScroll);
  };

  window.addEventListener("keydown", keydown, true);
  window.addEventListener("wheel", wheel, { passive: true });

  // Il primo contenuto utile arriva spesso dopo una fetch di rete: si osserva il DOM finche
  // non compare un elemento focusabile, invece di indovinare un singolo timeout fisso che puo
  // scattare a vuoto prima che la schermata finisca di caricare i dati.
  const observer = new MutationObserver(() => {
    focusFirst();
    if (document.activeElement !== document.body) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  focusFirst();
  if (document.activeElement !== document.body) observer.disconnect();

  return () => {
    window.removeEventListener("keydown", keydown, true);
    window.removeEventListener("wheel", wheel);
    if (scrollFrame !== null) window.cancelAnimationFrame(scrollFrame);
    observer.disconnect();
    backHandler = null;
  };
}
