(() => {
  "use strict";

  /* ---------- Config ---------- */
  const STORAGE_KEY = "bwrb.applications.v1";
  const THEME_KEY = "bwrb.theme";
  const SEED_URL = "data/bewerbungen.csv";

  const STATUSES = [
    { id: "offen", label: "Offen", color: "var(--s-offen)" },
    { id: "einladung", label: "Einladung", color: "var(--s-einladung)" },
    { id: "interview", label: "Interview", color: "var(--s-interview)" },
    { id: "angebot", label: "Angebot", color: "var(--s-angebot)" },
    { id: "absage", label: "Absage", color: "var(--s-absage)" },
    { id: "keine", label: "Keine Antwort", color: "var(--s-keine)" },
  ];
  const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

  const LINK_TYPES = [
    { id: "bestaetigung", label: "Bestätigung", color: "var(--s-offen)" },
    { id: "einladung", label: "Einladung", color: "var(--s-einladung)" },
    { id: "absage", label: "Absage", color: "var(--s-absage)" },
    { id: "inserat", label: "Inserat", color: "var(--s-angebot)" },
    { id: "sonstiges", label: "Sonstiges", color: "var(--s-keine)" },
  ];
  const LINK_TYPE = Object.fromEntries(LINK_TYPES.map((t) => [t.id, t]));

  const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

  const ICONS = {
    calendar: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/></svg>',
    link: '<svg viewBox="0 0 24 24"><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1"/><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M5 4h14v12l-4 4H5z"/><path d="M9 9h6M9 13h4"/></svg>',
    x: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 7l9 6 9-6"/></svg>',
    briefcase: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="3"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"/></svg>',
    flag: '<svg viewBox="0 0 24 24"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>',
  };

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function parseDate(str) {
    if (!str) return "";
    str = String(str).trim();
    let m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
    m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
  }
  function fmtDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-");
    return `${d}.${m}.${y}`;
  }
  function fmtDateLong(iso) {
    if (!iso) return "";
    const d = new Date(iso + "T00:00:00");
    return d.toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" });
  }
  function daysSince(iso) {
    if (!iso) return null;
    const ms = new Date(todayISO() + "T00:00:00") - new Date(iso + "T00:00:00");
    return Math.round(ms / 86400000);
  }
  function relDays(n) {
    if (n === null) return "";
    if (n === 0) return "heute";
    if (n === 1) return "gestern";
    if (n < 0) return `in ${-n} Tagen`;
    if (n < 7) return `vor ${n} Tagen`;
    if (n < 60) return `vor ${Math.round(n / 7)} Wo.`;
    return `vor ${Math.round(n / 30)} Mon.`;
  }
  function hue(str) {
    let h = 0;
    for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) % 360;
    return h;
  }
  function initials(name) {
    const w = String(name || "?").trim().split(/\s+/);
    return ((w[0]?.[0] || "?") + (w[1]?.[0] || "")).toUpperCase();
  }
  function statusFromText(t) {
    t = String(t || "").toLowerCase().trim();
    if (t.startsWith("absage")) return "absage";
    if (t.includes("keine")) return "keine";
    if (t.includes("einladung")) return "einladung";
    if (t.includes("interview") || t.includes("gespräch")) return "interview";
    if (t.includes("angebot") || t.includes("zusage")) return "angebot";
    return "offen";
  }

  /* ---------- Storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function persist() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state.apps)); }
    catch { toast("Speichern im Browser nicht möglich – bitte Backup exportieren"); }
  }

  /* ---------- CSV ---------- */
  function parseCSV(text) {
    text = text.replace(/^﻿/, "");
    const firstLine = text.split(/\r?\n/, 1)[0];
    const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ";" : ",";
    const rows = [];
    let row = [], field = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(field); rows.push(row); row = []; field = "";
      } else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.some((v) => v.trim() !== ""));
  }

  function appsFromCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return [];
    const head = rows[0].map((h) => h.toLowerCase().trim());
    const col = (...names) => head.findIndex((h) => names.some((n) => h.includes(n)));
    const iDate = col("bewerbung", "datum", "eingang");
    const iFirma = col("firma", "unternehmen", "company");
    const iStelle = col("stelle", "position", "job");
    const iStatus = col("status");
    const iAbsage = col("absage am", "entscheid");
    const iProofIn = head.findIndex((h) => h.includes("nachweis eingang") || h.includes("bestätigung"));
    const iProofOut = head.findIndex((h) => h.includes("nachweis outcome") || h.includes("outcome"));
    const iNote = col("bemerkung", "notiz", "notes");

    return rows.slice(1).map((r) => {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      const status = statusFromText(get(iStatus));
      const datum = parseDate(get(iDate));
      const links = [];
      if (get(iProofIn)) links.push({ id: uid(), type: "bestaetigung", url: get(iProofIn) });
      if (get(iProofOut)) {
        const t = status === "absage" ? "absage" : status === "einladung" || status === "interview" ? "einladung" : "sonstiges";
        links.push({ id: uid(), type: t, url: get(iProofOut) });
      }
      const notes = [];
      if (get(iNote)) {
        get(iNote).split(" | ").forEach((t) => t.trim() && notes.push({ id: uid(), text: t.trim(), date: datum || todayISO() }));
      }
      return {
        id: uid(),
        firma: get(iFirma),
        stelle: get(iStelle),
        datum,
        status,
        absageAm: parseDate(get(iAbsage)),
        links, notes,
        updated: Date.now(),
      };
    }).filter((a) => a.firma);
  }

  function appsToCSV(apps) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Monat", "Bewerbung / Eingang", "Firma", "Stelle", "Status", "Absage am", "Nachweis Eingang", "Nachweis Outcome", "Bemerkung"];
    const lines = [header.map(q).join(";")];
    for (const a of sortApps(apps, "date-desc")) {
      const proofIn = a.links.filter((l) => l.type === "bestaetigung").map((l) => l.url).join(" ");
      const proofOut = a.links.filter((l) => l.type !== "bestaetigung").map((l) => l.url).join(" ");
      const month = a.datum ? MONTHS[+a.datum.slice(5, 7) - 1] : "";
      lines.push([
        month, fmtDate(a.datum), a.firma, a.stelle, STATUS[a.status]?.label || "",
        fmtDate(a.absageAm), proofIn, proofOut, a.notes.map((n) => n.text.replace(/\s*\n\s*/g, " ")).join(" | "),
      ].map(q).join(";"));
    }
    return "﻿" + lines.join("\r\n");
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- State ---------- */
  const state = {
    apps: [],
    filter: "alle",
    query: "",
    sort: "date-desc",
    draft: null,
    draftOriginal: "",
    isNew: false,
  };

  function sortApps(apps, mode) {
    const arr = [...apps];
    const byDate = (a, b) => (b.datum || "").localeCompare(a.datum || "") || a.firma.localeCompare(b.firma);
    if (mode === "date-asc") arr.sort((a, b) => -byDate(a, b));
    else if (mode === "company") arr.sort((a, b) => a.firma.localeCompare(b.firma, "de", { sensitivity: "base" }));
    else if (mode === "updated") arr.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    else arr.sort(byDate);
    return arr;
  }

  function visibleApps() {
    const q = state.query.trim().toLowerCase();
    return sortApps(state.apps, state.sort).filter((a) => {
      if (state.filter !== "alle" && a.status !== state.filter) return false;
      if (!q) return true;
      return [a.firma, a.stelle, STATUS[a.status]?.label, ...a.notes.map((n) => n.text)]
        .some((v) => String(v || "").toLowerCase().includes(q));
    });
  }

  /* ---------- Rendering ---------- */
  const els = {
    stats: $("#stats"), dist: $("#distBar"), filters: $("#filters"), list: $("#list"),
    search: $("#search"), sort: $("#sort"), subtitle: $("#subtitle"),
  };

  const counted = new WeakMap();
  function countUp(el, to) {
    const from = counted.get(el) ?? 0;
    counted.set(el, to);
    if (from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
    const start = performance.now(), dur = 900;
    const step = (t) => {
      const p = Math.min(1, (t - start) / dur);
      const e = 1 - Math.pow(1 - p, 4);
      el.textContent = Math.round(from + (to - from) * e);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  let statsBuilt = false;
  function renderStats() {
    const total = state.apps.length;
    const by = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
    state.apps.forEach((a) => by[a.status]++);
    const positive = by.einladung + by.interview + by.angebot;
    const answered = total - by.offen - by.keine;
    const rate = total ? Math.round((answered / total) * 100) : 0;

    const tiles = [
      { key: "total", label: "Total", value: total, sub: `${rate}% mit Antwort`, c: "var(--accent)" },
      { key: "offen", label: "Offen", value: by.offen, sub: "warten auf Antwort", c: STATUS.offen.color },
      { key: "pos", label: "Einladungen", value: positive, sub: by.angebot ? `${by.angebot} Angebot${by.angebot > 1 ? "e" : ""}` : "Gespräche & Angebote", c: STATUS.einladung.color },
      { key: "absage", label: "Absagen", value: by.absage, sub: total ? `${Math.round((by.absage / total) * 100)}% aller Bewerbungen` : "–", c: STATUS.absage.color },
      { key: "keine", label: "Keine Antwort", value: by.keine, sub: "Ghosting", c: STATUS.keine.color },
    ];

    if (!statsBuilt) {
      els.stats.innerHTML = tiles.map((t, i) => `
        <div class="stat" style="--i:${i};--c:${t.c}" data-key="${t.key}">
          <div class="stat-label"><i></i>${t.label}</div>
          <div class="stat-value">0</div>
          <div class="stat-sub"></div>
        </div>`).join("");
      statsBuilt = true;
    }
    tiles.forEach((t) => {
      const el = els.stats.querySelector(`[data-key="${t.key}"]`);
      countUp(el.querySelector(".stat-value"), t.value);
      el.querySelector(".stat-sub").textContent = t.sub;
    });

    // distribution bar
    if (!els.dist.children.length) {
      els.dist.innerHTML = STATUSES.map((s) => `<span style="--c:${s.color}" title="${s.label}"></span>`).join("");
    }
    requestAnimationFrame(() => {
      [...els.dist.children].forEach((span, i) => {
        const n = by[STATUSES[i].id];
        span.style.width = total ? (n / total) * 100 + "%" : "0";
        span.title = `${STATUSES[i].label}: ${n}`;
        span.style.display = n ? "" : "none";
      });
    });

    els.subtitle.textContent = total
      ? `${total} Bewerbungen · ${by.offen} offen`
      : "Noch keine Bewerbungen";
  }

  function renderFilters() {
    const counts = { alle: state.apps.length };
    STATUSES.forEach((s) => (counts[s.id] = state.apps.filter((a) => a.status === s.id).length));
    const opts = [{ id: "alle", label: "Alle" }, ...STATUSES];
    els.filters.innerHTML = opts.map((o) => `
      <button class="chip ${state.filter === o.id ? "active" : ""}" data-filter="${o.id}" role="tab"
        aria-selected="${state.filter === o.id}" ${o.color ? `style="--c:${o.color}"` : ""}>
        ${o.color ? "<i></i>" : ""}${o.label}<b>${counts[o.id]}</b>
      </button>`).join("");
  }

  function cardHTML(a, i) {
    const s = STATUS[a.status] || STATUS.offen;
    const d = daysSince(a.datum);
    const age = a.status === "offen" && d !== null ? relDays(d) : a.absageAm ? `Entscheid ${fmtDate(a.absageAm)}` : "";
    return `
      <button class="card" data-id="${a.id}" style="--i:${Math.min(i, 24)};--c:${s.color}">
        <div class="avatar" style="--h:${hue(a.firma)}">${esc(initials(a.firma))}</div>
        <div class="card-main">
          <div class="card-title"><strong>${esc(a.firma)}</strong></div>
          <div class="card-role">${esc(a.stelle || "—")}</div>
          <div class="card-meta">
            ${a.datum ? `<span>${ICONS.calendar}${fmtDateLong(a.datum)}</span>` : ""}
            ${a.links.length ? `<span>${ICONS.link}${a.links.length}</span>` : ""}
            ${a.notes.length ? `<span>${ICONS.note}${a.notes.length}</span>` : ""}
          </div>
        </div>
        <div class="card-side">
          <span class="pill ${a.status === "offen" ? "pulse" : ""}" style="--c:${s.color}"><i></i>${s.label}</span>
          ${age ? `<span class="age">${age}</span>` : ""}
        </div>
      </button>`;
  }

  function renderList() {
    const apps = visibleApps();
    if (!state.apps.length) {
      els.list.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${ICONS.briefcase}</div>
          <h3>Noch keine Bewerbungen</h3>
          <p class="muted">Erfasse deine erste Bewerbung oder importiere eine CSV-Datei.</p>
          <button class="btn primary" data-action="add">Neue Bewerbung</button>
          <button class="btn ghost" data-action="import">Importieren</button>
        </div>`;
      return;
    }
    if (!apps.length) {
      els.list.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${ICONS.flag}</div>
          <h3>Nichts gefunden</h3>
          <p class="muted">Kein Eintrag passt zu deiner Suche oder deinem Filter.</p>
        </div>`;
      return;
    }
    const grouped = state.sort === "date-desc" || state.sort === "date-asc";
    let html = "", lastGroup = null, i = 0;
    for (const a of apps) {
      if (grouped) {
        const g = a.datum ? `${MONTHS[+a.datum.slice(5, 7) - 1]} ${a.datum.slice(0, 4)}` : "Ohne Datum";
        if (g !== lastGroup) {
          html += `<div class="group-label" style="--i:${Math.min(i, 24)}">${g}</div>`;
          lastGroup = g;
        }
      }
      html += cardHTML(a, i++);
    }
    els.list.innerHTML = html;
  }

  function render({ transition = false } = {}) {
    const run = () => { renderStats(); renderFilters(); renderList(); };
    if (transition && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(run);
    } else run();
  }

  /* ---------- Drawer ---------- */
  const drawer = $("#drawer"), overlay = $("#overlay"), form = $("#form");
  const statusPicker = $("#statusPicker"), linksList = $("#linksList"), notesList = $("#notesList");
  const linkType = $("#linkType"), linkUrl = $("#linkUrl"), noteText = $("#noteText");
  let lastFocus = null;

  linkType.innerHTML = LINK_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");

  function openDrawer(app) {
    state.isNew = !app;
    state.draft = app ? structuredClone(app) : {
      id: uid(), firma: "", stelle: "", datum: todayISO(), status: "offen", absageAm: "", links: [], notes: [], updated: Date.now(),
    };
    state.draftOriginal = JSON.stringify(state.draft);
    lastFocus = document.activeElement;

    form.firma.value = state.draft.firma;
    form.stelle.value = state.draft.stelle;
    form.datum.value = state.draft.datum;
    form.absageAm.value = state.draft.absageAm;
    form.firma.classList.remove("invalid");
    linkUrl.value = ""; noteText.value = "";
    linkType.value = "bestaetigung";
    $("#deleteBtn").hidden = state.isNew;

    renderDrawerHead(); renderStatusPicker(); renderLinks(); renderNotes();

    overlay.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { overlay.classList.add("show"); drawer.classList.add("open"); });
    setTimeout(() => (state.isNew ? form.firma : drawer.querySelector(".drawer-head .icon-btn")).focus({ preventScroll: true }), 120);
  }

  function closeDrawer(force = false) {
    if (!drawer.classList.contains("open")) return;
    if (!force && isDirty() && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    drawer.classList.remove("open");
    overlay.classList.remove("show");
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(() => { if (!drawer.classList.contains("open")) overlay.hidden = true; }, 350);
    state.draft = null;
    lastFocus?.focus?.({ preventScroll: true });
  }

  function syncDraftFields() {
    const d = state.draft;
    d.firma = form.firma.value.trim();
    d.stelle = form.stelle.value.trim();
    d.datum = form.datum.value;
    d.absageAm = form.absageAm.value;
  }

  function isDirty() {
    if (!state.draft) return false;
    syncDraftFields();
    return JSON.stringify(state.draft) !== state.draftOriginal || linkUrl.value.trim() || noteText.value.trim();
  }

  function renderDrawerHead() {
    const d = state.draft;
    const name = form.firma.value.trim();
    const av = $("#drawerAvatar");
    av.textContent = initials(name || "?");
    av.style.setProperty("--h", hue(name));
    $("#drawerTitle").textContent = name || (state.isNew ? "Neue Bewerbung" : "Bewerbung");
    $("#drawerMeta").textContent = state.isNew
      ? "Erfasse die Eckdaten deiner Bewerbung"
      : [form.stelle.value.trim(), d.datum && `beworben ${relDays(daysSince(d.datum))}`].filter(Boolean).join(" · ");
  }

  function renderStatusPicker() {
    statusPicker.innerHTML = STATUSES.map((s) => `
      <button type="button" class="status-opt ${state.draft.status === s.id ? "active" : ""}" data-status="${s.id}" style="--c:${s.color}">
        <i></i>${s.label}
      </button>`).join("");
  }

  function prettyUrl(u) {
    try {
      const url = new URL(u);
      return url.hostname.replace(/^www\./, "") + (url.pathname.length > 1 ? url.pathname : "");
    } catch { return u; }
  }

  function renderLinks() {
    const links = state.draft.links;
    linksList.innerHTML = links.length ? links.map((l) => {
      const t = LINK_TYPE[l.type] || LINK_TYPE.sonstiges;
      const href = /^https?:\/\//i.test(l.url) ? l.url : "https://" + l.url;
      return `
        <div class="link-item" data-id="${l.id}">
          <span class="link-icon" style="--c:${t.color}">${l.url.includes("mail.") ? ICONS.mail : ICONS.link}</span>
          <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">
            <b>${t.label}</b><small>${esc(prettyUrl(l.url))}</small>
          </a>
          <button type="button" class="mini-btn" data-remove-link="${l.id}" aria-label="Link entfernen">${ICONS.x}</button>
        </div>`;
    }).join("") : `<div class="empty-mini">Noch keine Links – füge z.B. den Gmail-Link zur Bestätigung hinzu.</div>`;
  }

  function renderNotes() {
    const notes = [...state.draft.notes].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    notesList.innerHTML = notes.map((n) => `
      <li class="note" data-id="${n.id}">
        <div class="note-head">
          <time>${fmtDateLong(n.date)}</time>
          <button type="button" class="mini-btn" data-remove-note="${n.id}" aria-label="Notiz löschen">${ICONS.x}</button>
        </div>
        <p>${esc(n.text)}</p>
      </li>`).join("");
  }

  function addLink() {
    const url = linkUrl.value.trim();
    if (!url) { linkUrl.focus(); return false; }
    state.draft.links.push({ id: uid(), type: linkType.value, url });
    // auto-advance status when a link implies it
    if (linkType.value === "absage" && state.draft.status !== "absage") {
      state.draft.status = "absage";
      if (!form.absageAm.value) form.absageAm.value = todayISO();
      renderStatusPicker();
    } else if (linkType.value === "einladung" && ["offen", "keine"].includes(state.draft.status)) {
      state.draft.status = "einladung";
      renderStatusPicker();
    }
    linkUrl.value = "";
    renderLinks();
    return true;
  }

  function addNote() {
    const text = noteText.value.trim();
    if (!text) { noteText.focus(); return false; }
    state.draft.notes.push({ id: uid(), text, date: todayISO() });
    noteText.value = "";
    renderNotes();
    return true;
  }

  function saveDraft() {
    syncDraftFields();
    if (!state.draft.firma) {
      form.firma.classList.remove("invalid");
      void form.firma.offsetWidth;
      form.firma.classList.add("invalid");
      form.firma.focus();
      return;
    }
    if (linkUrl.value.trim()) addLink();
    if (noteText.value.trim()) addNote();
    state.draft.updated = Date.now();
    const idx = state.apps.findIndex((a) => a.id === state.draft.id);
    if (idx >= 0) state.apps[idx] = state.draft; else state.apps.unshift(state.draft);
    const name = state.draft.firma, wasNew = state.isNew;
    persist();
    closeDrawer(true);
    render({ transition: true });
    toast(wasNew ? `${name} hinzugefügt` : `${name} gespeichert`);
    flashCard(state.apps[idx >= 0 ? idx : 0]?.id);
  }

  function flashCard(id) {
    const el = els.list.querySelector(`[data-id="${id}"]`);
    if (!el) return;
    el.animate(
      [{ boxShadow: "0 0 0 0 rgba(99,102,241,0.5)" }, { boxShadow: "0 0 0 8px rgba(99,102,241,0)" }],
      { duration: 900, easing: "ease-out", delay: 250 }
    );
  }

  function deleteDraft() {
    const app = state.apps.find((a) => a.id === state.draft.id);
    if (!app) return;
    const idx = state.apps.indexOf(app);
    state.apps.splice(idx, 1);
    persist();
    closeDrawer(true);
    render({ transition: true });
    toast(`${app.firma} gelöscht`, {
      action: "Rückgängig",
      onAction: () => { state.apps.splice(idx, 0, app); persist(); render({ transition: true }); },
    });
  }

  /* ---------- Toast ---------- */
  function toast(msg, { action, onAction } = {}) {
    const t = document.createElement("div");
    t.className = "toast";
    t.innerHTML = `${ICONS.check}<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action)}</button>` : ""}`;
    $("#toasts").appendChild(t);
    const remove = () => { t.classList.add("out"); setTimeout(() => t.remove(), 300); };
    if (action) t.querySelector("button").onclick = () => { onAction(); remove(); };
    setTimeout(remove, action ? 5000 : 2600);
  }

  /* ---------- Import / Export ---------- */
  function importFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      try {
        if (file.name.toLowerCase().endsWith(".json") || text.trim().startsWith("[")) {
          const data = JSON.parse(text);
          if (!Array.isArray(data)) throw new Error("Ungültiges Format");
          if (state.apps.length && !confirm(`Backup mit ${data.length} Einträgen laden? Aktuelle Daten werden ersetzt.`)) return;
          state.apps = data.map(normalize);
          toast(`${data.length} Bewerbungen geladen`);
        } else {
          const incoming = appsFromCSV(text);
          const key = (a) => `${a.firma.toLowerCase()}|${a.stelle.toLowerCase()}|${a.datum}`;
          const existing = new Set(state.apps.map(key));
          const fresh = incoming.filter((a) => !existing.has(key(a)));
          state.apps.push(...fresh);
          toast(`${fresh.length} neue importiert${incoming.length - fresh.length ? `, ${incoming.length - fresh.length} Duplikate übersprungen` : ""}`);
        }
        persist();
        render({ transition: true });
      } catch (e) {
        toast("Datei konnte nicht gelesen werden");
      }
    };
    reader.readAsText(file);
  }

  function normalize(a) {
    return {
      id: a.id || uid(),
      firma: String(a.firma || ""),
      stelle: String(a.stelle || ""),
      datum: parseDate(a.datum),
      status: STATUS[a.status] ? a.status : statusFromText(a.status),
      absageAm: parseDate(a.absageAm),
      links: Array.isArray(a.links) ? a.links.filter((l) => l && l.url).map((l) => ({ id: l.id || uid(), type: LINK_TYPE[l.type] ? l.type : "sonstiges", url: String(l.url) })) : [],
      notes: Array.isArray(a.notes) ? a.notes.filter((n) => n && n.text).map((n) => ({ id: n.id || uid(), text: String(n.text), date: parseDate(n.date) || todayISO() })) : [],
      updated: a.updated || Date.now(),
    };
  }

  /* ---------- Theme ---------- */
  function applyTheme(t) {
    if (t) document.documentElement.dataset.theme = t;
    else delete document.documentElement.dataset.theme;
  }
  function toggleTheme() {
    const isDark = document.documentElement.dataset.theme
      ? document.documentElement.dataset.theme === "dark"
      : matchMedia("(prefers-color-scheme: dark)").matches;
    const next = isDark ? "light" : "dark";
    const run = () => applyTheme(next);
    document.startViewTransition ? document.startViewTransition(run) : run();
    try { localStorage.setItem(THEME_KEY, next); } catch {}
  }
  try { applyTheme(localStorage.getItem(THEME_KEY)); } catch {}

  /* ---------- Menu ---------- */
  const menu = $("#menu"), menuBtn = $("#menuBtn");
  const closeMenu = () => menu.classList.remove("open");

  function handleAction(action) {
    closeMenu();
    const stamp = todayISO();
    switch (action) {
      case "add": openDrawer(null); break;
      case "export-csv":
        download(`bewerbungen-${stamp}.csv`, appsToCSV(state.apps), "text/csv;charset=utf-8");
        toast("CSV exportiert"); break;
      case "export-json":
        download(`bewerbungen-backup-${stamp}.json`, JSON.stringify(state.apps, null, 2), "application/json");
        toast("Backup gespeichert"); break;
      case "import": $("#fileInput").click(); break;
      case "theme": toggleTheme(); break;
      case "reset":
        if (confirm("Wirklich ALLE Bewerbungen löschen? Tipp: vorher ein Backup speichern.")) {
          state.apps = []; persist(); render({ transition: true }); toast("Alle Daten gelöscht");
        }
        break;
    }
  }

  /* ---------- Events ---------- */
  $("#addBtn").addEventListener("click", () => openDrawer(null));
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) closeMenu();
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) handleAction(actionEl.dataset.action);
  });

  $("#fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) importFile(f);
    e.target.value = "";
  });

  els.filters.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip || chip.dataset.filter === state.filter) return;
    state.filter = chip.dataset.filter;
    render({ transition: true });
  });

  let searchTimer;
  els.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = els.search.value; renderList(); }, 120);
  });
  els.sort.addEventListener("change", () => { state.sort = els.sort.value; render({ transition: true }); });

  els.list.addEventListener("click", (e) => {
    const card = e.target.closest(".card");
    if (!card) return;
    const app = state.apps.find((a) => a.id === card.dataset.id);
    if (app) openDrawer(app);
  });

  overlay.addEventListener("click", () => closeDrawer());
  drawer.addEventListener("click", (e) => {
    if (e.target.closest("[data-close]")) return closeDrawer();
    const st = e.target.closest("[data-status]");
    if (st) {
      state.draft.status = st.dataset.status;
      if (st.dataset.status === "absage" && !form.absageAm.value) form.absageAm.value = todayISO();
      renderStatusPicker();
      return;
    }
    const rl = e.target.closest("[data-remove-link]");
    if (rl) {
      state.draft.links = state.draft.links.filter((l) => l.id !== rl.dataset.removeLink);
      return renderLinks();
    }
    const rn = e.target.closest("[data-remove-note]");
    if (rn) {
      state.draft.notes = state.draft.notes.filter((n) => n.id !== rn.dataset.removeNote);
      return renderNotes();
    }
  });
  form.firma.addEventListener("input", renderDrawerHead);
  form.stelle.addEventListener("input", renderDrawerHead);
  $("#addLinkBtn").addEventListener("click", addLink);
  linkUrl.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addLink(); } });
  $("#addNoteBtn").addEventListener("click", addNote);
  noteText.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addNote(); }
  });
  $("#deleteBtn").addEventListener("click", deleteDraft);
  form.addEventListener("submit", (e) => { e.preventDefault(); saveDraft(); });

  document.addEventListener("keydown", (e) => {
    const open = drawer.classList.contains("open");
    if (e.key === "Escape") { if (open) closeDrawer(); else closeMenu(); return; }
    if (open && e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveDraft(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (open || typing) return;
    if (e.key === "/") { e.preventDefault(); els.search.focus(); }
    else if (e.key === "n") { e.preventDefault(); openDrawer(null); }
  });

  window.addEventListener("beforeunload", (e) => {
    if (drawer.classList.contains("open") && isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- Boot ---------- */
  async function boot() {
    const saved = load();
    if (saved) {
      state.apps = saved.map(normalize);
    } else {
      try {
        const res = await fetch(SEED_URL, { cache: "no-store" });
        if (res.ok) {
          state.apps = appsFromCSV(await res.text());
          persist();
          if (state.apps.length) setTimeout(() => toast(`${state.apps.length} Bewerbungen aus CSV geladen`), 600);
        }
      } catch { /* opened via file:// – start empty, user can import */ }
    }
    render();
  }
  boot();
})();
