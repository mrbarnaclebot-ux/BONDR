// Shared fake data and helpers for the BONDR mockups. Not product code.
const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function rng(seed) {
  let s = 0;
  for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
const b58 = (seed, n) => { const r = rng(seed); let o = ""; for (let i = 0; i < n; i++) o += B58[Math.floor(r() * 58)]; return o; };
const mintOf = (sym) => b58("mint" + sym, 40) + "bndr";
const sigOf = (seed) => b58("sig" + seed, 87);
const short = (s, a = 4, b = 4) => s.slice(0, a) + "…" + s.slice(-b);

const ICON = {
  ext: '<svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M4.5 2.5h5v5M9.5 2.5 3 9"/></svg>',
  wallet: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M2.5 4.5h10a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-10a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h8"/><circle cx="11" cy="8.5" r=".9" fill="currentColor"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m3 8.5 3 3 7-7"/></svg>',
  lock: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>',
  flame: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 14.5c-2.8 0-4.5-1.9-4.5-4.3 0-2.6 2.2-3.9 2.6-6.7 1.6 1 2.4 2.4 2.5 3.7.6-.6 1-1.4 1.1-2.3 1.5 1.3 2.8 3 2.8 5.3 0 2.4-1.7 4.3-4.5 4.3Z"/><path d="M8 14.5c-1.1 0-1.9-.8-1.9-1.9 0-1.2 1-1.8 1.4-3 .9.6 2.4 1.7 2.4 3 0 1.1-.8 1.9-1.9 1.9Z"/></svg>',
  search: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3.5 3.5"/></svg>',
  copy: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="5" y="5" width="8.5" height="8.5" rx="1"/><path d="M3 10.5V3a.5.5 0 0 1 .5-.5H11"/></svg>',
  warn: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M8 2 14.5 13.5h-13L8 2Z"/><path d="M8 6.5v3.2M8 11.4v.1"/></svg>',
  pause: '<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></svg>',
  left: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M10 3 5 8l5 5"/></svg>',
  right: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 3 5 5-5 5"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m4 4 8 8M12 4l-8 8"/></svg>',
};
const BRAND = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M9 16h14" stroke="var(--secondary)" stroke-width="5" stroke-linecap="round"/><path d="M9 16h9" stroke="var(--accent)" stroke-width="5" stroke-linecap="round"/><circle cx="9" cy="16" r="6.5" fill="var(--accent)"/><circle cx="23" cy="16" r="6" fill="#1a1a1a" stroke="var(--primary)" stroke-width="2.4"/></svg>';

// Generated coin avatar: a small creature in a muted tone, seeded by symbol.
function avatar(sym) {
  const r = rng(sym);
  const h = Math.floor(r() * 360), h2 = (h + 40 + Math.floor(r() * 140)) % 360;
  const shapes = [
    '<circle cx="20" cy="23" r="13"/>',
    '<rect x="7" y="10" width="26" height="25" rx="9"/>',
    '<path d="M20 6 35 34H5Z"/>',
    '<path d="M6 34V18a14 14 0 0 1 28 0v16l-5-4-4.5 4-4.5-4-4.5 4-4.5-4Z"/>',
  ];
  const ey = 19 + Math.floor(r() * 5), gap = 4 + Math.floor(r() * 3);
  return `<svg viewBox="0 0 40 40" aria-hidden="true"><rect width="40" height="40" fill="oklch(0.34 0.05 ${h})"/>
    <g fill="oklch(0.78 0.11 ${h2})">${shapes[Math.floor(r() * shapes.length)]}</g>
    <circle cx="${20 - gap}" cy="${ey}" r="2.4" fill="#1a1a1a"/><circle cx="${20 + gap}" cy="${ey}" r="2.4" fill="#1a1a1a"/>
    <path d="M${17} ${ey + 6}q3 ${r() > 0.5 ? 2.5 : -1.5} 6 0" stroke="#1a1a1a" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>`;
}

// BONDR price in SOL; coin values are shown as SOL equivalents first.
const BONDR_SOL = 0.0000184, SOL_USD = 148.2;

const COINS = [
  ["Grubworm", "GRUB", 61.4, 18.2, 64.2, 4782, 212.6],
  ["Moss Boss", "MOSS", 44.1, 6.4, 51.0, 95, 88.4],
  ["Bog Witch", "BOGW", 72.9, -4.1, 81.7, 220, 140.2],
  ["Kelp Lord", "KELP", 18.6, 42.7, 22.4, 12, 64.9],
  ["Snekpit", "SNEK", 9.2, -12.3, 9.8, 7, 31.2],
  ["Lily Pad", "LILY", 26.5, 3.3, 30.1, 410, 22.5],
  ["Swamp Cat", "SWMP", 88.3, 9.8, 100, 1980, 77.0],
  ["Okra Gang", "OKRA", 12.1, -7.6, 13.9, 3, 19.8],
  ["Leafblower", "LEAF", 5.4, 1.2, 5.9, 1, 4.1],
  ["Mantis Prayer", "MNTS", 33.8, -2.0, 38.6, 760, 12.3],
  ["Fernando", "FERN", 140.7, 5.6, 100, 4320, 51.6],
  ["Toad Hall", "TOAD", 7.7, -21.4, 8.3, 180, 6.6],
  ["Sproutling", "SPRT", 3.1, 0.4, 2.2, 0.5, 2.0],
  ["BONDR", "BONDR", 18400, 3.1, 100, 12960, 940.5],
].map(([name, sym, mcap, ch, bond, ageMin, vol]) => ({ name, sym, mcap, ch, bond, ageMin, vol, mint: mintOf(sym) }));

const fmt = {
  sol: (n, d) => n.toLocaleString("en-US", { minimumFractionDigits: d ?? (n >= 1000 ? 0 : n >= 100 ? 1 : 2), maximumFractionDigits: d ?? (n >= 1000 ? 0 : n >= 100 ? 1 : 2) }),
  usd: (n) => "$" + (n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e3 ? (n / 1e3).toFixed(1) + "K" : n.toFixed(0)),
  pct: (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n).toFixed(1) + "%",
  int: (n) => Math.round(n).toLocaleString("en-US"),
  age: (m) => m < 1 ? Math.round(m * 60) + "s" : m < 60 ? Math.round(m) + "m" : m < 1440 ? Math.floor(m / 60) + "h " + Math.round(m % 60) + "m" : Math.floor(m / 1440) + "d " + Math.floor((m % 1440) / 60) + "h",
};
const txLink = (seed, label) => `<a class="tx" href="https://solscan.io/tx/${sigOf(seed)}" target="_blank" rel="noopener">${label ?? short(sigOf(seed))}${ICON.ext}<span class="sr-only">(opens Solscan)</span></a>`;

function renderHeader(active) {
  const el = document.getElementById("header");
  if (!el) return;
  const link = (href, label, key) => `<a href="${href}"${key === active ? ' aria-current="page"' : ""}>${label}</a>`;
  el.outerHTML = `<header class="site-header"><div class="wrap">
    <a class="brand" href="home.html" aria-label="BONDR home">${BRAND}<span>BONDR</span></a>
    <nav class="nav" aria-label="Main">${link("home.html", "Coins", "home")}${link("launch.html", "Launch", "launch")}${link("token.html", "GRUB", "token")}</nav>
    <div class="header-end">
      <div class="quote-chip"><span>BONDR</span><span class="num" id="bondr-px">${BONDR_SOL.toFixed(7)} SOL</span><span class="num up">+3.1%</span></div>
      <button class="btn btn-quiet" id="connect" data-state="idle">${ICON.wallet}<span>Connect Phantom</span></button>
    </div></div></header>`;
  const btn = document.getElementById("connect");
  btn.addEventListener("click", () => {
    const label = btn.querySelector("span");
    if (btn.dataset.state === "connected") { btn.dataset.state = "idle"; label.textContent = "Connect Phantom"; btn.className = "btn btn-quiet"; return; }
    btn.dataset.state = "busy"; label.textContent = "Opening Phantom…"; btn.disabled = true;
    setTimeout(() => { btn.disabled = false; btn.dataset.state = "connected"; btn.className = "btn btn-solid"; label.innerHTML = '<span class="num">9wRt…e3Fk</span>'; btn.title = "Connected. Click to disconnect."; }, 900);
  });
}

function renderFooter() {
  const el = document.getElementById("footer");
  if (el) el.outerHTML = `<footer class="site-footer"><div class="wrap">
    <span>BONDR adds no platform fee.</span><a href="consent.html#terms">Terms</a>
    <span>Program: pump <span class="num">6EF8…F6P</span></span><a href="index.html">Mockup gallery</a></div></footer>`;
}

// Segmented control: buttons slide an indicator; onChange gets the button.
function initSeg(seg, onChange) {
  const ind = document.createElement("span");
  ind.className = "seg-ind";
  seg.prepend(ind);
  const btns = [...seg.querySelectorAll("button")];
  const attr = btns[0].hasAttribute("aria-selected") ? "aria-selected" : "aria-pressed";
  const place = (b) => { ind.style.width = b.offsetWidth + "px"; ind.style.transform = `translateX(${b.offsetLeft - 2}px)`; };
  btns.forEach((b) => b.addEventListener("click", () => {
    btns.forEach((x) => x.setAttribute(attr, String(x === b)));
    place(b); onChange && onChange(b);
  }));
  const cur = btns.find((b) => b.getAttribute(attr) === "true") || btns[0];
  requestAnimationFrame(() => place(cur));
  addEventListener("resize", () => place(btns.find((b) => b.getAttribute(attr) === "true")));
  document.fonts && document.fonts.ready.then(() => place(btns.find((b) => b.getAttribute(attr) === "true")));
}

function flash(el, dir) {
  el.classList.remove("flash-up", "flash-down");
  void el.offsetWidth;
  el.classList.add(dir >= 0 ? "flash-up" : "flash-down");
}

// Mockup state toggles: [{label, on(), off()}] rendered into #mockbar.
function mockbar(title, groups) {
  const bar = document.getElementById("mockbar");
  if (!bar) return;
  bar.className = "mockbar";
  bar.setAttribute("role", "region"); bar.setAttribute("aria-label", "Mockup state controls");
  bar.innerHTML = `<b>Mockup</b><span>${title}</span>`;
  groups.forEach((g) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = g.label; b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => { const on = b.getAttribute("aria-pressed") !== "true"; b.setAttribute("aria-pressed", String(on)); on ? g.on() : g.off(); });
    bar.append(b);
    if (new URLSearchParams(location.search).has(g.key)) b.click();
  });
  bar.insertAdjacentHTML("beforeend", '<a href="index.html">All screens</a>');
}

// ---- round 2: depth, motif, motion ----
document.documentElement.classList.add("js");

// Shared SVG defs: bond gradient used by every bond motif on the page.
document.addEventListener("DOMContentLoaded", () => {
  document.body.insertAdjacentHTML("afterbegin", '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><linearGradient id="g-bond" x1="0" x2="1"><stop offset="0" style="stop-color:var(--secondary)"/><stop offset="0.6" style="stop-color:var(--accent)"/><stop offset="1" style="stop-color:var(--primary)"/></linearGradient></defs></svg>');
  reveal();
});

// The bond motif: node A (the coin) and node B (the bond) pull together as p goes 0 to 100.
function bondGlyph(p, w = 120, h = 28, label, merged) {
  const t = Math.max(0, Math.min(p, 100)) / 100, r = h * 0.3, cy = h / 2;
  const half = merged ? r * 0.9 : (w / 2 - r - 2) * (1 - 0.32 * t);
  const ax = w / 2 - half, bx = w / 2 + half, fx = ax + (bx - ax) * t;
  const cls = p >= 100 ? "is-bonded" : p >= 90 ? "is-near" : "";
  const sw = r * 0.85;
  return `<svg class="bond ${cls}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${label || (p >= 100 ? "Bonded" : "Curve " + p.toFixed(1) + " percent filled")}">
    <line class="b-track" x1="${ax}" x2="${bx}" y1="${cy}" y2="${cy}" stroke-width="${sw}" stroke-linecap="round"/>
    ${t > 0 ? `<rect class="b-fill" x="${ax}" y="${cy - sw / 2}" width="${Math.max(sw, fx - ax)}" height="${sw}" rx="${sw / 2}"/>` : ""}
    ${p >= 100 ? `<circle class="b-ring" cx="${bx}" cy="${cy}" r="${r}" stroke-width="1.5"/>` : ""}
    <circle class="b-a" cx="${ax}" cy="${cy}" r="${r}"/>
    <circle class="b-b" cx="${bx}" cy="${cy}" r="${r * 0.92}" stroke-width="${Math.max(1.4, r * 0.22)}"/></svg>`;
}

// Scroll-linked reveal: elements with data-reveal fade and spring up once in view.
function reveal(root = document) {
  const els = root.querySelectorAll("[data-reveal]:not(.in)");
  if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
  const io = new IntersectionObserver((entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -6% 0px" });
  els.forEach((e) => io.observe(e));
}

// Drag-to-scroll for horizontal scrollers (mouse only; touch and wheel scroll natively).
function dragScroll(el) {
  let x0 = 0, s0 = 0, down = false, moved = false;
  el.addEventListener("pointerdown", (e) => { if (e.pointerType !== "mouse") return; down = true; moved = false; x0 = e.clientX; s0 = el.scrollLeft; el.style.scrollSnapType = "none"; });
  addEventListener("pointermove", (e) => { if (!down) return; const dx = e.clientX - x0; if (Math.abs(dx) > 4) moved = true; el.scrollLeft = s0 - dx; });
  addEventListener("pointerup", () => { if (!down) return; down = false; el.style.scrollSnapType = ""; });
  el.addEventListener("click", (e) => { if (moved) { e.preventDefault(); moved = false; } }, true);
}
