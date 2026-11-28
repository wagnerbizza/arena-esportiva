const appearanceKey = "arena-aparencia-v1";
const choices = {
  theme: ["dark", "light", "auto"],
  brand: ["blue", "text", "violet", "amber"],
};

export function readAppearance() {
  try {
    const saved = JSON.parse(localStorage.getItem(appearanceKey)) || {};
    return Object.fromEntries(Object.entries(choices)
      .filter(([name, allowed]) => allowed.includes(saved[name]))
      .map(([name]) => [name, saved[name]]));
  } catch {
    return {};
  }
}

let appearance = readAppearance();

export function getAppearance() {
  return appearance;
}

export function setAppearance(patch) {
  appearance = {...appearance, ...patch};
  try { localStorage.setItem(appearanceKey, JSON.stringify(appearance)); } catch {}
}

export function applyAppearance(theme, brand = appearance.brand) {
  const root = document.documentElement;
  root.dataset.theme = theme === "auto"
    ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme;
  root.dataset.brandColor = brand || "blue";
}

export function watchAppearance(update) {
  window.addEventListener("storage", event => {
    if (event.key !== appearanceKey && event.key !== null) return;
    appearance = readAppearance();
    update();
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", update);
}
