"use strict";
// ------------------------------------------------------------------ Stream Deck
// Telefon yan (yatay) durunca açılır. Düğmeye basınca sadece düğmenin kimliği gönderilir;
// ne yapılacağını bilgisayar kendi ayarından bilir. Bu ekranda canlı veri akmaz.

const SLOTS = 15;  // sayfa başına düğme: yatayda 5×3, dikeyde 3×5
const MAX_PAGES = 10;
const DECK_ICONS = [
  "play", "pause", "prev", "next", "vol-up", "vol-down", "mute", "music", "headphones", "mic", "video", "camera",
  "desktop", "lock", "moon", "power", "restart", "activity", "app", "globe", "link", "folder", "file", "code",
  "terminal", "keyboard", "type", "message", "gamepad", "calculator", "zap", "star", "home",
  "spotify", "discord", "steam", "brave",
];
const DECK_COLORS = ["", "#9db8ff", "#4ade80", "#5eead4", "#ffd166", "#ff8a5c", "#ff7b7b", "#f9a8d4", "#c4b5fd"];
const ACTION_TYPES = {
  media: "Medya", volume: "Ses", app: "Uygulama aç", url: "Web sitesi aç", open: "Dosya / klasör aç",
  hotkey: "Klavye kısayolu", text: "Metin yaz", power: "Güç", multi: "Çoklu eylem", wait: "Bekle",
};
const ACTION_DEFAULTS = {
  media: { v: "toggle" }, volume: { step: 10 }, app: { target: "" }, url: { url: "https://" }, open: { path: "" },
  hotkey: { keys: "" }, text: { text: "" }, power: { v: "lock" }, wait: { ms: 500 },
  multi: { steps: [{ type: "hotkey", keys: "" }] },
};
const deck = { page: 0, editing: false, draft: null, wakeLock: null, drag: null, noClick: false, ping: 0 };
const pagesEl = $("#deck-pages");

// ------------------------------------------------------------------ Görünüm
function keyFace(b) {
  const brand = BRANDS[b.icon] ? b.icon : null;
  const color = b.color || (brand ? BRANDS[brand] : "");
  const id = brand ? `b-${brand}` : DECK_ICONS.includes(b.icon) ? `i-${b.icon}` : null;
  const icon = id ? `<svg><use href="#${id}"/></svg>` : `<b class="k-letter">${escapeHtml((b.label || "?")[0].toUpperCase())}</b>`;
  return { color, html: `${icon}<span class="k-label">${escapeHtml(b.label)}</span>` };
}

function keyHtml(b, slot) {
  if (!b) {
    return `<div class="slot"><button class="key empty" data-slot="${slot}" aria-label="Boş">${deck.editing ? '<svg><use href="#i-plus"/></svg>' : ""}</button></div>`;
  }
  const f = keyFace(b);
  return `<div class="slot"><button class="key" data-slot="${slot}"${f.color ? ` style="--c:${escapeHtml(f.color)}"` : ""}>${f.html}</button></div>`;
}

const deckPages = () => (deck.editing ? deck.draft : state.deck)?.pages || [];

function renderDeck() {
  const pages = deckPages();
  deck.page = Math.min(deck.page, Math.max(0, pages.length - 1));
  $("#deck").classList.toggle("editing", deck.editing);
  $("#deck-tabs").innerHTML = pages.map((p, i) => `<button class="deck-tab" data-page="${i}">${escapeHtml(p.name)}</button>`).join("")
    + (deck.editing && pages.length < MAX_PAGES ? '<button class="deck-tab add" data-page="new" aria-label="Sayfa ekle"><svg><use href="#i-plus"/></svg></button>' : "");
  $("#deck-tabs").classList.toggle("single", pages.length < 2 && !deck.editing);
  pagesEl.innerHTML = pages.map((p) =>
    `<div class="deck-page">${Array.from({ length: SLOTS }, (_, i) => keyHtml(p.buttons[i], i)).join("")}</div>`).join("");
  pagesEl.scrollLeft = deck.page * pagesEl.clientWidth;
  markTab();
  renderDeckBar();
}

function markTab() {
  $$(".deck-tab", $("#deck-tabs")).forEach((t) => t.classList.toggle("on", +t.dataset.page === deck.page));
}

function goPage(i) {
  deck.page = i;
  markTab();
  pagesEl.scrollTo({ left: i * pagesEl.clientWidth, behavior: "smooth" });
}

// app.js her mesajda çağırır: bağlantı durumu ve uyarı yazısı
function renderDeckBar() {
  const pc = state.broker !== "on" ? "wait" : state.pc === "online" ? "on" : state.pc === "login" ? "login" : "off";
  $("#deck").dataset.pc = pc;
  $("#deck-status").className = `link glass ${pc === "on" ? "on" : pc === "off" ? "off" : "wait"}`;
  // Son basışın gidip gelme süresi (telefon → EMQX → bilgisayar → telefon)
  $("#deck-ping").textContent = pc === "on" && deck.ping ? `${deck.ping} ms` : state.info?.hostname || "Bilgisayar";
  const msg = pc === "wait" ? "Bağlanıyor…"
    : pc === "off" ? "Bilgisayar kapalı"
    : pc === "login" ? "Giriş ekranında bekliyor"
    : !state.deck ? "Düğmeler bekleniyor… (bilgisayardaki panelin güncel olması gerekir)" : "";
  $("#deck-msg").textContent = msg;
  $("#deck-msg").classList.toggle("hidden", !msg || deck.editing);
  const editOk = pc === "on" && !!state.deck;
  $("#deck-edit").disabled = !editOk;
  $("#deck-edit").classList.toggle("hidden", deck.editing);
  $("#deck-back").classList.toggle("hidden", deck.editing);
  $("#deck-cancel").classList.toggle("hidden", !deck.editing);
  $("#deck-save").classList.toggle("hidden", !deck.editing);
}

// Bilgisayardan yeni düğme listesi geldi (düzenlerken taslağa dokunma)
function deckChanged() {
  if (state.view === "deck" && !deck.editing) renderDeck();
}

// ------------------------------------------------------------------ Ana ekran ↔ deck
function setView(v, force = false) {
  if (v === state.view || (!force && (deck.editing || !$("#deck-modal").classList.contains("hidden")))) return;
  if (v === "main" && deck.editing) { deck.editing = false; deck.draft = null; closeModal(); }
  state.view = v;
  document.body.classList.toggle("deck-open", v === "deck");
  if (v === "deck") { renderDeck(); keepAwake(true); } else { keepAwake(false); startWatching(); }
}

// Ekran kapanmasın (iOS 16.4+; desteklemiyorsa sessizce geçer)
async function keepAwake(on) {
  try {
    if (on && !deck.wakeLock && !document.hidden && "wakeLock" in navigator) {
      deck.wakeLock = await navigator.wakeLock.request("screen");
      deck.wakeLock.addEventListener("release", () => { deck.wakeLock = null; });
    } else if (!on && deck.wakeLock) {
      const lock = deck.wakeLock;
      deck.wakeLock = null;
      await lock.release();
    }
  } catch {}
}
document.addEventListener("visibilitychange", () => { if (!document.hidden && state.view === "deck") keepAwake(true); });

const landscape = matchMedia("(orientation: landscape)");
landscape.addEventListener("change", (e) => {
  if (!$("#app").classList.contains("hidden")) setView(e.matches ? "deck" : "main");
});
addEventListener("resize", () => { pagesEl.scrollLeft = deck.page * pagesEl.clientWidth; });

$("#btn-deck").addEventListener("click", () => setView("deck"));
$("#deck-back").addEventListener("click", () => setView("main"));

// ------------------------------------------------------------------ Basma
async function pressKey(el, b) {
  const a = b.action;
  if (a.type === "power" && (a.v === "restart" || a.v === "shutdown")) {
    const [title, text, ok, style] = POWER_TEXT[a.v];
    if (!(await sheet(title, text, { ok, style }))) return;
  }
  el.classList.remove("ok", "err");
  el.classList.add("fire");
  const t0 = performance.now();
  const ack = await send("deck", b.id);
  el.classList.remove("fire");
  if (ack?.ok) { deck.ping = Math.round(performance.now() - t0); renderDeckBar(); }
  el.classList.add(ack?.ok ? "ok" : "err");
  setTimeout(() => el.classList.remove("ok", "err"), 650);
}

pagesEl.addEventListener("click", (e) => {
  const el = e.target.closest(".key");
  if (!el || deck.noClick) return;
  const slot = +el.dataset.slot;
  if (deck.editing) return editKey(slot);
  const b = state.deck?.pages[deck.page]?.buttons[slot];
  if (b?.id) pressKey(el, b);
});

pagesEl.addEventListener("scroll", () => {
  if (deck.editing) return;
  const i = Math.round(pagesEl.scrollLeft / pagesEl.clientWidth);
  if (i !== deck.page) { deck.page = i; markTab(); }
}, { passive: true });

$("#deck-tabs").addEventListener("click", (e) => {
  const t = e.target.closest(".deck-tab");
  if (!t) return;
  if (t.dataset.page === "new") {
    deck.draft.pages.push({ name: `Sayfa ${deck.draft.pages.length + 1}`, buttons: Array(SLOTS).fill(null) });
    deck.page = deck.draft.pages.length - 1;
    return renderDeck();
  }
  const i = +t.dataset.page;
  if (deck.editing && i === deck.page) return editPage(i);
  goPage(i);
});

// ------------------------------------------------------------------ Düzenleme
$("#deck-edit").addEventListener("click", () => {
  if (!state.deck) return;
  deck.draft = structuredClone(state.deck);
  deck.draft.pages.forEach((p) => { p.buttons = Array.from({ length: SLOTS }, (_, i) => p.buttons[i] ?? null); });
  deck.editing = true;
  renderDeck();
  toast("Düzenlemek için dokun, taşımak için sürükle");
});

const draftJson = () => JSON.stringify({
  pages: deck.draft.pages.map((p) => {
    const buttons = p.buttons.slice(0, SLOTS);
    while (buttons.length && !buttons[buttons.length - 1]) buttons.pop();  // sondaki boş yuvalar gönderilmez
    return { name: p.name, buttons };
  }),
});

$("#deck-cancel").addEventListener("click", async () => {
  const before = JSON.stringify({ pages: state.deck.pages.map((p) => ({ name: p.name, buttons: p.buttons })) });
  if (draftJson() !== before && !(await sheet("Değişiklikler silinsin mi?", "Kaydetmediğin değişiklikler kaybolacak.", { ok: "Sil", cancel: "Düzenlemeye dön" }))) return;
  deck.editing = false;
  deck.draft = null;
  renderDeck();
});

$("#deck-save").addEventListener("click", async () => {
  const payload = JSON.parse(draftJson());
  $("#deck-save").disabled = true;
  const ack = await send("deck_set", payload);
  $("#deck-save").disabled = false;
  if (!ack?.ok) return;  // hata mesajını send() gösterir; düzenleme açık kalır
  state.deck = payload;  // bilgisayar kimlikleri ekleyip kalıcı mesajla hemen tekrar gönderecek
  deck.editing = false;
  deck.draft = null;
  renderDeck();
  toast("✅ Deck kaydedildi");
});

// Sürükle-bırak: düğmeyi başka bir yuvaya (yer değiştirir) ya da başka sayfanın sekmesine bırak
pagesEl.addEventListener("pointerdown", (e) => {
  const key = deck.editing && e.target.closest(".key:not(.empty)");
  if (key) deck.drag = { key, id: e.pointerId, x: e.clientX, y: e.clientY, ghost: null, over: null };
});

addEventListener("pointermove", (e) => {
  const d = deck.drag;
  if (!d || e.pointerId !== d.id) return;
  if (!d.ghost) {
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 8) return;
    const r = d.key.getBoundingClientRect();
    d.ghost = d.key.cloneNode(true);
    d.ghost.classList.add("ghost");
    Object.assign(d.ghost.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    document.body.append(d.ghost);
    d.key.classList.add("lifted");
  }
  d.ghost.style.transform = `translate(${e.clientX - d.x}px, ${e.clientY - d.y}px) scale(1.08)`;
  const over = document.elementFromPoint(e.clientX, e.clientY)?.closest(".key, .deck-tab[data-page]:not(.add)");
  if (over !== d.over) { d.over?.classList.remove("drop"); over?.classList.add("drop"); d.over = over; }
});

function endDrag(e, cancel = false) {
  const d = deck.drag;
  if (!d || e.pointerId !== d.id) return;
  deck.drag = null;
  if (!d.ghost) return;
  d.ghost.remove();
  d.key.classList.remove("lifted");
  d.over?.classList.remove("drop");
  deck.noClick = true;  // bırakma bir "dokunma" sayılmasın
  setTimeout(() => { deck.noClick = false; }, 50);
  if (cancel || !d.over) return;
  const page = deck.draft.pages[deck.page], from = +d.key.dataset.slot;
  if (d.over.classList.contains("key")) {
    const to = +d.over.dataset.slot;
    [page.buttons[from], page.buttons[to]] = [page.buttons[to], page.buttons[from]];
  } else {
    const target = deck.draft.pages[+d.over.dataset.page];
    const free = target.buttons.findIndex((b) => !b);
    if (target === page) return;
    if (free < 0) return toast("O sayfada boş yer yok", true);
    target.buttons[free] = page.buttons[from];
    page.buttons[from] = null;
  }
  renderDeck();
}
addEventListener("pointerup", (e) => endDrag(e));
addEventListener("pointercancel", (e) => endDrag(e, true));

// ------------------------------------------------------------------ Düzenleme penceresi
function openModal(html) {
  $("#deck-modal-card").innerHTML = html;
  $("#deck-modal").classList.remove("hidden");
  $("#deck-modal-card").scrollTop = 0;
}
function closeModal() {
  $("#deck-modal").classList.add("hidden");
  $("#deck-modal-card").innerHTML = "";
}
$("#deck-modal").addEventListener("click", (e) => {
  if (e.target.id === "deck-modal" || e.target.closest("[data-close]")) closeModal();
});

function editPage(i) {
  const pages = deck.draft.pages, page = pages[i];
  openModal(`
    <h3>Sayfa</h3>
    <label class="field">Sayfa adı<input id="pg-name" maxlength="30" value="${escapeHtml(page.name)}"></label>
    <div class="modal-actions">
      ${pages.length > 1 ? '<button class="btn ghost red" id="pg-del">Sayfayı sil</button>' : ""}
      <span class="grow"></span>
      <button class="btn ghost" data-close>Vazgeç</button>
      <button class="btn primary" id="pg-ok">Tamam</button>
    </div>`);
  $("#pg-ok").onclick = () => {
    page.name = $("#pg-name").value.trim() || `Sayfa ${i + 1}`;
    closeModal();
    renderDeck();
  };
  $("#pg-del")?.addEventListener("click", async () => {
    if (page.buttons.some(Boolean) && !(await sheet(`"${page.name}" silinsin mi?`, "Bu sayfadaki düğmeler de silinecek.", { ok: "Sil" }))) return;
    pages.splice(i, 1);
    deck.page = Math.max(0, i - 1);
    closeModal();
    renderDeck();
  });
}

function editKey(slot) {
  const page = deck.draft.pages[deck.page];
  const old = page.buttons[slot];
  const b = old ? structuredClone(old) : { label: "", icon: "", action: { type: "media", v: "toggle" } };
  openModal(`
    <div class="de-top">
      <div class="de-preview"><div class="key" id="de-key"></div></div>
      <label class="field grow">Etiket<input id="de-label" maxlength="40" placeholder="ör. Spotify" value="${escapeHtml(b.label)}"></label>
    </div>
    <div class="field">İkon<div class="icon-grid" id="de-icons">${["", ...DECK_ICONS].map((n) => {
      const id = BRANDS[n] ? `b-${n}` : `i-${n}`;
      return `<button class="ic-opt" data-icon="${n}" aria-label="${n || "Harf"}">${n ? `<svg><use href="#${id}"/></svg>` : "Aa"}</button>`;
    }).join("")}</div></div>
    <div class="field">Renk<div class="swatches" id="de-colors">${DECK_COLORS.map((c) =>
      `<button class="sw${c ? "" : " none"}" data-color="${c}" style="--c:${c || "transparent"}" aria-label="${c || "Varsayılan"}"></button>`).join("")}</div></div>
    <div class="field">Ne yapsın?<div id="de-action"></div></div>
    <div class="modal-actions">
      ${old ? '<button class="btn ghost red" id="de-del">Sil</button>' : ""}
      <span class="grow"></span>
      <button class="btn ghost" data-close>Vazgeç</button>
      <button class="btn primary" id="de-ok">Tamam</button>
    </div>`);

  const preview = () => {
    const f = keyFace({ ...b, label: $("#de-label").value || ACTION_TYPES[b.action.type] });
    $("#de-key").innerHTML = f.html;
    $("#de-key").style.setProperty("--c", f.color || "var(--text)");
    $$(".ic-opt", $("#de-icons")).forEach((o) => o.classList.toggle("on", o.dataset.icon === (b.icon || "")));
    $$(".sw", $("#de-colors")).forEach((o) => o.classList.toggle("on", o.dataset.color === (b.color || "")));
  };
  $("#de-label").addEventListener("input", preview);
  $("#de-icons").addEventListener("click", (e) => { const o = e.target.closest(".ic-opt"); if (o) { b.icon = o.dataset.icon; preview(); } });
  $("#de-colors").addEventListener("click", (e) => { const o = e.target.closest(".sw"); if (o) { b.color = o.dataset.color; preview(); } });

  const form = actionForm(b.action, false, (type) => { b.action = { type }; preview(); });
  $("#de-action").append(form);
  preview();

  $("#de-ok").onclick = () => {
    const action = readAction(form);
    const problem = checkAction(action);
    if (problem) return toast(problem, true);
    const item = { label: $("#de-label").value.trim() || ACTION_TYPES[action.type], icon: b.icon || "", action };
    if (old?.id) item.id = old.id;
    if (b.color) item.color = b.color;
    page.buttons[slot] = item;
    closeModal();
    renderDeck();
  };
  $("#de-del")?.addEventListener("click", () => { page.buttons[slot] = null; closeModal(); renderDeck(); });
}

// Eylem formu: tür seçimi + o türe ait alanlar (çoklu eylemde her adım için tekrar kullanılır)
function actionForm(a, nested, onType) {
  const wrap = document.createElement("div");
  wrap.className = nested ? "act step" : "act";
  const types = Object.keys(ACTION_TYPES).filter((t) => (nested ? t !== "multi" : t !== "wait"));
  wrap.innerHTML = `<div class="act-head"><select class="act-type">${types.map((t) =>
    `<option value="${t}"${t === a.type ? " selected" : ""}>${ACTION_TYPES[t]}</option>`).join("")}</select>${
    nested ? '<button class="ic-btn step-del" aria-label="Adımı sil"><svg><use href="#i-x"/></svg></button>' : ""}</div>
    <div class="act-params"></div>`;
  const draw = (act) => { const box = $(":scope > .act-params", wrap); box.innerHTML = ""; actionParams(box, act); };
  draw({ ...ACTION_DEFAULTS[a.type], ...a });
  $(":scope > .act-head > .act-type", wrap).addEventListener("change", (e) => {
    draw({ type: e.target.value, ...structuredClone(ACTION_DEFAULTS[e.target.value]) });
    onType?.(e.target.value);
  });
  if (nested) $(":scope > .act-head > .step-del", wrap).addEventListener("click", () => wrap.remove());
  return wrap;
}

const opts = (list, cur) => list.map(([v, t]) => `<option value="${v}"${v === cur ? " selected" : ""}>${t}</option>`).join("");

function actionParams(box, a) {
  const hint = (t) => `<small class="hint">${t}</small>`;
  switch (a.type) {
    case "media":
      box.innerHTML = `<select class="p-v">${opts([["toggle", "Oynat / duraklat"], ["next", "Sonraki"], ["prev", "Önceki"]], a.v)}</select>`;
      break;
    case "volume": {
      const mode = a.mute ? "mute" : a.step < 0 ? "down" : "up";
      box.innerHTML = `<select class="p-mode">${opts([["up", "Sesi artır"], ["down", "Sesi azalt"], ["mute", "Sessiz aç / kapa"]], mode)}</select>
        <input class="p-step" type="number" inputmode="numeric" min="1" max="100" value="${Math.abs(a.step || 10)}" aria-label="Adım">`;
      const sync = () => $(":scope > .p-step", box).classList.toggle("hidden", $(":scope > .p-mode", box).value === "mute");
      $(":scope > .p-mode", box).addEventListener("change", sync);
      sync();
      break;
    }
    case "app":
      box.innerHTML = `<input class="p-target" placeholder="spotify:" value="${escapeHtml(a.target || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">
        ${hint("Program adı, adres ya da dosya yolu. Ör: <b>spotify:</b> · <b>discord:</b> · <b>notepad</b> · <b>steam://rungameid/730</b>")}`;
      break;
    case "url":
      box.innerHTML = `<input class="p-url" type="url" value="${escapeHtml(a.url || "https://")}" autocapitalize="off" autocorrect="off" spellcheck="false">`;
      break;
    case "open":
      box.innerHTML = `<input class="p-path" placeholder="C:\\Users\\..." value="${escapeHtml(a.path || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">
        ${hint("Bilgisayardaki dosya ya da klasörün tam yolu")}`;
      break;
    case "hotkey":
      box.innerHTML = `<input class="p-keys" placeholder="ctrl+shift+m" value="${escapeHtml(a.keys || "")}" autocapitalize="off" autocorrect="off" spellcheck="false">
        <div class="chips">${["ctrl", "shift", "alt", "win"].map((k) => `<button class="chip" data-key="${k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
        ${hint("Ör: <b>win+d</b> · <b>alt+tab</b> · <b>ctrl+shift+esc</b> · <b>f13</b> (OBS gibi programlar için F13–F24 boştadır)")}`;
      $(":scope > .chips", box).addEventListener("click", (e) => {
        const c = e.target.closest(".chip");
        if (!c) return;
        const input = $(":scope > .p-keys", box);
        input.value = `${input.value && !input.value.endsWith("+") ? `${input.value}+` : input.value}${c.dataset.key}+`;
      });
      break;
    case "text":
      box.innerHTML = `<textarea class="p-text" rows="3" maxlength="2000" placeholder="Yazılacak metin">${escapeHtml(a.text || "")}</textarea>
        ${hint("Bilgisayarda o an açık olan yere yazılır")}`;
      break;
    case "power":
      box.innerHTML = `<select class="p-v">${opts([["lock", "Kilitle"], ["sleep", "Uyku"], ["restart", "Yeniden başlat"], ["shutdown", "Kapat"]], a.v)}</select>
        ${hint("Yeniden başlat ve kapat basınca onay ister")}`;
      break;
    case "wait":
      box.innerHTML = `<input class="p-ms" type="number" inputmode="numeric" min="1" max="10000" value="${a.ms || 500}" aria-label="Milisaniye">
        ${hint("Milisaniye (1000 = 1 saniye)")}`;
      break;
    case "multi": {
      box.innerHTML = '<div class="steps"></div><button class="chip add-step"><svg><use href="#i-plus"/></svg>Adım ekle</button>';
      const steps = $(":scope > .steps", box);
      (a.steps || []).forEach((s) => steps.append(actionForm(s, true)));
      $(":scope > .add-step", box).addEventListener("click", () => {
        if (steps.children.length >= 20) return toast("En fazla 20 adım", true);
        steps.append(actionForm({ type: "hotkey", keys: "" }, true));
      });
      break;
    }
  }
}

function readAction(wrap) {
  const type = $(":scope > .act-head > .act-type", wrap).value;
  const box = $(":scope > .act-params", wrap);
  const val = (cls) => $(`:scope > .${cls}`, box)?.value ?? "";
  switch (type) {
    case "media": case "power": return { type, v: val("p-v") };
    case "volume": {
      const mode = val("p-mode"), n = Math.min(100, Math.max(1, Math.round(+val("p-step") || 10)));
      return mode === "mute" ? { type, mute: "toggle" } : { type, step: mode === "down" ? -n : n };
    }
    case "app": return { type, target: val("p-target").trim() };
    case "url": return { type, url: val("p-url").trim() };
    case "open": return { type, path: val("p-path").trim() };
    case "hotkey": return { type, keys: val("p-keys").trim().replace(/\+$/, "") };
    case "text": return { type, text: val("p-text") };
    case "wait": return { type, ms: Math.min(10000, Math.max(1, Math.round(+val("p-ms") || 500))) };
    case "multi": return { type, steps: [...$(":scope > .steps", box).children].map(readAction) };
  }
}

// Kaba kontrol; asıl doğrulamayı bilgisayar yapar (bilinmeyen tuş gibi hataları o söyler)
function checkAction(a) {
  if (a.type === "app" && !a.target) return "Açılacak programı yaz";
  if (a.type === "url" && !/^https?:\/\/.+/.test(a.url)) return "Bağlantı http:// ya da https:// ile başlamalı";
  if (a.type === "open" && !a.path) return "Dosya ya da klasör yolunu yaz";
  if (a.type === "hotkey" && !a.keys) return "Kısayolu yaz (ör. ctrl+shift+m)";
  if (a.type === "text" && !a.text) return "Yazılacak metni gir";
  if (a.type === "multi") {
    if (!a.steps.length) return "En az bir adım ekle";
    for (const s of a.steps) { const p = checkAction(s); if (p) return p; }
  }
  return "";
}

// Uygulama yan açılırsa doğrudan deck ile başla
if (landscape.matches && !$("#app").classList.contains("hidden")) setView("deck");
