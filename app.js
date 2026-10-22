(() => {
  "use strict";

  /* ---------- Config ---------- */
  const STORAGE_KEY = "bwrb.applications.v1";
  const OPEN_KEY = "bwrb.openMonths";
  const SEED_FIX_KEY = "bwrb.seedFix";
  const SEED_FIX_VERSION = "2";
  const SEED_URL = "data/bewerbungen.csv";
  const VIEW_KEY = "bwrb.view";
  const PRIVACY_KEY = "bwrb.privacyMode";
  const SUPABASE_URL = "https://coxmnerqoaclawbbgipx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_2oKHLoM5fCrNiQ1FCpvPig_0Ci3zISR";
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let currentUser = null;
  let syncTimer = null;
  let syncGeneration = 0;

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
    download: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M5 21h14a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.5l6.8-4M8.6 13.5l6.8 4"/></svg>',
  };

  /* ---------- Helpers ---------- */
  const $ = (sel, root = document) => root.querySelector(sel);
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const todayISO = () => new Date().toISOString().slice(0, 10);

  function alphaCode(index) {
    let code = "";
    for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) code = String.fromCharCode(65 + ((n - 1) % 26)) + code;
    return code;
  }

  function privateCompany(name) {
    if (!state?.privacy) return String(name || "");
    const companies = [...new Set(state.apps.map((a) => String(a.firma || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, "de", { sensitivity: "base" }));
    const index = Math.max(0, companies.findIndex((company) => company === String(name || "").trim()));
    return `Unternehmen ${alphaCode(index)}`;
  }

  function privateInitials(name) {
    return state?.privacy ? "••" : initials(name);
  }

  function parseDate(str) {
    if (!str) return "";
    str = String(str).trim();
    let iso = "";
    let m = str.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
    if (m) {
      const y = m[3].length === 2 ? "20" + m[3] : m[3];
      iso = `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    } else {
      m = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
      if (m) iso = `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (!iso) return "";
    const [y, mo, d] = iso.split("-").map(Number);
    const test = new Date(Date.UTC(y, mo - 1, d));
    return test.getUTCFullYear() === y && test.getUTCMonth() === mo - 1 && test.getUTCDate() === d ? iso : "";
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
    return "";
  }

  /* ---------- Storage ---------- */
  function load() {
    try {
      const raw = localStorage.getItem(currentUser ? `${STORAGE_KEY}.${currentUser.id}` : STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function persist() {
    try { localStorage.setItem(`${STORAGE_KEY}.${currentUser?.id || "local"}`, JSON.stringify(state.apps)); }
    catch { toast("Speichern im Browser nicht möglich – bitte Backup exportieren"); }
    if (!currentUser) return;
    clearTimeout(syncTimer);
    const generation = ++syncGeneration;
    setSyncState("syncing", "Speichert…");
    syncTimer = setTimeout(() => syncRemote(generation), 350);
  }

  function setSyncState(kind, label) {
    const el = document.querySelector("#syncState");
    if (!el) return;
    el.className = `sync-state ${kind || ""}`;
    el.querySelector("span").textContent = label;
    el.title = label;
  }

  function toRow(a) {
    return {
      id: String(a.id), user_id: currentUser.id, firma: a.firma, stelle: a.stelle || "",
      datum: a.datum || null, status: a.status, phase: a.phase,
      phase_dates: a.phaseDates || {}, entscheid_am: a.absageAm || null,
      links: a.links || [], notes: a.notes || [], updated_at: Number(a.updated || Date.now()),
      job_url: a.jobUrl || null, job_description: a.jobDescription || null,
      company_logo_url: a.companyLogoUrl || null, location: a.location || null,
      employment_type: a.employmentType || null, workload: a.workload || null,
      work_model: a.workModel || null, contact_name: a.contactName || null,
      contact_email: a.contactEmail || null, salary_text: a.salaryText || null,
      follow_up_at: a.followUpAt || null, next_action: a.nextAction || null,
      source_metadata: a.sourceMetadata || {},
    };
  }

  function fromRow(row) {
    return normalize({
      id: row.id, firma: row.firma, stelle: row.stelle, datum: row.datum,
      status: row.status, phase: row.phase, phaseDates: row.phase_dates,
      absageAm: row.entscheid_am, links: row.links, notes: row.notes, updated: row.updated_at,
      jobUrl: row.job_url, jobDescription: row.job_description,
      companyLogoUrl: row.company_logo_url, location: row.location,
      employmentType: row.employment_type, workload: row.workload,
      workModel: row.work_model, contactName: row.contact_name,
      contactEmail: row.contact_email, salaryText: row.salary_text,
      followUpAt: row.follow_up_at, nextAction: row.next_action,
      sourceMetadata: row.source_metadata,
    });
  }

  async function syncRemote(generation) {
    if (!currentUser || generation !== syncGeneration) return;
    try {
      const rows = state.apps.map(toRow);
      if (rows.length) {
        const { error } = await db.from("applications").upsert(rows, { onConflict: "id" });
        if (error) throw error;
      }
      const { data: existing, error: readError } = await db.from("applications").select("id");
      if (readError) throw readError;
      const keep = new Set(rows.map((r) => r.id));
      const removed = (existing || []).map((r) => r.id).filter((id) => !keep.has(id));
      if (removed.length) {
        const { error } = await db.from("applications").delete().in("id", removed);
        if (error) throw error;
      }
      if (generation === syncGeneration) setSyncState("", "Gespeichert");
    } catch (error) {
      console.error("Supabase sync failed", error);
      setSyncState("error", "Nicht synchronisiert");
      toast(error.code === "42P01" ? "Supabase ist noch nicht eingerichtet" : "Cloud-Speicherung fehlgeschlagen");
    }
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

  function inspectCSV(text) {
    const rows = parseCSV(text);
    if (!rows.length) return { apps: [], errors: ["Die Datei ist leer."], total: 0 };
    const head = rows[0].map((h) => h.toLowerCase().trim());
    const col = (...names) => head.findIndex((h) => names.includes(h));
    const iDate = col("bewerbung / eingang", "bewerbung", "bewerbungsdatum", "datum", "eingang");
    const iFirma = col("firma", "unternehmen", "company");
    const iStelle = col("stelle", "position", "job");
    const iStatus = col("status");
    const iPhase = col("verlauf", "phase");
    const iAbsage = col("absage am", "entscheid", "entscheid am");
    const iProofIn = head.findIndex((h) => h.includes("nachweis eingang") || h.includes("bestätigung"));
    const iProofOut = head.findIndex((h) => h.includes("nachweis outcome") || h.includes("outcome"));
    const iNote = col("bemerkung", "notiz", "notizen", "notes");

    if (iFirma < 0) return { apps: [], errors: ['Die Pflichtspalte „Firma“ fehlt.'], total: Math.max(0, rows.length - 1) };

    const apps = [], errors = [];
    rows.slice(1).forEach((r, index) => {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      const rowNo = index + 2;
      const firma = get(iFirma);
      const dateRaw = get(iDate), decisionRaw = get(iAbsage), statusRaw = get(iStatus), phaseRaw = get(iPhase);
      const rowErrors = [];
      if (!firma) rowErrors.push("Firma fehlt");
      if (dateRaw && !parseDate(dateRaw)) rowErrors.push("Bewerbungsdatum ist ungültig");
      if (decisionRaw && !parseDate(decisionRaw)) rowErrors.push("Entscheiddatum ist ungültig");
      if (phaseRaw && !phaseFromText(phaseRaw)) rowErrors.push(`Verlauf „${phaseRaw}“ ist unbekannt`);
      if (statusRaw) {
        const s = statusRaw.toLowerCase();
        const known = STATUS[s] || s.startsWith("absage") || s.includes("keine") || s.includes("zurück")
          || s.includes("angebot") || s.includes("zusage") || s.includes("einladung") || s.includes("interview") || s.includes("gespräch");
        if (!known) rowErrors.push(`Status „${statusRaw}“ ist unbekannt`);
      }
      if (rowErrors.length) {
        errors.push(`Zeile ${rowNo}: ${rowErrors.join(", ")}`);
        return;
      }
      const parsed = parseStatusText(get(iStatus));
      const status = parsed.status;
      const datum = parseDate(get(iDate));
      const links = [];
      get(iProofIn).split(/\s+/).filter(Boolean).forEach((url) => links.push({ id: uid(), type: "bestaetigung", url }));
      get(iProofOut).split(/\s+/).filter(Boolean).forEach((url) => {
        const t = status === "absage" ? "absage" : parsed.phase ? "einladung" : "sonstiges";
        links.push({ id: uid(), type: t, url });
      });
      const phase = phaseFromText(get(iPhase)) || parsed.phase || "beworben";
      const notes = [];
      if (get(iNote)) {
        get(iNote).split(" | ").forEach((t) => t.trim() && notes.push({ id: uid(), text: t.trim(), date: datum || todayISO() }));
      }
      apps.push({
        id: uid(),
        firma,
        stelle: get(iStelle),
        datum,
        status,
        phase,
        phaseDates: {},
        absageAm: parseDate(get(iAbsage)),
        links, notes,
        updated: Date.now(),
      });
    });
    if (!rows.slice(1).length) errors.push("Die Datei enthält keine Datenzeilen.");
    return { apps, errors, total: Math.max(0, rows.length - 1) };
  }

  function appsFromCSV(text) {
    return inspectCSV(text).apps;
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
    view: "list",
    privacy: (() => { try { return localStorage.getItem(PRIVACY_KEY) === "1"; } catch { return false; } })(),
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
        <div class="avatar" style="--h:${hue(a.firma)}">${esc(privateInitials(a.firma))}</div>
        <div class="card-main">
          <div class="card-title"><strong>${esc(privateCompany(a.firma))}</strong></div>
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
          <div class="month-head-row">
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
            <div class="month-actions">
              <button class="month-action share" data-share-month="${key}" aria-label="${name} ${year} als Karte teilen" title="Monatskarte teilen">${ICONS.share}</button>
              <button class="month-action" data-export-month="${key}" aria-label="${name} ${year} als CSV exportieren" title="${name} ${year} als CSV exportieren">${ICONS.download}</button>
            </div>
          </div>
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

  function exportMonth(key) {
    const apps = state.apps.filter((a) => key === "none" ? !a.datum : a.datum?.slice(0, 7) === key);
    if (!apps.length) return toast("Keine Bewerbungen in diesem Monat");
    const label = key === "none" ? "ohne-datum" : key;
    download(`bewerbungen-${label}.csv`, appsToCSV(apps), "text/csv;charset=utf-8");
    const name = key === "none" ? "Ohne Datum" : `${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}`;
    toast(`${name} als CSV exportiert`);
  }

  function roundRect(ctx, x, y, w, h, r, fill) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function shareCardForMonth(key) {
    const apps = state.apps.filter((a) => key === "none" ? !a.datum : a.datum?.slice(0, 7) === key);
    if (!apps.length) return toast("Keine Bewerbungen in diesem Monat");

    const name = key === "none" ? "Ohne Datum" : MONTHS[+key.slice(5, 7) - 1];
    const year = key === "none" ? "" : key.slice(0, 4);
    const total = apps.length;
    const counts = Object.fromEntries(STATUSES.map((s) => [s.id, apps.filter((a) => a.status === s.id).length]));
    const talks = apps.filter(hadInterview).length;
    const answered = apps.filter((a) => (a.status !== "offen" && a.status !== "keine") || hadInterview(a)).length;
    const pct = (n) => total ? Math.round(n / total * 100) : 0;
    const roleCounts = new Map();
    apps.forEach((a) => {
      const cleaned = cleanRole(a.stelle) || "Nicht angegeben";
      const role = ROLE_ALIASES[cleaned.toLowerCase()] || cleaned;
      roleCounts.set(role, (roleCounts.get(role) || 0) + 1);
    });
    const roles = [...roleCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "de")).slice(0, 3);

    const canvas = document.createElement("canvas");
    canvas.width = 1200; canvas.height = 1500;
    const ctx = canvas.getContext("2d");
    const palette = { offen: "#3b82f6", angebot: "#10b981", absage: "#f43f5e", keine: "#94a3b8", zurueckgezogen: "#64748b" };
    const shown = STATUSES.filter((s) => counts[s.id]);

    // Pearl background + soft aurora light
    const bg = ctx.createLinearGradient(0, 0, 1200, 1500);
    bg.addColorStop(0, "#f8f7ff"); bg.addColorStop(.46, "#eef5ff"); bg.addColorStop(1, "#fff7f0");
    ctx.fillStyle = bg; ctx.fillRect(0, 0, 1200, 1500);
    const orb = (x, y, radius, inner) => {
      const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
      g.addColorStop(0, inner); g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g; ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    };
    orb(1040, 150, 580, "rgba(167,139,250,.42)");
    orb(120, 920, 520, "rgba(96,165,250,.30)");
    orb(1080, 1320, 430, "rgba(251,146,60,.22)");
    // subtle tactile grain
    let seed = total * 97 + (key === "none" ? 7 : Number(key.replace("-", "")));
    for (let i = 0; i < 1000; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const x = seed % 1200; seed = (seed * 1664525 + 1013904223) >>> 0;
      const y = seed % 1500;
      ctx.fillStyle = `rgba(30,41,59,${.012 + (seed % 8) / 1000})`; ctx.fillRect(x, y, 1.5, 1.5);
    }

    const glass = (x, y, w, h, r = 34, alpha = .58) => {
      ctx.save();
      ctx.shadowColor = "rgba(70,55,130,.13)"; ctx.shadowBlur = 42; ctx.shadowOffsetY = 18;
      roundRect(ctx, x, y, w, h, r, `rgba(255,255,255,${alpha})`);
      ctx.shadowColor = "transparent"; ctx.lineWidth = 2;
      const stroke = ctx.createLinearGradient(x, y, x + w, y + h);
      stroke.addColorStop(0, "rgba(255,255,255,.96)"); stroke.addColorStop(.55, "rgba(255,255,255,.46)"); stroke.addColorStop(1, "rgba(139,92,246,.16)");
      ctx.strokeStyle = stroke; ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.stroke();
      ctx.restore();
    };

    // Editorial header
    const iconGrad = ctx.createLinearGradient(68, 62, 148, 142);
    iconGrad.addColorStop(0, "#4f46e5"); iconGrad.addColorStop(.55, "#7c3aed"); iconGrad.addColorStop(1, "#a855f7");
    roundRect(ctx, 66, 60, 82, 82, 25, iconGrad);
    ctx.strokeStyle = "rgba(255,255,255,.88)"; ctx.lineWidth = 8; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(91, 119); ctx.lineTo(124, 86); ctx.stroke();
    [91, 107.5, 124].forEach((v, i) => { ctx.beginPath(); ctx.arc(v, 119 - i * 16.5, 7, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill(); });
    ctx.fillStyle = "#111827"; ctx.font = "750 29px Inter, system-ui, sans-serif"; ctx.fillText("BEWERBUNGEN", 172, 96);
    ctx.fillStyle = "#64748b"; ctx.font = "520 20px Inter, system-ui, sans-serif"; ctx.fillText("MONTHLY REPORT", 173, 130);
    roundRect(ctx, 910, 70, 220, 54, 27, "rgba(255,255,255,.55)");
    ctx.fillStyle = "#6d28d9"; ctx.font = "700 18px Inter, system-ui, sans-serif"; ctx.textAlign = "center"; ctx.fillText(`${name.toUpperCase()} · ${year}`, 1020, 104); ctx.textAlign = "left";

    ctx.fillStyle = "#111827"; ctx.font = "760 82px Inter, system-ui, sans-serif"; ctx.fillText("Mein Monat.", 66, 260);
    ctx.fillStyle = "#475569"; ctx.font = "520 29px Inter, system-ui, sans-serif"; ctx.fillText("Fortschritt in Zahlen – klar, ehrlich, sichtbar.", 70, 310);

    // Hero glass
    glass(66, 360, 1068, 300, 44, .50);
    const heroGrad = ctx.createLinearGradient(110, 400, 430, 620);
    heroGrad.addColorStop(0, "#4f46e5"); heroGrad.addColorStop(1, "#9333ea");
    ctx.fillStyle = heroGrad; ctx.font = "780 178px Inter, system-ui, sans-serif"; ctx.fillText(String(total), 106, 570);
    ctx.fillStyle = "#475569"; ctx.font = "700 21px Inter, system-ui, sans-serif"; ctx.fillText(total === 1 ? "BEWERBUNG" : "BEWERBUNGEN", 116, 615);
    const summary = answered
      ? `${answered} Rückmeldung${answered === 1 ? "" : "en"} · ${talks ? `${talks} Gespräch${talks === 1 ? "" : "e"}` : "weiter im Prozess"}`
      : "Konsequent gestartet · Antworten folgen";
    ctx.fillStyle = "#111827"; ctx.font = "700 34px Inter, system-ui, sans-serif"; ctx.fillText(summary, 455, 460);
    ctx.fillStyle = "#64748b"; ctx.font = "500 23px Inter, system-ui, sans-serif"; ctx.fillText(`${pct(answered)} % beantwortet`, 455, 505);
    roundRect(ctx, 455, 548, 580, 18, 9, "rgba(99,102,241,.12)");
    const progress = ctx.createLinearGradient(455, 0, 1035, 0); progress.addColorStop(0, "#6366f1"); progress.addColorStop(1, "#c084fc");
    if (answered) roundRect(ctx, 455, 548, 580 * answered / total, 18, 9, progress);

    // Bento metrics
    const cards = [
      { x: 66, w: 332, value: `${pct(answered)}%`, label: "Antwortquote", color: "#6366f1", note: `${answered} von ${total}` },
      { x: 416, w: 332, value: `${pct(talks)}%`, label: "Gesprächsquote", color: "#8b5cf6", note: talks ? `${talks} erreicht` : "noch offen" },
      { x: 766, w: 368, value: String(counts.offen || 0), label: "Aktuell offen", color: "#3b82f6", note: "im Rennen" },
    ];
    cards.forEach((c) => {
      glass(c.x, 700, c.w, 190, 32, .48);
      ctx.beginPath(); ctx.arc(c.x + 42, 744, 9, 0, Math.PI * 2); ctx.fillStyle = c.color; ctx.fill();
      ctx.fillStyle = "#111827"; ctx.font = "760 54px Inter, system-ui, sans-serif"; ctx.fillText(c.value, c.x + 30, 818);
      ctx.fillStyle = "#475569"; ctx.font = "650 20px Inter, system-ui, sans-serif"; ctx.fillText(c.label, c.x + 30, 854);
      ctx.textAlign = "right"; ctx.fillStyle = "#94a3b8"; ctx.font = "550 17px Inter, system-ui, sans-serif"; ctx.fillText(c.note, c.x + c.w - 26, 854); ctx.textAlign = "left";
    });

    // Status glass + donut
    glass(66, 930, 520, 390, 38, .53);
    ctx.fillStyle = "#111827"; ctx.font = "730 28px Inter, system-ui, sans-serif"; ctx.fillText("Status", 102, 985);
    const cx = 236, cy = 1124, radius = 92;
    let start = -Math.PI / 2;
    shown.forEach((s) => {
      const angle = Math.PI * 2 * counts[s.id] / total;
      ctx.beginPath(); ctx.arc(cx, cy, radius, start, start + angle); ctx.strokeStyle = palette[s.id]; ctx.lineWidth = 34; ctx.lineCap = "butt"; ctx.stroke(); start += angle;
    });
    ctx.textAlign = "center"; ctx.fillStyle = "#111827"; ctx.font = "760 39px Inter, system-ui, sans-serif"; ctx.fillText(String(total), cx, cy + 10);
    ctx.fillStyle = "#94a3b8"; ctx.font = "600 15px Inter, system-ui, sans-serif"; ctx.fillText("TOTAL", cx, cy + 37); ctx.textAlign = "left";
    shown.slice(0, 4).forEach((s, i) => {
      const x = 370, y = 1050 + i * 55;
      ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = palette[s.id]; ctx.fill();
      ctx.fillStyle = "#475569"; ctx.font = "560 18px Inter, system-ui, sans-serif"; ctx.fillText(s.label, x + 22, y + 6);
      ctx.textAlign = "right"; ctx.fillStyle = "#111827"; ctx.font = "720 19px Inter, system-ui, sans-serif"; ctx.fillText(String(counts[s.id]), 545, y + 6); ctx.textAlign = "left";
    });

    // Roles glass
    glass(616, 930, 518, 390, 38, .53);
    ctx.fillStyle = "#111827"; ctx.font = "730 28px Inter, system-ui, sans-serif"; ctx.fillText("Rollen im Fokus", 652, 985);
    roles.forEach(([role, count], i) => {
      const y = 1048 + i * 84;
      roundRect(ctx, 650, y, 450, 66, 22, i === 0 ? "rgba(99,102,241,.11)" : "rgba(255,255,255,.44)");
      ctx.fillStyle = i === 0 ? "#6366f1" : "#94a3b8"; ctx.font = "750 17px Inter, system-ui, sans-serif"; ctx.fillText(String(i + 1).padStart(2, "0"), 674, y + 40);
      ctx.fillStyle = "#334155"; ctx.font = "620 18px Inter, system-ui, sans-serif";
      const label = role.length > 30 ? role.slice(0, 27) + "…" : role;
      ctx.fillText(label, 724, y + 40);
      ctx.textAlign = "right"; ctx.fillStyle = "#64748b"; ctx.font = "700 18px Inter, system-ui, sans-serif"; ctx.fillText(`${count}×`, 1072, y + 40); ctx.textAlign = "left";
    });

    roundRect(ctx, 66, 1360, 1068, 2, 1, "rgba(100,116,139,.22)");
    ctx.fillStyle = "#64748b"; ctx.font = "540 19px Inter, system-ui, sans-serif"; ctx.fillText("Nicht perfekt. Aber konsequent.", 68, 1420);
    ctx.fillStyle = "#111827"; ctx.font = "720 19px Inter, system-ui, sans-serif"; ctx.textAlign = "right"; ctx.fillText("BEWERBUNGEN · 2026", 1132, 1420); ctx.textAlign = "left";

    const data = canvas.toDataURL("image/png");
    const binary = atob(data.split(",")[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const filename = `bewerbungsmonat-${key === "none" ? "ohne-datum" : key}.png`;
    const file = new File([bytes], filename, { type: "image/png" });
    openSharePreview({ file, data, title: `Mein Bewerbungsmonat ${name} ${year}`.trim() });
  }

  const sharePreview = $("#sharePreview"), sharePreviewOverlay = $("#sharePreviewOverlay");
  const sharePreviewImage = $("#sharePreviewImage"), nativeShareCard = $("#nativeShareCard");
  let pendingShareCard = null;

  function openSharePreview(card) {
    pendingShareCard = card;
    sharePreviewImage.src = card.data;
    const canShare = !!(navigator.share && navigator.canShare?.({ files: [card.file] }));
    nativeShareCard.hidden = !canShare;
    sharePreviewOverlay.hidden = false;
    sharePreview.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { sharePreviewOverlay.classList.add("show"); sharePreview.classList.add("open"); });
    setTimeout(() => (canShare ? nativeShareCard : $("#downloadShareCard")).focus({ preventScroll: true }), 100);
  }

  function closeSharePreview() {
    if (!sharePreview.classList.contains("open")) return;
    sharePreview.classList.remove("open");
    sharePreviewOverlay.classList.remove("show");
    sharePreview.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(() => { if (!sharePreview.classList.contains("open")) sharePreviewOverlay.hidden = true; }, 300);
  }

  sharePreviewOverlay.addEventListener("click", closeSharePreview);
  sharePreview.addEventListener("click", (e) => { if (e.target.closest("[data-close-share]")) closeSharePreview(); });
  $("#downloadShareCard").addEventListener("click", () => {
    if (!pendingShareCard) return;
    download(pendingShareCard.file.name, pendingShareCard.file, "image/png");
    toast("Monatskarte als PNG gespeichert");
  });
  nativeShareCard.addEventListener("click", async () => {
    if (!pendingShareCard) return;
    try {
      await navigator.share({ files: [pendingShareCard.file], title: pendingShareCard.title });
      toast("Monatskarte geteilt");
    } catch (error) { if (error.name !== "AbortError") toast("Teilen nicht möglich – bitte PNG speichern"); }
  });

  /* ---------- Statistiken ---------- */
  const DAY = 86400000;
  const pad2 = (n) => String(n).padStart(2, "0");
  const isoOf = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const toDate = (iso) => new Date(iso + "T00:00:00");
  const diffDays = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY);
  const pctOf = (n, total) => (total ? Math.round((n / total) * 100) : 0);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function median(arr) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b), m = s.length >> 1;
    return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
  }
  function quantile(arr, q) {
    if (!arr.length) return null;
    const s = [...arr].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
  }
  function mondayOf(iso) {
    const d = toDate(iso);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  function isoWeek(date) {
    const t = new Date(date);
    t.setDate(t.getDate() + 3 - ((t.getDay() + 6) % 7));
    const jan4 = new Date(t.getFullYear(), 0, 4);
    return 1 + Math.round(((t - jan4) / DAY - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  }
  // "Customer Success Manager (m/w/d) 100% Remote" and "CSM" land in the same group
  function cleanRole(s) {
    return String(s || "")
      .replace(/\((?:[mwdafx])(?:\s*\/\s*[mwdafx])*\)/gi, "")
      .replace(/\d+\s*%?\s*[–-]\s*\d+\s*%|\d+\s*%/g, "")
      .replace(/\bremote\b/gi, "")
      .replace(/\s+/g, " ").trim();
  }
  const ROLE_ALIASES = { csm: "Customer Success Manager" };

  const BUCKETS = [
    { max: 7, label: "≤ 1 Wo." },
    { max: 14, label: "1–2 Wo." },
    { max: 30, label: "2–4 Wo." },
    { max: 60, label: "1–2 Mon." },
    { max: Infinity, label: "> 2 Mon." },
  ];
  const bucketize = (days) => BUCKETS.map((b, i) => ({
    label: b.label,
    n: days.filter((d) => d <= b.max && d > (i ? BUCKETS[i - 1].max : -1)).length,
  }));

  function computeInsights(apps) {
    const today = todayISO();
    const total = apps.length;
    const dated = apps.filter((a) => a.datum);
    const by = Object.fromEntries(STATUSES.map((s) => [s.id, 0]));
    apps.forEach((a) => by[a.status]++);
    const gotAnswer = (a) => (a.status !== "offen" && a.status !== "keine") || hadInterview(a);
    const answered = apps.filter(gotAnswer).length;
    const reached = PHASES.map((_, i) => apps.filter((a) => phaseIdx(a.phase) >= i).length);

    // first reaction = invitation or decision, whichever came first
    const reactions = [];
    for (const a of dated) {
      const days = [a.phaseDates?.gespraech1, a.absageAm].filter(Boolean).map((d) => diffDays(a.datum, d)).filter((n) => n >= 0);
      if (days.length) reactions.push(Math.min(...days));
    }
    const rMedian = median(reactions), rP80 = quantile(reactions, 0.8);
    // after this many days without reaction an answer becomes unlikely
    const threshold = reactions.length >= 5 ? Math.max(14, rP80) : 21;

    const waiting = dated.filter((a) => a.status === "offen" && !hadInterview(a)).map((a) => ({ a, days: daysSince(a.datum) }));
    const overdue = waiting.filter((w) => w.days > threshold).sort((x, y) => y.days - x.days);
    const running = apps.filter((a) => a.status === "offen" && hadInterview(a))
      .sort((x, y) => phaseIdx(y.phase) - phaseIdx(x.phase) || (x.datum || "").localeCompare(y.datum || ""));

    const WEEKS = 12;
    const thisMonday = mondayOf(today);
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = new Date(thisMonday);
      start.setDate(start.getDate() - (WEEKS - 1 - i) * 7);
      return { start, n: 0 };
    });
    for (const a of dated) {
      const i = WEEKS - 1 - Math.round((thisMonday - mondayOf(a.datum)) / (7 * DAY));
      if (i >= 0 && i < WEEKS) weeks[i].n++;
    }
    const first = dated.reduce((m, a) => (!m || a.datum < m ? a.datum : m), "");
    const spanWeeks = first ? Math.max(1, (diffDays(first, today) + 1) / 7) : 1;
    const perWeek = dated.length / spanWeeks;

    const months = new Map();
    for (const a of dated) months.set(a.datum.slice(0, 7), (months.get(a.datum.slice(0, 7)) || 0) + 1);
    const topMonth = [...months].sort((x, y) => y[1] - x[1])[0];

    const currentMonthKey = today.slice(0, 7);
    const previousMonthDate = new Date(`${currentMonthKey}-01T00:00:00`);
    previousMonthDate.setMonth(previousMonthDate.getMonth() - 1);
    const previousMonthKey = isoOf(previousMonthDate).slice(0, 7);
    const summarizeMonth = (key) => {
      const list = dated.filter((a) => a.datum.slice(0, 7) === key);
      const status = Object.fromEntries(STATUSES.map((st) => [st.id, list.filter((a) => a.status === st.id).length]));
      return {
        key, total: list.length, status,
        answered: list.filter(gotAnswer).length,
        talks: list.filter(hadInterview).length,
      };
    };
    const monthCurrent = summarizeMonth(currentMonthKey);
    const monthPrevious = summarizeMonth(previousMonthKey);

    const roles = new Map();
    for (const a of apps) {
      const cleaned = cleanRole(a.stelle);
      if (!cleaned) continue;
      const alias = ROLE_ALIASES[cleaned.toLowerCase()];
      const key = (alias || cleaned).toLowerCase();
      const r = roles.get(key) || roles.set(key, { label: alias || cleaned, n: 0, answered: 0, talks: 0, absage: 0 }).get(key);
      r.n++;
      if (gotAnswer(a)) r.answered++;
      if (hadInterview(a)) r.talks++;
      if (a.status === "absage") r.absage++;
    }
    const roleList = [...roles.values()].sort((x, y) => y.n - x.n || x.label.localeCompare(y.label));

    const decided = apps.filter((a) => a.status === "absage");
    const absageAfterTalk = decided.filter(hadInterview).length;

    return {
      total, by, answered, reached, reactions, rMedian, rP80, threshold, waiting, overdue, running,
      weeks, perWeek, first, topMonth, roleList, absageAfterTalk, monthCurrent, monthPrevious,
    };
  }

  function insightHighlights(s) {
    const out = [];
    const thisWeek = s.weeks[s.weeks.length - 1].n;
    if (s.first) {
      const pace = s.perWeek.toLocaleString("de-CH", { maximumFractionDigits: 1 });
      out.push({ c: "var(--accent)", t: `Du bewirbst dich im Schnitt <b>${pace}× pro Woche</b>${thisWeek ? ` – diese Woche schon <b>${thisWeek}</b>` : " – diese Woche noch keine"}.` });
    }
    if (s.rMedian !== null) {
      out.push({ c: STATUS.offen.color, t: `Antworten kommen meist nach <b>${plural(s.rMedian, "Tag", "Tagen")}</b>${s.reactions.length >= 5 ? `, 80 % innerhalb von <b>${s.rP80} Tagen</b>` : ""}.` });
    }
    if (s.overdue.length) {
      out.push({ c: "var(--s-interview)", t: `<b>${plural(s.overdue.length, "Bewerbung wartet", "Bewerbungen warten")}</b> seit über ${s.threshold} Tagen ohne Reaktion – nachfassen oder als „Keine Antwort“ abhaken.` });
    }
    if (s.reached[1]) {
      out.push({ c: "var(--s-phase)", t: `<b>${pctOf(s.reached[1], s.total)} %</b> deiner Bewerbungen führen zu einem Gespräch${s.absageAfterTalk ? ` · ${plural(s.absageAfterTalk, "Absage", "Absagen")} kam${s.absageAfterTalk === 1 ? "" : "en"} nach einem Gespräch` : ""}.` });
    } else if (s.total) {
      out.push({ c: "var(--s-phase)", t: "Noch kein Gespräch erfasst. Trag Einladungen im <b>Verlauf</b> ein, dann siehst du hier deine Einladungsquote." });
    }
    const best = s.roleList.filter((r) => r.n >= 3).sort((x, y) => y.answered / y.n - x.answered / x.n)[0];
    if (best && best.answered) {
      out.push({ c: STATUS.angebot.color, t: `Am meisten Rückmeldung bei <b>${esc(best.label)}</b>: ${pctOf(best.answered, best.n)} % von ${best.n} Bewerbungen.` });
    }
    if (s.topMonth) {
      const [key, n] = s.topMonth;
      out.push({ c: "var(--text-3)", t: `Aktivster Monat: <b>${MONTHS[+key.slice(5, 7) - 1]} ${key.slice(0, 4)}</b> mit ${n} Bewerbungen.` });
    }
    return out;
  }

  // vertical bars; only the max and the highlighted bar carry a value label
  function columnsHTML(items, { highlight = -1, color = "var(--accent)" } = {}) {
    const max = Math.max(1, ...items.map((it) => it.n));
    const maxIdx = items.findIndex((it) => it.n === max);
    return `
      <div class="cols" style="--c:${color}">
        ${items.map((it, i) => `
          <div class="col ${i === highlight ? "hl" : ""}" data-tip="${esc(it.tip || `${it.label}: ${it.n}`)}">
            <div class="col-track">
              ${(i === maxIdx || i === highlight) && it.n ? `<span class="col-val">${it.n}</span>` : ""}
              <span class="col-bar" style="--h:${(it.n / max) * 100}%;--i:${i}"></span>
            </div>
            <span class="col-label">${esc(it.axis ?? it.label)}</span>
          </div>`).join("")}
      </div>`;
  }

  function miniRowHTML(a, side) {
    return `
      <button class="mini-row" data-open-id="${a.id}">
        <span class="avatar sm" style="--h:${hue(a.firma)}">${esc(privateInitials(a.firma))}</span>
        <span class="mini-main"><b>${esc(privateCompany(a.firma))}</b><small>${esc(a.stelle || "—")}</small></span>
        <span class="mini-side">${side}</span>
      </button>`;
  }

  function renderInsights() {
    const el = $("#viewInsights");
    const s = computeInsights(state.apps);
    if (!s.total) {
      el.innerHTML = `
        <div class="empty">
          <div class="empty-icon">${ICONS.flag}</div>
          <h3>Noch keine Daten</h3>
          <p class="muted">Sobald du Bewerbungen erfasst hast, siehst du hier deine Auswertung.</p>
        </div>`;
      return;
    }
    const pace = s.perWeek.toLocaleString("de-CH", { maximumFractionDigits: 1 });
    const thisWeek = s.weeks[s.weeks.length - 1].n;
    const kpis = [
      { label: "Antwortquote", value: `${pctOf(s.answered, s.total)} %`, sub: `${s.answered} von ${s.total} haben reagiert`, c: STATUS.offen.color },
      { label: "Einladungsquote", value: `${pctOf(s.reached[1], s.total)} %`, sub: plural(s.reached[1], "Bewerbung mit Gespräch", "Bewerbungen mit Gespräch"), c: "var(--s-phase)" },
      { label: "Pro Woche", value: pace, sub: `diese Woche ${thisWeek}`, c: "var(--accent)" },
      { label: "Reaktionszeit", value: s.rMedian === null ? "–" : `${s.rMedian} T.`, sub: s.reactions.length ? `Median aus ${plural(s.reactions.length, "Antwort", "Antworten")}` : "noch keine Antwortdaten", c: STATUS.angebot.color },
    ];

    const funnelSteps = [
      { label: "Beworben", n: s.total },
      { label: "Antwort erhalten", n: s.answered },
      ...PHASES.slice(1).map((p, i) => ({ label: p.label, n: s.reached[i + 1] })),
      { label: "Angebot", n: s.by.angebot },
    ];
    const funnel = funnelSteps.map((st, i) => {
      const prev = i ? funnelSteps[i - 1].n : st.n;
      const tip = i ? `${st.label}: ${st.n} · ${pctOf(st.n, prev)} % vom Schritt davor` : `${st.label}: ${st.n}`;
      return `
        <div class="f-row" data-tip="${esc(tip)}" style="--i:${i}">
          <span class="f-label">${st.label}</span>
          <span class="f-track"><span class="f-bar" style="--w:${pctOf(st.n, s.total)}%"></span></span>
          <span class="f-val"><b>${st.n}</b><small>${pctOf(st.n, s.total)} %</small></span>
        </div>`;
    }).join("");

    const weekItems = s.weeks.map((w, i) => {
      const end = new Date(w.start); end.setDate(end.getDate() + 6);
      const kw = isoWeek(w.start);
      return {
        label: `KW ${kw}`, axis: i % 2 === s.weeks.length % 2 ? "" : String(kw), n: w.n,
        tip: `KW ${kw} · ${fmtDate(isoOf(w.start)).slice(0, 6)}–${fmtDate(isoOf(end)).slice(0, 6)} · ${plural(w.n, "Bewerbung", "Bewerbungen")}`,
      };
    });
    const reactItems = bucketize(s.reactions).map((b) => ({ ...b, tip: `${b.label}: ${plural(b.n, "Antwort", "Antworten")}` }));
    const waitItems = bucketize(s.waiting.map((w) => w.days)).map((b) => ({ ...b, tip: `${b.label}: ${plural(b.n, "Bewerbung", "Bewerbungen")} ohne Reaktion` }));

    const SHOW = 6;
    const overdueHTML = s.overdue.length
      ? s.overdue.slice(0, SHOW).map((w) => miniRowHTML(w.a, `<span class="age-chip">${w.days} T.</span>`)).join("")
        + (s.overdue.length > SHOW ? `<p class="muted small more">und ${s.overdue.length - SHOW} weitere</p>` : "")
      : `<div class="empty-mini">Nichts überfällig – alle offenen Bewerbungen sind jünger als ${s.threshold} Tage.</div>`;
    const runningHTML = s.running.length
      ? s.running.map((a) => miniRowHTML(a, phaseTagHTML(a))).join("")
      : `<div class="empty-mini">Gerade kein laufendes Gespräch. Einladungen trägst du im Verlauf einer Bewerbung ein.</div>`;

    const roles = s.roleList.slice(0, 8);
    const rolesHTML = `
      <table class="roles">
        <thead><tr><th>Stelle</th><th>Anzahl</th><th>Antwort</th><th class="hide-sm">Gespräch</th><th class="hide-sm">Absage</th></tr></thead>
        <tbody>
          ${roles.map((r) => `
            <tr>
              <td><span class="role-name">${esc(r.label)}</span><span class="role-bar" style="--w:${pctOf(r.n, roles[0].n)}%"></span></td>
              <td>${r.n}</td>
              <td>${pctOf(r.answered, r.n)} %</td>
              <td class="hide-sm">${r.talks}</td>
              <td class="hide-sm">${r.absage}</td>
            </tr>`).join("")}
        </tbody>
      </table>`;

    const month = s.monthCurrent, previousMonth = s.monthPrevious;
    const monthName = `${MONTHS[+month.key.slice(5, 7) - 1]} ${month.key.slice(0, 4)}`;
    const previousMonthName = MONTHS[+previousMonth.key.slice(5, 7) - 1];
    const monthDelta = month.total - previousMonth.total;
    const deltaText = monthDelta === 0
      ? `gleich viele wie im ${previousMonthName}`
      : `${monthDelta > 0 ? "+" : ""}${monthDelta} gegenüber ${previousMonthName}`;
    const monthMetrics = [
      { label: "Bewerbungen", value: month.total, sub: `${previousMonth.total} im ${previousMonthName}`, c: "var(--accent)" },
      { label: "Offen", value: month.status.offen, sub: `${pctOf(month.status.offen, month.total)} % des Monats`, c: STATUS.offen.color },
      { label: "Antwort erhalten", value: month.answered, sub: `${pctOf(month.answered, month.total)} % Antwortquote`, c: STATUS.angebot.color },
      { label: "Mit Gespräch", value: month.talks, sub: `${pctOf(month.talks, month.total)} % Einladungsquote`, c: "var(--s-phase)" },
    ];
    const monthStatuses = STATUSES.map((st) => ({ ...st, n: month.status[st.id] })).filter((st) => st.n);
    const monthStatusBar = month.total ? monthStatuses.map((st) => `<span style="--c:${st.color};flex:${st.n}" title="${st.label}: ${st.n}"></span>`).join("") : "";

    el.innerHTML = `
      <div class="stats ins-kpis">
        ${kpis.map((k, i) => `
          <div class="stat" style="--i:${i};--c:${k.c}">
            <div class="stat-label"><i></i>${k.label}</div>
            <div class="stat-value">${k.value}</div>
            <div class="stat-sub">${k.sub}</div>
          </div>`).join("")}
      </div>

      <section class="panel highlights" style="--i:1">
        <h3>Auf einen Blick</h3>
        <ul>${insightHighlights(s).map((h) => `<li style="--c:${h.c}"><i></i><span>${h.t}</span></li>`).join("")}</ul>
      </section>

      <section class="panel month-snapshot" style="--i:2">
        <div class="snapshot-head">
          <div><h3>${monthName}</h3><span class="muted small">Aktueller Monat im Vergleich zu ${previousMonthName}</span></div>
          <span class="month-delta ${monthDelta > 0 ? "up" : monthDelta < 0 ? "down" : ""}">${esc(deltaText)}</span>
        </div>
        ${month.total ? `
          <div class="snapshot-grid">
            ${monthMetrics.map((m) => `
              <div class="snapshot-metric" style="--c:${m.c}">
                <span>${m.label}</span><b>${m.value}</b><small>${m.sub}</small>
              </div>`).join("")}
          </div>
          <div class="snapshot-status">
            <div class="snapshot-bar">${monthStatusBar}</div>
            <div class="snapshot-legend">${monthStatuses.map((st) => `<span style="--c:${st.color}"><i></i>${st.n} ${st.label}</span>`).join("")}</div>
          </div>` : `<div class="empty-mini">Für ${monthName} sind noch keine Bewerbungen erfasst.</div>`}
      </section>

      <div class="ins-grid">
        <section class="panel" style="--i:3">
          <div class="panel-head"><h3>Trichter</h3><span class="muted small">Wie weit kommen deine Bewerbungen?</span></div>
          <div class="funnel">${funnel}</div>
        </section>

        <section class="panel" style="--i:4">
          <div class="panel-head"><h3>Aktivität</h3><span class="muted small">Bewerbungen pro Woche · letzte 12 Wochen</span></div>
          ${columnsHTML(weekItems, { highlight: weekItems.length - 1 })}
          <p class="panel-foot muted small">Kalenderwoche · aktuelle Woche hervorgehoben</p>
        </section>

        <section class="panel" style="--i:5">
          <div class="panel-head"><h3>Reaktionszeit</h3><span class="muted small">Tage bis zur ersten Antwort (Einladung oder Entscheid)</span></div>
          ${s.reactions.length ? columnsHTML(reactItems, { color: STATUS.angebot.color }) : `<div class="empty-mini">Noch keine Daten – trag bei Absagen das Entscheid-Datum ein.</div>`}
        </section>

        <section class="panel" style="--i:6">
          <div class="panel-head"><h3>Warten auf Antwort</h3><span class="muted small">${plural(s.waiting.length, "offene Bewerbung", "offene Bewerbungen")} ohne Gespräch, nach Alter</span></div>
          ${s.waiting.length ? columnsHTML(waitItems, { color: STATUS.offen.color }) : `<div class="empty-mini">Keine offenen Bewerbungen.</div>`}
        </section>

        <section class="panel" style="--i:7">
          <div class="panel-head"><h3>Nachfassen</h3><span class="muted small">Offen und älter als ${s.threshold} Tage${s.reactions.length >= 5 ? " (80 % der Antworten kamen früher)" : ""}</span></div>
          <div class="mini-list">${overdueHTML}</div>
        </section>

        <section class="panel" style="--i:8">
          <div class="panel-head"><h3>Laufende Gespräche</h3><span class="muted small">Offen mit mindestens einem Gespräch</span></div>
          <div class="mini-list">${runningHTML}</div>
        </section>

        <section class="panel wide" style="--i:9">
          <div class="panel-head"><h3>Nach Stelle</h3><span class="muted small">Welche Jobtitel bringen Rückmeldung?</span></div>
          ${rolesHTML}
        </section>
      </div>`;
  }

  function setView(view) {
    state.view = view;
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
    history.replaceState(null, "", view === "insights" ? "#statistiken" : location.pathname + location.search);
    $("#viewList").hidden = view !== "list";
    $("#viewInsights").hidden = view !== "insights";
    document.querySelectorAll("#tabs .tab").forEach((t) => {
      const on = t.dataset.view === view;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    if (view === "insights") renderInsights();
  }

  function render({ transition = false } = {}) {
    const run = () => { renderStats(); renderFilters(); renderList(); if (state.view === "insights") renderInsights(); };
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
    av.textContent = privateInitials(name || "?");
    av.style.setProperty("--h", hue(name));
    $("#drawerTitle").textContent = name
      ? privateCompany(name)
      : (state.isNew ? "Neue Bewerbung" : "Bewerbung");
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
    toast(state.privacy ? (wasNew ? "Bewerbung hinzugefügt" : "Bewerbung gespeichert") : (wasNew ? `${name} hinzugefügt` : `${name} gespeichert`));
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
    toast(state.privacy ? "Bewerbung gelöscht" : `${app.firma} gelöscht`, {
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
  const importDialog = $("#importDialog"), importOverlay = $("#importOverlay"), importResult = $("#importResult");
  const confirmImportBtn = $("#confirmImportBtn"), dropZone = $("#dropZone");
  let pendingImport = null, importLastFocus = null;

  function openImportDialog() {
    importLastFocus = document.activeElement;
    pendingImport = null;
    importResult.hidden = true;
    importResult.innerHTML = "";
    confirmImportBtn.disabled = true;
    confirmImportBtn.textContent = "Importieren";
    importOverlay.hidden = false;
    importDialog.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { importOverlay.classList.add("show"); importDialog.classList.add("open"); });
    setTimeout(() => dropZone.focus({ preventScroll: true }), 100);
  }

  function closeImportDialog() {
    if (!importDialog.classList.contains("open")) return;
    importDialog.classList.remove("open");
    importOverlay.classList.remove("show");
    importDialog.setAttribute("aria-hidden", "true");
    document.body.style.overflow = drawer.classList.contains("open") ? "hidden" : "";
    setTimeout(() => { if (!importDialog.classList.contains("open")) importOverlay.hidden = true; }, 300);
    importLastFocus?.focus?.({ preventScroll: true });
  }

  function showImportResult({ file, type = "", apps = [], errors = [], total = 0, fatal = false }) {
    const valid = apps.length;
    const isJSON = type === "json";
    const canImport = valid > 0 && !(isJSON && errors.length) && !fatal;
    pendingImport = canImport ? { type, apps } : null;
    confirmImportBtn.disabled = !canImport;
    confirmImportBtn.textContent = isJSON ? "Backup wiederherstellen" : `${valid} ${valid === 1 ? "Eintrag" : "Einträge"} importieren`;
    const status = fatal || !canImport ? "error" : "ok";
    const summary = fatal
      ? "Diese Datei kann nicht importiert werden."
      : isJSON
        ? `${valid} ${valid === 1 ? "Bewerbung" : "Bewerbungen"} im Backup erkannt${errors.length ? " · Backup muss vollständig gültig sein" : ""}.`
        : `${valid} von ${total} ${total === 1 ? "Datenzeile ist" : "Datenzeilen sind"} gültig${errors.length ? ` · ${errors.length} werden übersprungen` : ""}.`;
    importResult.className = `import-result ${status}`;
    importResult.innerHTML = `
      <div class="result-head"><b>${esc(file?.name || "Datei")}</b><span>${isJSON ? "JSON-Backup" : "CSV-Import"}</span></div>
      <p class="result-summary">${esc(summary)}</p>
      ${errors.length ? `<ul class="result-errors">${errors.slice(0, 6).map((e) => `<li>${esc(e)}</li>`).join("")}${errors.length > 6 ? `<li>… und ${errors.length - 6} weitere Fehler</li>` : ""}</ul>` : ""}`;
    importResult.hidden = false;
  }

  async function inspectImportFile(file) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      showImportResult({ file, errors: ["Die Datei ist grösser als 5 MB."], fatal: true });
      return;
    }
    try {
      const text = await file.text();
      const lower = file.name.toLowerCase();
      const isJSON = lower.endsWith(".json") || (!lower.endsWith(".csv") && text.trim().startsWith("["));
      if (!isJSON && !lower.endsWith(".csv")) {
        showImportResult({ file, errors: ["Erlaubt sind nur CSV- und JSON-Dateien."], fatal: true });
        return;
      }
      if (isJSON) {
        const data = JSON.parse(text);
        if (!Array.isArray(data)) throw new Error("Das JSON-Backup muss eine Liste enthalten.");
        const errors = [];
        data.forEach((a, i) => {
          if (!a || typeof a !== "object") errors.push(`Eintrag ${i + 1}: ungültiges Format`);
          else if (!String(a.firma || "").trim()) errors.push(`Eintrag ${i + 1}: Firma fehlt`);
        });
        if (!data.length) errors.push("Das Backup enthält keine Bewerbungen.");
        const validData = data.filter((a) => a && typeof a === "object" && String(a.firma || "").trim());
        showImportResult({ file, type: "json", apps: validData.map(normalize), errors, total: data.length });
      } else {
        const result = inspectCSV(text);
        showImportResult({ file, type: "csv", ...result });
      }
    } catch (e) {
      showImportResult({ file, errors: [e.message || "Die Datei konnte nicht gelesen werden."], fatal: true });
    }
  }

  function commitImport() {
    if (!pendingImport) return;
    if (pendingImport.type === "json") {
      if (state.apps.length && !confirm(`Backup mit ${pendingImport.apps.length} Einträgen wiederherstellen? Die aktuellen Daten werden ersetzt.`)) return;
      state.apps = pendingImport.apps;
      persist(); render({ transition: true }); closeImportDialog();
      toast(`${state.apps.length} Bewerbungen aus Backup geladen`);
      return;
    }
    const key = (a) => `${a.firma.toLowerCase()}|${a.stelle.toLowerCase()}|${a.datum}`;
    const existing = new Set(state.apps.map(key));
    const fresh = pendingImport.apps.filter((a) => !existing.has(key(a)) && existing.add(key(a)));
    const duplicates = pendingImport.apps.length - fresh.length;
    state.apps.push(...fresh);
    persist(); render({ transition: true }); closeImportDialog();
    toast(`${fresh.length} neue importiert${duplicates ? `, ${duplicates} Duplikate übersprungen` : ""}`);
  }

  function normalize(a) {
    const parsed = parseStatusText(a.status);
    const links0 = Array.isArray(a.links) ? a.links : [];
    let phase = PHASE[a.phase] ? a.phase : parsed.phase
      || (links0.some((l) => l && l.type === "einladung") ? "gespraech1" : "beworben");
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
      jobUrl: String(a.jobUrl || ""),
      jobDescription: String(a.jobDescription || ""),
      companyLogoUrl: String(a.companyLogoUrl || ""),
      location: String(a.location || ""),
      employmentType: String(a.employmentType || ""),
      workload: String(a.workload || ""),
      workModel: String(a.workModel || ""),
      contactName: String(a.contactName || ""),
      contactEmail: String(a.contactEmail || ""),
      salaryText: String(a.salaryText || ""),
      followUpAt: String(a.followUpAt || ""),
      nextAction: String(a.nextAction || ""),
      sourceMetadata: a.sourceMetadata && typeof a.sourceMetadata === "object" ? a.sourceMetadata : {},
      updated: a.updated || Date.now(),
    };
  }

  /* ---------- Menu ---------- */
  const menu = $("#menu"), menuBtn = $("#menuBtn");
  const closeMenu = () => menu.classList.remove("open");

  function applyPrivacyMode({ announce = false } = {}) {
    document.body.classList.toggle("privacy-mode", state.privacy);
    const button = $("#privacyBtn");
    button.classList.toggle("active", state.privacy);
    button.setAttribute("aria-pressed", String(state.privacy));
    button.setAttribute("aria-label", state.privacy ? "Privacy-Modus deaktivieren" : "Privacy-Modus aktivieren");
    button.title = state.privacy ? "Normale Ansicht wiederherstellen" : "Sichere Ansicht für Screenshots";
    if (currentUser) $("#userEmail").textContent = state.privacy ? "Konto geschützt" : (currentUser.email || "Angemeldet");
    if (state.privacy && els.search.value) {
      els.search.value = "";
      state.query = "";
    }
    if (state.draft) {
      renderDrawerHead();
      renderLinks();
      renderNotes();
    }
    render({ transition: true });
    if (announce) toast(state.privacy ? "Privacy-Modus aktiv" : "Privacy-Modus deaktiviert");
  }

  function togglePrivacyMode() {
    state.privacy = !state.privacy;
    try { localStorage.setItem(PRIVACY_KEY, state.privacy ? "1" : "0"); } catch {}
    closeMenu();
    applyPrivacyMode({ announce: true });
  }

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
      case "import": openImportDialog(); break;
      case "reset":
        if (confirm("Wirklich ALLE Bewerbungen löschen? Tipp: vorher ein Backup speichern.")) {
          state.apps = []; persist(); render({ transition: true }); toast("Alle Daten gelöscht");
        }
        break;
      case "signout":
        db.auth.signOut();
        break;
    }
  }

  /* ---------- Events ---------- */
  $("#addBtn").addEventListener("click", () => openDrawer(null));
  $("#privacyBtn").addEventListener("click", togglePrivacyMode);
  $("#importBtn").addEventListener("click", openImportDialog);
  menuBtn.addEventListener("click", (e) => { e.stopPropagation(); menu.classList.toggle("open"); });
  document.addEventListener("click", (e) => {
    if (!menu.contains(e.target)) closeMenu();
    const actionEl = e.target.closest("[data-action]");
    if (actionEl) handleAction(actionEl.dataset.action);
  });

  $("#fileInput").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) inspectImportFile(f);
    e.target.value = "";
  });
  dropZone.addEventListener("click", () => $("#fileInput").click());
  ["dragenter", "dragover"].forEach((name) => dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dropZone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((name) => dropZone.addEventListener(name, (e) => {
    e.preventDefault();
    dropZone.classList.remove("dragging");
  }));
  dropZone.addEventListener("drop", (e) => inspectImportFile(e.dataTransfer.files[0]));
  importOverlay.addEventListener("click", closeImportDialog);
  importDialog.addEventListener("click", (e) => { if (e.target.closest("[data-close-import]")) closeImportDialog(); });
  confirmImportBtn.addEventListener("click", commitImport);
  $("#templateBtn").addEventListener("click", () => {
    download("bewerbungen-import-vorlage.csv", appsToCSV([]), "text/csv;charset=utf-8");
    toast("CSV-Vorlage heruntergeladen");
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
    const monthShare = e.target.closest("[data-share-month]");
    if (monthShare) return shareCardForMonth(monthShare.dataset.shareMonth);
    const monthExport = e.target.closest("[data-export-month]");
    if (monthExport) return exportMonth(monthExport.dataset.exportMonth);
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

  $("#tabs").addEventListener("click", (e) => {
    const tab = e.target.closest("[data-view]");
    if (tab && tab.dataset.view !== state.view) setView(tab.dataset.view);
  });
  $("#tabs").addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    const next = state.view === "list" ? "insights" : "list";
    setView(next);
    $(`#tabs [data-view="${next}"]`).focus();
  });

  const insightsEl = $("#viewInsights"), tip = $("#tip");
  insightsEl.addEventListener("click", (e) => {
    const row = e.target.closest("[data-open-id]");
    const app = row && state.apps.find((a) => a.id === row.dataset.openId);
    if (app) openDrawer(app);
  });
  insightsEl.addEventListener("pointerover", (e) => {
    const t = e.target.closest("[data-tip]");
    if (!t) return;
    tip.textContent = t.dataset.tip;
    tip.hidden = false;
    const r = t.getBoundingClientRect(), w = tip.offsetWidth;
    tip.style.left = Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + "px";
    tip.style.top = Math.max(8, r.top - tip.offsetHeight - 8) + "px";
  });
  insightsEl.addEventListener("pointerout", (e) => {
    if (!e.relatedTarget?.closest?.("[data-tip]")) tip.hidden = true;
  });
  addEventListener("scroll", () => (tip.hidden = true), { passive: true });

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
    const importOpen = importDialog.classList.contains("open");
    const shareOpen = sharePreview.classList.contains("open");
    if (e.key === "Escape") { if (shareOpen) closeSharePreview(); else if (importOpen) closeImportDialog(); else if (open) closeDrawer(); else closeMenu(); return; }
    if (importOpen) return;
    if (open && e.key === "s" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveDraft(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
    if (open || typing) return;
    if (e.key === "/") { e.preventDefault(); if (state.view !== "list") setView("list"); els.search.focus(); }
    else if (e.key === "n") { e.preventDefault(); openDrawer(null); }
  });

  window.addEventListener("beforeunload", (e) => {
    if (drawer.classList.contains("open") && isDirty()) { e.preventDefault(); e.returnValue = ""; }
  });

  /* ---------- Anmeldung & Boot ---------- */
  const authShell = $("#authShell"), mainApp = $("#mainApp"), authForm = $("#authForm");
  const authMessage = $("#authMessage"), signupBtn = $("#signupBtn");
  let appStarted = false;

  function authStatus(message, ok = false) {
    authMessage.textContent = message || "";
    authMessage.classList.toggle("ok", ok);
  }

  function friendlyAuthError(error) {
    const code = error?.code || "";
    if (code === "invalid_credentials") return "E-Mail-Adresse oder Passwort ist nicht korrekt.";
    if (code === "email_not_confirmed") return "Bitte bestätige zuerst deine E-Mail-Adresse.";
    if (code === "user_already_exists") return "Für diese E-Mail-Adresse gibt es bereits ein Konto.";
    if (code === "weak_password") return "Bitte wähle ein stärkeres Passwort.";
    return error?.message || "Anmeldung fehlgeschlagen.";
  }

  async function loadCloudData() {
    setSyncState("syncing", "Lädt…");
    const cached = load();
    if (cached?.length) state.apps = cached.map(normalize);
    const { data, error } = await db.from("applications").select("*").order("datum", { ascending: false, nullsFirst: false });
    if (error) throw error;
    state.apps = (data || []).map(fromRow);
    if (!state.apps.length) {
      const seedResponse = await fetch(SEED_URL, { cache: "no-store" });
      if (seedResponse.ok) {
        state.apps = appsFromCSV(await seedResponse.text());
        if (state.apps.length) {
          const { error: seedError } = await db.from("applications").upsert(state.apps.map(toRow), { onConflict: "id" });
          if (seedError) throw seedError;
          setTimeout(() => toast(`${state.apps.length} vorhandene Bewerbungen übernommen`), 500);
        }
      }
    }
    try { localStorage.setItem(`${STORAGE_KEY}.${currentUser.id}`, JSON.stringify(state.apps)); } catch {}
    setSyncState("", "Gespeichert");
  }

  async function startApp(session) {
    if (appStarted) return;
    appStarted = true;
    currentUser = session.user;
    $("#userEmail").textContent = state.privacy ? "Konto geschützt" : (currentUser.email || "Angemeldet");
    authShell.hidden = true;
    mainApp.hidden = false;
    try {
      await loadCloudData();
    } catch (error) {
      console.error("Supabase load failed", error);
      state.apps = (load() || []).map(normalize);
      setSyncState("error", "Einrichtung nötig");
      setTimeout(() => toast(error.code === "42P01" ? "Bitte zuerst das Supabase SQL-Skript ausführen" : "Cloud-Daten konnten nicht geladen werden"), 500);
    }
    let view = "list";
    try { view = localStorage.getItem(VIEW_KEY) === "insights" ? "insights" : "list"; } catch {}
    if (location.hash === "#statistiken") view = "insights";
    setView(view);
    document.body.classList.toggle("privacy-mode", state.privacy);
    const privacyButton = $("#privacyBtn");
    privacyButton.classList.toggle("active", state.privacy);
    privacyButton.setAttribute("aria-pressed", String(state.privacy));
    privacyButton.setAttribute("aria-label", state.privacy ? "Privacy-Modus deaktivieren" : "Privacy-Modus aktivieren");
    privacyButton.title = state.privacy ? "Normale Ansicht wiederherstellen" : "Sichere Ansicht für Screenshots";
    render();
  }

  async function stopApp() {
    currentUser = null;
    state.apps = [];
    mainApp.hidden = true;
    authShell.hidden = false;
    authStatus("");
    appStarted = false;
  }

  async function authenticate(createAccount) {
    if (!db) return authStatus("Supabase konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.");
    const email = $("#authEmail").value.trim();
    const password = $("#authPassword").value;
    if (!email || password.length < 6) return authStatus("Bitte E-Mail und mindestens 6 Passwort-Zeichen eingeben.");
    authStatus(createAccount ? "Konto wird erstellt…" : "Anmeldung läuft…", true);
    const result = createAccount
      ? await db.auth.signUp({ email, password })
      : await db.auth.signInWithPassword({ email, password });
    if (result.error) return authStatus(friendlyAuthError(result.error));
    if (createAccount && !result.data.session) authStatus("Konto erstellt. Bitte öffne den Bestätigungslink in deiner E-Mail.", true);
  }

  authForm.addEventListener("submit", (event) => { event.preventDefault(); authenticate(false); });
  signupBtn.addEventListener("click", () => authenticate(true));

  async function boot() {
    if (!db) return authStatus("Supabase konnte nicht geladen werden. Bitte Seite neu laden.");
    const { data } = await db.auth.getSession();
    if (data.session) await startApp(data.session);
    db.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (session && !appStarted) startApp(session);
        else if (!session && appStarted) stopApp();
      }, 0);
    });
  }
  boot();
})();
