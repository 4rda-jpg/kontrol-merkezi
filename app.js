"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ------------------------------------------------------------------ Ayarlar (sadece bu telefonda)
const SETTINGS_KEY = "km-settings";
const loadSettings = () => { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch { return null; } };
const saveSettings = (s) => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch {} };

// ------------------------------------------------------------------ Biçimlendirme
const fmtBytes = (b, d = 1) => {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i < 2 ? 0 : d)} ${u[i]}`;
};
const fmtUptime = (s) => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d} gün ${h} sa` : h ? `${h} sa ${m} dk` : `${m} dk`;
};
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function toast(msg, err = false) {
  const el = document.createElement("div");
  el.className = `toast${err ? " err" : ""}`;
  el.textContent = msg;
  $("#toasts").append(el);
  setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, 2600);
}

function sheet(title, text, { ok = "Onayla", style = "danger", cancel = "Vazgeç" } = {}) {
  return new Promise((resolve) => {
    $("#sheet-title").textContent = title;
    $("#sheet-text").innerHTML = text;
    const okBtn = $("#sheet-ok"), cancelBtn = $("#sheet-cancel");
    okBtn.textContent = ok;
    okBtn.className = `btn ${style}`;
    cancelBtn.textContent = cancel;
    $("#sheet").classList.remove("hidden");
    const done = (v) => {
      $("#sheet").classList.add("hidden");
      okBtn.onclick = cancelBtn.onclick = $("#sheet").onclick = null;
      resolve(v);
    };
    okBtn.onclick = () => done(true);
    cancelBtn.onclick = () => done(false);
    $("#sheet").onclick = (e) => { if (e.target.id === "sheet") done(false); };
  });
}

// ------------------------------------------------------------------ Küçük grafik
class Spark {
  constructor(canvas, colors, max = 100) {
    this.c = canvas; this.ctx = canvas.getContext("2d");
    this.colors = colors; this.max = max;
    this.series = colors.map(() => []);
  }
  push(...values) {
    values.forEach((v, i) => {
      const s = this.series[i];
      if (!s.length) for (let k = 0; k < 30; k++) s.push(v);
      s.push(v); if (s.length > 30) s.shift();
    });
    this.draw();
  }
  reset() { this.series = this.colors.map(() => []); }
  draw() {
    const { c, ctx } = this, dpr = devicePixelRatio || 1, w = c.clientWidth, h = c.clientHeight;
    if (!w) return;
    if (c.width !== w * dpr) { c.width = w * dpr; c.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const max = this.max ?? Math.max(1024, ...this.series.flat()) * 1.15;
    this.series.forEach((data, si) => {
      const step = w / (data.length - 1);
      ctx.beginPath();
      data.forEach((v, i) => { const x = i * step, y = h - 2 - (v / max) * (h - 6); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.strokeStyle = this.colors[si]; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.stroke();
      ctx.lineTo(w, h); ctx.lineTo(0, h); ctx.closePath();
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, this.colors[si] + "40"); g.addColorStop(1, this.colors[si] + "00");
      ctx.fillStyle = g; ctx.fill();
    });
  }
}
const sparks = {
  cpu: new Spark($("#cpu-spark"), ["#8b6cff"]),
  net: new Spark($("#net-spark"), ["#fbbf24", "#8b6cff"], null),
};

// ------------------------------------------------------------------ Durum
const state = {
  broker: "wait",      // sunucu bağlantısı: wait / on / off
  esp: null,           // "online" / "offline"
  pc: null,            // "online" / "offline"
  waking: false,
  info: null,
  stats: null,
};
let client, settings, wakeTimer, watchTimer, artUrl;
const pending = new Map();  // komut kimliği -> çözücü

function topic(t) { return `${settings.topic || "km"}/${t}`; }

function renderLinks() {
  const set = (id, cls) => { $(id).className = `link ${cls}`; };
  set("#link-broker", state.broker);
  set("#link-esp", state.esp === "online" ? "on" : state.esp === "offline" ? "off" : "wait");
  set("#link-pc", state.pc === "online" ? "on" : state.pc === "offline" ? "off" : "wait");
}

function renderHero() {
  const hero = $("#hero"), wake = $("#btn-wake");
  const online = state.pc === "online";
  let st, title, sub;
  if (state.broker !== "on") {
    st = "unknown"; title = "Bağlanıyor…"; sub = state.broker === "off" ? "Sunucuya ulaşılamıyor, tekrar deneniyor" : "Sunucuya bağlanılıyor";
  } else if (online) {
    state.waking = false;
    st = "on"; title = "Bilgisayar açık";
    sub = state.stats ? `${fmtUptime(state.stats.uptime)} süredir açık` : "Veriler alınıyor…";
  } else if (state.waking) {
    st = "waking"; title = "Açılıyor…";
    sub = "Giriş yaptığında panel bağlanacak";
  } else {
    st = "off"; title = state.pc === null ? "Durum bekleniyor" : "Bilgisayar kapalı";
    sub = state.esp === "online" ? "Uzaktan açmaya hazır" : "Kumanda (ESP32) çevrimdışı, açılamaz";
  }
  hero.dataset.state = st;
  $("#hero-title").textContent = title;
  $("#hero-sub").textContent = sub;
  wake.classList.toggle("hidden", state.broker !== "on" || online);
  wake.disabled = state.waking || state.esp !== "online";
  $("#online-only").classList.toggle("hidden", !online);
}

const render = () => { renderLinks(); renderHero(); };

// ------------------------------------------------------------------ Canlı veri
function renderStats(s) {
  state.stats = s;
  $("#cpu-val").textContent = Math.round(s.cpu);
  sparks.cpu.push(s.cpu);
  $("#mem-val").textContent = Math.round(s.mem);
  $("#mem-bar").style.width = `${s.mem}%`;
  $("#mem-sub").textContent = `${fmtBytes(s.mem_used)} / ${fmtBytes(s.mem_total, 0)}`;
  if (s.gpu) {
    $("#gpu-val").textContent = Math.round(s.gpu.util);
    $("#gpu-bar").style.width = `${s.gpu.util}%`;
    $("#gpu-sub").textContent = `${Math.round(s.gpu.temp)}°C · ${(s.gpu.mem_used / 1024).toFixed(1)} GB`;
  }
  $("#net-down").textContent = `${fmtBytes(s.down)}/s`;
  $("#net-up").textContent = `${fmtBytes(s.up)}/s`;
  sparks.net.push(s.down, s.up);
  $("#uptime").textContent = `${state.info?.hostname || "Bilgisayar"} · ${fmtUptime(s.uptime)} süredir açık`;

  const m = s.media;
  $("#media-card").classList.toggle("idle", !m);
  $("#media-title").textContent = m?.title || "Şu an bir şey çalmıyor";
  $("#media-artist").textContent = m ? (m.artist || "Bilinmeyen sanatçı") : "Spotify, YouTube ya da başka bir oynatıcı";
  $("#media-app").textContent = m?.app || "Medya";
  $("#play-icon").setAttribute("href", m?.status === "playing" ? "#i-pause" : "#i-play");
  $("#media-bar").style.width = m?.duration ? `${Math.min(100, (m.position / m.duration) * 100)}%` : "0";
  if (!m?.art) setArt(null);

  if (s.volume && Date.now() > volumeHoldUntil) renderVolume(s.volume);
  renderProcs(s.procs || []);
  renderHero();
}

function setArt(bytes) {
  if (artUrl) URL.revokeObjectURL(artUrl);
  artUrl = bytes ? URL.createObjectURL(new Blob([bytes], { type: "image/jpeg" })) : null;
  const css = artUrl ? `url(${artUrl})` : "";
  $("#media-art").style.backgroundImage = css;
  $("#media-art").classList.toggle("has-img", !!artUrl);
  $("#media-bg").style.backgroundImage = css;
  $("#media-bg").classList.toggle("show", !!artUrl);
}

function renderVolume(v) {
  const slider = $("#volume");
  slider.value = v.level;
  slider.style.setProperty("--p", `${v.muted ? 0 : v.level}%`);
  $("#vol-val").textContent = v.muted ? "—" : v.level;
  $("#vol-icon").setAttribute("href", v.muted || v.level === 0 ? "#i-mute" : "#i-vol");
  $("#mute-btn").dataset.muted = v.muted ? "1" : "";
}

const hue = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);
function renderProcs(procs) {
  $("#procs").innerHTML = procs.map((p) => {
    const name = escapeHtml(p.name.replace(/\.exe$/i, ""));
    return `<div class="proc">
      <span class="p-ava" style="background:hsl(${hue(p.name)} 55% 42%)">${name[0]?.toUpperCase() || "?"}</span>
      <div class="p-name"><b>${name}</b><span>${fmtBytes(p.mem)}${p.count > 1 ? ` · ${p.count} pencere/işlem` : ""}</span></div>
      <span class="p-cpu ${p.cpu > 50 ? "hotter" : p.cpu > 15 ? "hot" : ""}">%${p.cpu.toFixed(1)}</span>
      <button class="kill" data-kill="${escapeHtml(p.name)}" ${p.protected ? "disabled" : ""} aria-label="Kapat"><svg><use href="#i-x"/></svg></button>
    </div>`;
  }).join("");
}

const APP_STYLE = {
  globe: ["#fb7c3c", "#f0503c"], music: ["#2fd566", "#14a34a"], message: ["#7b8cff", "#5865f2"],
  gamepad: ["#3a8fd6", "#1b4f8a"], code: ["#36a3f2", "#0b6fc4"], folder: ["#fcc94a", "#f59e0b"],
  activity: ["#2dd4bf", "#0d9488"], calculator: ["#a78bfa", "#7c3aed"],
};
function renderInfo(info) {
  state.info = info;
  $("#hostname").textContent = info.hostname;
  $("#apps").innerHTML = info.apps.map((a, i) => {
    const [c1, c2] = APP_STYLE[a.icon] || ["#8b6cff", "#5b3fd9"];
    return `<button class="app-btn" data-app="${i}" data-name="${escapeHtml(a.name)}">
      <span class="app-ic" style="--g:linear-gradient(135deg,${c1},${c2});--sh:${c2}"><svg><use href="#i-${APP_STYLE[a.icon] ? a.icon : "app"}"/></svg></span>
      <span>${escapeHtml(a.name)}</span></button>`;
  }).join("");
}

// ------------------------------------------------------------------ MQTT
function connect() {
  client?.end(true);
  state.broker = "wait"; render();
  client = mqtt.connect(`wss://${settings.host}:${settings.port || 8084}/mqtt`, {
    username: settings.user || undefined,
    password: settings.pass || undefined,
    clientId: `km-phone-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriod: 3000,
    connectTimeout: 10000,
    clean: true,
  });
  client.on("connect", () => {
    state.broker = "on";
    $("#setup").classList.add("hidden");
    $("#app").classList.remove("hidden");
    client.subscribe([topic("pc/#"), topic("esp/#")], { qos: 1 });
    startWatching();
    render();
  });
  client.on("close", () => { state.broker = "off"; render(); });
  client.on("error", (err) => {
    // Yanlış şifre gibi kalıcı hatalarda kurulum ekranına dön
    if (/not authorized|bad user|Connection refused/i.test(err.message)) {
      client.end(true);
      showSetup("Bağlanılamadı: kullanıcı adı ya da şifre hatalı.");
    }
  });
  client.on("message", onMessage);
}

function onMessage(t, payload) {
  const sub = t.slice((settings.topic || "km").length + 1);
  if (sub === "pc/art") return setArt(payload);
  const text = payload.toString();
  switch (sub) {
    case "pc/status": {
      const was = state.pc;
      state.pc = text;
      if (text === "online" && was === "offline" && state.waking) toast("✅ Bilgisayar açıldı");
      if (text !== "online") { sparks.cpu.reset(); sparks.net.reset(); state.stats = null; }
      else startWatching();
      break;
    }
    case "esp/status": state.esp = text; break;
    case "pc/info": try { renderInfo(JSON.parse(text)); } catch {} break;
    case "pc/stats": try { renderStats(JSON.parse(text)); } catch {} break;
    case "pc/ack": {
      try {
        const a = JSON.parse(text);
        pending.get(a.id)?.(a);
        pending.delete(a.id);
      } catch {}
      break;
    }
    case "esp/event": {
      try {
        const e = JSON.parse(text).e;
        if (e === "already_on") { state.waking = false; toast("Bilgisayar zaten açık"); }
        if (e === "wake_sent") toast("⚡ Uyandırma sinyali gönderildi");
      } catch {}
      break;
    }
  }
  render();
}

// Telefon ekranı açıkken bilgisayara "bakıyorum" der; o da 2 sn'de bir veri gönderir
function startWatching() {
  clearInterval(watchTimer);
  const ping = () => {
    if (!document.hidden && client?.connected && state.pc === "online") client.publish(topic("app/watch"), "1");
  };
  ping();
  watchTimer = setInterval(ping, 8000);
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return clearInterval(watchTimer);
  if (client && !client.connected) client.reconnect();
  startWatching();
});

function send(action, value, { quiet = false } = {}) {
  if (!client?.connected || state.pc !== "online") {
    toast("Bilgisayar çevrimdışı", true);
    return Promise.resolve(null);
  }
  const id = Math.random().toString(36).slice(2, 9);
  client.publish(topic("cmd/pc"), JSON.stringify({ id, a: action, v: value }), { qos: 1 });
  return new Promise((resolve) => {
    const timer = setTimeout(() => { pending.delete(id); if (!quiet) toast("Bilgisayar cevap vermedi", true); resolve(null); }, 8000);
    pending.set(id, (ack) => {
      clearTimeout(timer);
      if (!ack.ok) toast(ack.msg || "İşlem başarısız", true);
      resolve(ack);
    });
  });
}

// ------------------------------------------------------------------ Etkileşimler
$("#btn-wake").addEventListener("click", () => {
  if (!client?.connected) return;
  client.publish(topic("cmd/esp"), "wake", { qos: 1 });
  state.waking = true;
  clearTimeout(wakeTimer);
  // 3 dakikada panel bağlanmazsa beklemeyi bırak (Windows giriş ekranında olabilir)
  wakeTimer = setTimeout(() => {
    if (state.waking) { state.waking = false; render(); toast("Bilgisayar açıldıysa giriş ekranında bekliyor olabilir"); }
  }, 180000);
  render();
});

$$("[data-media]").forEach((b) => b.addEventListener("click", () => send("media", b.dataset.media)));

let volumeHoldUntil = 0, volTimer;
$("#volume").addEventListener("input", (e) => {
  const level = +e.target.value;
  volumeHoldUntil = Date.now() + 2500;
  renderVolume({ level, muted: false });
  clearTimeout(volTimer);
  volTimer = setTimeout(() => send("volume", { level, muted: false }, { quiet: true }), 150);
});
$("#mute-btn").addEventListener("click", () => {
  const muted = !$("#mute-btn").dataset.muted;
  volumeHoldUntil = Date.now() + 2500;
  renderVolume({ level: +$("#volume").value, muted });
  send("volume", { muted });
});

const POWER_TEXT = {
  lock: ["Bilgisayar kilitlensin mi?", "Ekran kilitlenecek.", "Kilitle", "accent", "🔒 Kilitlendi"],
  sleep: ["Uyku moduna geçsin mi?", "Bilgisayar uyur. Uzaktan tekrar açmak için Aç düğmesini kullanabilirsin.", "Uyut", "accent", "🌙 Uyku moduna geçiyor"],
  restart: ["Yeniden başlatılsın mı?", "Kaydedilmemiş işler kaybolabilir. 5 saniye içinde başlar.", "Yeniden başlat", "danger", "🔄 Yeniden başlıyor"],
  shutdown: ["Bilgisayar kapatılsın mı?", "Kaydedilmemiş işler kaybolabilir. 5 saniye içinde kapanır.", "Kapat", "danger", "⏻ Kapanıyor"],
};
$$("[data-power]").forEach((b) => b.addEventListener("click", async () => {
  const action = b.dataset.power;
  const [title, text, ok, style, done] = POWER_TEXT[action];
  if (!(await sheet(title, text, { ok, style }))) return;
  const ack = await send("power", action);
  if (!ack?.ok) return;
  toast(done);
  if (action === "restart" || action === "shutdown") {
    if (await sheet("Geri sayım başladı", "Fikrini mi değiştirdin? Hâlâ iptal edebilirsin.", { ok: "İptal et", style: "accent", cancel: "Kapat" })) {
      if ((await send("power", "cancel"))?.ok) toast("↩️ İptal edildi");
    }
  }
}));

$("#apps").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-app]");
  if (!b) return;
  if ((await send("launch", +b.dataset.app))?.ok) toast(`${b.dataset.name} açılıyor…`);
});

$("#procs").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-kill]");
  if (!b) return;
  const name = b.dataset.kill;
  if (!(await sheet(`${name} kapatılsın mı?`, "Bu uygulamanın tüm pencereleri zorla kapatılacak. Kaydedilmemiş veriler kaybolabilir.", { ok: "Kapat" }))) return;
  const ack = await send("kill", name);
  if (ack?.ok) toast(ack.msg || "Kapatıldı");
});

$("#btn-settings").addEventListener("click", async () => {
  const yes = await sheet("Bağlantı ayarları",
    `Sunucu: <b>${escapeHtml(settings.host)}</b><br>Kullanıcı: <b>${escapeHtml(settings.user)}</b><br><br>Bilgileri değiştirmek ya da bu telefondan silmek için çıkış yap.`,
    { ok: "Çıkış yap", style: "danger", cancel: "Kapat" });
  if (!yes) return;
  client?.end(true);
  try { localStorage.removeItem(SETTINGS_KEY); } catch {}
  showSetup();
});

// ------------------------------------------------------------------ Kurulum
function showSetup(error = "") {
  $("#app").classList.add("hidden");
  $("#setup").classList.remove("hidden");
  $("#setup-error").textContent = error;
  const s = settings || {};
  // Kurulum bağlantısındaki #h=adres kısmı (sunucuya gönderilmez, sadece bu telefonda kalır)
  $("#f-host").value = s.host || new URLSearchParams(location.hash.slice(1)).get("h") || "";
  $("#f-user").value = s.user || "";
  $("#f-port").value = s.port || 8084;
  $("#f-topic").value = s.topic || "km";
}

$("#setup-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const host = $("#f-host").value.trim().replace(/^(wss?|https?|mqtts?):\/\//, "").replace(/[:/].*$/, "");
  settings = { host, user: $("#f-user").value.trim(), pass: $("#f-pass").value, port: +$("#f-port").value || 8084, topic: $("#f-topic").value.trim() || "km" };
  saveSettings(settings);
  $("#setup-error").textContent = "Bağlanılıyor…";
  connect();
});

function tickGreeting() {
  const h = new Date().getHours();
  $("#greeting").textContent = h < 5 ? "İyi geceler" : h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : h < 23 ? "İyi akşamlar" : "İyi geceler";
}
tickGreeting();
setInterval(tickGreeting, 60000);

settings = loadSettings();
if (settings?.host) {
  $("#app").classList.remove("hidden");
  connect();
} else {
  showSetup();
}

if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
