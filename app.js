(() => {
  "use strict";

  /* ---------- Config ---------- */
  const STORAGE_KEY = "bwrb.applications.v1";
  const OPEN_KEY = "bwrb.openMonths";
  const SEED_FIX_KEY = "bwrb.seedFix";
  const SEED_FIX_VERSION = "2";
  const SEED_URL = "data/bewerbungen.csv";

  // Ergebnis (outcome) – how it ended / where it stands
  const STATUSES = [
    { id: "offen", label: "Offen", color: "var(--s-offen)" },
    { id: "angebot", label: "Angebot", color: "var(--s-angebot)" },
    { id: "absage", label: "Absage", color: "var(--s-absage)" },
    { id: "keine", label: "Keine Antwort", color: "var(--s-keine)" },
    { id: "zurueckgezogen", label: "Zurückgezogen", color: "var(--s-zurueck)" },
  ];
  const STATUS = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

  // Verlauf (progress) – how far the application got
  const PHASES = [
    { id: "beworben", label: "Beworben" },
    { id: "bestaetigt", label: "Bestätigt" },
    { id: "gespraech1", label: "1. Gespräch" },
    { id: "gespraech2", label: "2. Gespräch" },
    { id: "final", label: "Finale Runde" },
  ];
  const PHASE = Object.fromEntries(PHASES.map((p) => [p.id, p]));
  const phaseIdx = (id) => Math.max(0, PHASES.findIndex((p) => p.id === id));
  const INTERVIEW_IDX = phaseIdx("gespraech1");
  const hadInterview = (a) => phaseIdx(a.phase) >= INTERVIEW_IDX;

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
  // Maps free text (CSV "Status" column or legacy values) to { status, phase }
  function parseStatusText(t) {
    t = String(t || "").toLowerCase().trim();
    if (STATUS[t]) return { status: t, phase: null };
    if (t.startsWith("absage")) return { status: "absage", phase: null };
    if (t.includes("keine")) return { status: "keine", phase: null };
    if (t.includes("zurück")) return { status: "zurueckgezogen", phase: null };
    if (t.includes("angebot") || t.includes("zusage")) return { status: "angebot", phase: "gespraech1" };
    if (t.includes("einladung") || t.includes("interview") || t.includes("gespräch")) return { status: "offen", phase: "gespraech1" };
    return { status: "offen", phase: null };
  }
  function phaseFromText(t) {
    t = String(t || "").toLowerCase().trim();
    if (PHASE[t]) return t;
    const hit = PHASES.find((p) => p.label.toLowerCase() === t);
    if (hit) return hit.id;
    if (t.includes("final")) return "final";
    if (t.includes("2.")) return "gespraech2";
    if (t.includes("gespräch") || t.includes("interview") || t.includes("einladung")) return "gespraech1";
    if (t.includes("bestätig")) return "bestaetigt";
    return "";
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
    const iPhase = col("verlauf", "phase");
    const iAbsage = col("absage am", "entscheid");
    const iProofIn = head.findIndex((h) => h.includes("nachweis eingang") || h.includes("bestätigung"));
    const iProofOut = head.findIndex((h) => h.includes("nachweis outcome") || h.includes("outcome"));
    const iNote = col("bemerkung", "notiz", "notes");

    return rows.slice(1).map((r) => {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      const parsed = parseStatusText(get(iStatus));
      const status = parsed.status;
      const datum = parseDate(get(iDate));
      const links = [];
      get(iProofIn).split(/\s+/).filter(Boolean).forEach((url) => links.push({ id: uid(), type: "bestaetigung", url }));
      get(iProofOut).split(/\s+/).filter(Boolean).forEach((url) => {
        const t = status === "absage" ? "absage" : parsed.phase ? "einladung" : "sonstiges";
        links.push({ id: uid(), type: t, url });
      });
      const phase = phaseFromText(get(iPhase)) || parsed.phase || (links.some((l) => l.type === "bestaetigung") ? "bestaetigt" : "beworben");
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
        phase,
        phaseDates: {},
        absageAm: parseDate(get(iAbsage)),
        links, notes,
        updated: Date.now(),
      };
    }).filter((a) => a.firma);
  }

  function appsToCSV(apps) {
    const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const header = ["Monat", "Bewerbung / Eingang", "Firma", "Stelle", "Status", "Verlauf", "Absage am", "Nachweis Eingang", "Nachweis Outcome", "Bemerkung"];
    const lines = [header.map(q).join(";")];
    for (const a of sortApps(apps, "date-desc")) {
      const proofIn = a.links.filter((l) => l.type === "bestaetigung").map((l) => l.url).join(" ");
      const proofOut = a.links.filter((l) => l.type !== "bestaetigung").map((l) => l.url).join(" ");
      const month = a.datum ? MONTHS[+a.datum.slice(5, 7) - 1] : "";
      lines.push([
        month, fmtDate(a.datum), a.firma, a.stelle, STATUS[a.status]?.label || "", PHASE[a.phase]?.label || "",
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
    openMonths: new Set((() => { try { return JSON.parse(localStorage.getItem(OPEN_KEY)) || []; } catch { return []; } })()),
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
      if (state.filter === "gespraech") { if (!hadInterview(a)) return false; }
      else if (state.filter !== "alle" && a.status !== state.filter) return false;
      if (!q) return true;
      return [a.firma, a.stelle, STATUS[a.status]?.label, PHASE[a.phase]?.label, ...a.notes.map((n) => n.text)]
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
    const talks = state.apps.filter(hadInterview);
    const talksRejected = talks.filter((a) => a.status === "absage").length;
    const answered = state.apps.filter((a) => (a.status !== "offen" && a.status !== "keine") || hadInterview(a)).length;
    const rate = total ? Math.round((answered / total) * 100) : 0;
    const pct = (n) => (total ? Math.round((n / total) * 100) : 0);

    const tiles = [
      { key: "total", label: "Total", value: total, sub: `${rate}% mit Antwort`, c: "var(--accent)" },
      { key: "offen", label: "Offen", value: by.offen, sub: "warten auf Antwort", c: STATUS.offen.color },
      { key: "pos", label: "Gespräche", value: talks.length, sub: by.angebot ? `${pct(talks.length)}% eingeladen · ${by.angebot} Angebot${by.angebot > 1 ? "e" : ""}` : `${pct(talks.length)}% Einladungsquote`, c: "var(--s-phase)" },
      { key: "absage", label: "Absagen", value: by.absage, sub: talksRejected ? `davon ${talksRejected} nach Gespräch` : `${pct(by.absage)}% aller Bewerbungen`, c: STATUS.absage.color },
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
    counts.gespraech = state.apps.filter(hadInterview).length;
    const opts = [{ id: "alle", label: "Alle" }, { id: "gespraech", label: "Mit Gespräch", color: "var(--s-phase)" }, ...STATUSES];
    els.filters.innerHTML = opts.map((o) => `
      <button class="chip ${state.filter === o.id ? "active" : ""}" data-filter="${o.id}" role="tab"
        aria-selected="${state.filter === o.id}" ${o.color ? `style="--c:${o.color}"` : ""}>
        ${o.color ? "<i></i>" : ""}${o.label}<b>${counts[o.id]}</b>
      </button>`).join("");
  }

  function phaseTagHTML(a) {
    const idx = phaseIdx(a.phase);
    const dots = PHASES.map((p, i) => `<i class="${i < idx ? "on" : i === idx ? "on end" : ""}"></i>`).join("");
    return `<span class="phase-tag ${idx >= INTERVIEW_IDX ? "hot" : ""}" title="Verlauf: ${PHASE[a.phase]?.label || ""}"><span class="phase-dots">${dots}</span>${PHASE[a.phase]?.label || ""}</span>`;
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
            ${phaseTagHTML(a)}
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
    if (!grouped) {
      els.list.innerHTML = apps.map(cardHTML).join("");
      return;
    }

    // group by month, keeping the sort order
    const groups = new Map();
    for (const a of apps) {
      const key = a.datum ? a.datum.slice(0, 7) : "none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const searching = !!state.query.trim();
    let html = `
      <div class="list-tools">
        <button class="text-btn" data-toggle-all>${groups.size && [...groups.keys()].every((k) => state.openMonths.has(k)) ? "Alle zuklappen" : "Alle aufklappen"}</button>
      </div>`;
    let gi = 0;
    for (const [key, list] of groups) {
      const open = searching || state.openMonths.has(key);
      const name = key === "none" ? "Ohne Datum" : MONTHS[+key.slice(5, 7) - 1];
      const year = key === "none" ? "" : key.slice(0, 4);
      const by = STATUSES.map((s) => ({ ...s, n: list.filter((a) => a.status === s.id).length })).filter((s) => s.n);
      html += `
        <section class="month ${open ? "open" : ""}" data-month="${key}" style="--i:${gi++}">
          <button class="month-head" aria-expanded="${open}">
            <div class="month-cal"><b>${name.slice(0, 3)}</b><small>${year}</small></div>
            <div class="month-info">
              <h3>${name} ${year}</h3>
              <div class="month-stats">${by.map((s) => `<span style="--c:${s.color}"><i></i>${s.n} ${s.label}</span>`).join("")}${(() => { const n = list.filter(hadInterview).length; return n ? `<span class="talks" style="--c:var(--s-phase)"><i></i>${n} mit Gespräch</span>` : ""; })()}</div>
              <div class="month-bar">${by.map((s) => `<span style="--c:${s.color};flex:${s.n};--i:${gi}"></span>`).join("")}</div>
            </div>
            <div class="month-count"><b>${list.length}</b><small>${list.length === 1 ? "Bewerbung" : "Bewerbungen"}</small></div>
            <span class="chev"><svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></span>
          </button>
          <div class="month-body"><div class="month-inner"><div class="month-cards">
            ${list.map(cardHTML).join("")}
          </div></div></div>
        </section>`;
    }
    els.list.innerHTML = html;
  }

  function saveOpenMonths() {
    try { localStorage.setItem(OPEN_KEY, JSON.stringify([...state.openMonths])); } catch {}
  }

  function toggleMonth(section) {
    const key = section.dataset.month;
    const open = !section.classList.contains("open");
    section.classList.toggle("open", open);
    section.querySelector(".month-head").setAttribute("aria-expanded", open);
    open ? state.openMonths.add(key) : state.openMonths.delete(key);
    saveOpenMonths();
    const allOpen = [...els.list.querySelectorAll(".month")].every((m) => m.classList.contains("open"));
    const tg = els.list.querySelector("[data-toggle-all]");
    if (tg) tg.textContent = allOpen ? "Alle zuklappen" : "Alle aufklappen";
    if (open) setTimeout(() => {
      const r = section.getBoundingClientRect();
      if (r.bottom > innerHeight) section.scrollIntoView({ behavior: "smooth", block: r.height > innerHeight ? "start" : "nearest" });
    }, 300);
  }

  function render({ transition = false } = {}) {
    const run = () => { renderStats(); renderFilters(); renderList(); };
    if (transition && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(run);
    } else run();
  }

  /* ---------- Drawer ---------- */
  const drawer = $("#drawer"), overlay = $("#overlay"), form = $("#form");
  const statusPicker = $("#statusPicker"), phaseStepper = $("#phaseStepper"), phaseDateWrap = $("#phaseDateWrap"), phaseDate = $("#phaseDate"), linksList = $("#linksList"), notesList = $("#notesList");
  const linkType = $("#linkType"), linkUrl = $("#linkUrl"), noteText = $("#noteText");
  let lastFocus = null;

  linkType.innerHTML = LINK_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");

  function openDrawer(app) {
    state.isNew = !app;
    state.draft = app ? structuredClone(app) : {
      id: uid(), firma: "", stelle: "", datum: todayISO(), status: "offen", phase: "beworben", phaseDates: {}, absageAm: "", links: [], notes: [], updated: Date.now(),
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

    renderDrawerHead(); renderStatusPicker(); renderPhase(); renderLinks(); renderNotes();

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

  function renderPhase() {
    const d = state.draft;
    const idx = phaseIdx(d.phase);
    const endColor = d.status === "offen" ? "var(--s-phase)" : STATUS[d.status].color;
    phaseStepper.style.setProperty("--end", endColor);
    phaseStepper.innerHTML = PHASES.map((p, i) => {
      const date = i === 0 ? form.datum.value : d.phaseDates[p.id];
      const cls = i < idx ? "done" : i === idx ? "done current" : "";
      return `
        <button type="button" class="step ${cls}" data-phase="${p.id}" style="--i:${i}" aria-pressed="${i === idx}">
          <span class="step-dot">${i < idx || (i === idx && d.status !== "offen") ? (i === idx && d.status === "absage" ? ICONS.x : ICONS.check) : i + 1}</span>
          <span class="step-label">${p.label}</span>
          <span class="step-date">${i <= idx && date ? fmtDate(date).slice(0, 6) : ""}</span>
        </button>`;
    }).join("");
    phaseDateWrap.hidden = idx === 0;
    if (idx > 0) {
      $("#phaseDateLabel").textContent = `Datum „${PHASE[d.phase].label}“`;
      phaseDate.value = d.phaseDates[d.phase] || "";
    }
  }

  function setPhase(id) {
    const d = state.draft;
    d.phase = id;
    const idx = phaseIdx(id);
    // keep dates of reached steps, drop the ones beyond
    PHASES.forEach((p, i) => { if (i > idx) delete d.phaseDates[p.id]; });
    if (idx > 0 && !d.phaseDates[id]) d.phaseDates[id] = todayISO();
    renderPhase();
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
    // auto-advance Verlauf / Ergebnis when a link implies it
    const idx = phaseIdx(state.draft.phase);
    if (linkType.value === "absage" && state.draft.status !== "absage") {
      state.draft.status = "absage";
      if (!form.absageAm.value) form.absageAm.value = todayISO();
      renderStatusPicker(); renderPhase();
    } else if (linkType.value === "einladung" && idx < INTERVIEW_IDX) {
      if (state.draft.status === "keine") { state.draft.status = "offen"; renderStatusPicker(); }
      setPhase("gespraech1");
    } else if (linkType.value === "bestaetigung" && idx < 1) {
      setPhase("bestaetigt");
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
    state.openMonths.add(state.draft.datum ? state.draft.datum.slice(0, 7) : "none");
    saveOpenMonths();
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
    const parsed = parseStatusText(a.status);
    const links0 = Array.isArray(a.links) ? a.links : [];
    let phase = PHASE[a.phase] ? a.phase : parsed.phase
      || (links0.some((l) => l && l.type === "einladung") ? "gespraech1" : links0.some((l) => l && l.type === "bestaetigung") ? "bestaetigt" : "beworben");
    const phaseDates = {};
    if (a.phaseDates && typeof a.phaseDates === "object") {
      for (const [k, v] of Object.entries(a.phaseDates)) if (PHASE[k] && parseDate(v)) phaseDates[k] = parseDate(v);
    }
    return {
      id: a.id || uid(),
      firma: String(a.firma || ""),
      stelle: String(a.stelle || ""),
      datum: parseDate(a.datum),
      status: parsed.status,
      phase,
      phaseDates,
      absageAm: parseDate(a.absageAm),
      links: Array.isArray(a.links) ? a.links.filter((l) => l && l.url).map((l) => ({ id: l.id || uid(), type: LINK_TYPE[l.type] ? l.type : "sonstiges", url: String(l.url) })) : [],
      notes: Array.isArray(a.notes) ? a.notes.filter((n) => n && n.text).map((n) => ({ id: n.id || uid(), text: String(n.text), date: parseDate(n.date) || todayISO() })) : [],
      updated: a.updated || Date.now(),
    };
  }

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
    const head = e.target.closest(".month-head");
    if (head) return toggleMonth(head.closest(".month"));
    if (e.target.closest("[data-toggle-all]")) {
      const months = [...els.list.querySelectorAll(".month")];
      const openAll = !months.every((m) => m.classList.contains("open"));
      months.forEach((m) => (openAll ? state.openMonths.add(m.dataset.month) : state.openMonths.delete(m.dataset.month)));
      saveOpenMonths();
      return render({ transition: true });
    }
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
      if (["absage", "angebot"].includes(st.dataset.status) && !form.absageAm.value) form.absageAm.value = todayISO();
      renderStatusPicker(); renderPhase();
      return;
    }
    const ph = e.target.closest("[data-phase]");
    if (ph) return setPhase(ph.dataset.phase);
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
  phaseDate.addEventListener("change", () => {
    if (phaseDate.value) state.draft.phaseDates[state.draft.phase] = phaseDate.value;
    else delete state.draft.phaseDates[state.draft.phase];
    renderPhase();
  });
  form.datum.addEventListener("change", renderPhase);
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
  // One-time: take over corrected dates from the seed CSV for entries loaded from an older version of it
  async function applySeedDateFixes() {
    try {
      if (localStorage.getItem(SEED_FIX_KEY) === SEED_FIX_VERSION) return;
      const res = await fetch(SEED_URL, { cache: "no-store" });
      if (!res.ok) return;
      const key = (a) => `${a.firma.toLowerCase()}|${a.stelle.toLowerCase()}`;
      const seed = new Map(appsFromCSV(await res.text()).map((a) => [key(a), a]));
      let fixed = 0;
      for (const a of state.apps) {
        const s = seed.get(key(a));
        // only same day and year with a different month – a typo fix, not a user edit
        if (s && s.datum && a.datum && a.datum !== s.datum && a.datum.slice(8) === s.datum.slice(8) && a.datum.slice(0, 4) === s.datum.slice(0, 4)) {
          a.datum = s.datum; fixed++;
        }
      }
      if (fixed) { persist(); setTimeout(() => toast(`${fixed} Daten korrigiert`), 600); }
      localStorage.setItem(SEED_FIX_KEY, SEED_FIX_VERSION);
    } catch { /* ignore */ }
  }

  async function boot() {
    const saved = load();
    if (saved) {
      state.apps = saved.map(normalize);
      persist(); // store migrated format (Verlauf / Ergebnis)
      await applySeedDateFixes();
    } else {
      try {
        const res = await fetch(SEED_URL, { cache: "no-store" });
        if (res.ok) {
          state.apps = appsFromCSV(await res.text());
          persist();
          try { localStorage.setItem(SEED_FIX_KEY, SEED_FIX_VERSION); } catch {}
          if (state.apps.length) setTimeout(() => toast(`${state.apps.length} Bewerbungen aus CSV geladen`), 600);
        }
      } catch { /* opened via file:// – start empty, user can import */ }
    }
    render();
  }
  boot();
})();
