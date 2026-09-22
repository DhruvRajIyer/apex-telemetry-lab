import { animate } from "motion";

const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
const active = new Map<Element, ReturnType<typeof animate>>();

export function stopMotion() {
  active.forEach((animation) => animation.cancel());
  active.clear();
}

function syncPreference() {
  document.documentElement.dataset.reducedMotion = String(preference.matches);
  if (preference.matches) stopMotion();
}

export function reveal(element: Element | null, feedback = false) {
  if (!element) return;
  active.get(element)?.cancel();
  active.delete(element);
  if (preference.matches || !element.getClientRects().length) return;
  const animation = feedback
    ? animate(
        element,
        { scale: [0.98, 1] },
        { type: "spring", stiffness: 550, damping: 32 },
      )
    : animate(
        element,
        { opacity: [0.6, 1], y: [5, 0] },
        { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
      );
  active.set(element, animation);
  void animation.then(() => {
    if (active.get(element) !== animation) return;
    active.delete(element);
    animation.cancel();
  });
}

export function setupMotion() {
  syncPreference();
  preference.addEventListener("change", syncPreference);
  const onClick = (event: MouseEvent) => {
    const button =
      event.target instanceof Element ? event.target.closest("button") : null;
    if (button && !button.disabled) reveal(button, true);
  };
  document.addEventListener("click", onClick);
  return () => {
    stopMotion();
    preference.removeEventListener("change", syncPreference);
    document.removeEventListener("click", onClick);
  };
}
