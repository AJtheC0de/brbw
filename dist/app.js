(() => {
  "use strict";

  /* ---------- Config ---------- */
  const STORAGE_KEY = "bwrb.applications.v1";
  const OPEN_KEY = "bwrb.openMonths.v2";
  const SEED_FIX_KEY = "bwrb.seedFix";
  const SEED_FIX_VERSION = "2";
  const VIEW_KEY = "bwrb.view";
  const PRIVACY_KEY = "bwrb.privacyMode";
  const MONTH_LAYOUT_KEY = "bwrb.monthLayout";
  const ONBOARDING_RELEASE_AT = Date.parse("2026-10-22T23:20:00.000Z");
  const SUPABASE_URL = "https://coxmnerqoaclawbbgipx.supabase.co";
  const SUPABASE_KEY = "sb_publishable_2oKHLoM5fCrNiQ1FCpvPig_0Ci3zISR";
  clearLegacyApplicationStorage();
  const db = window.supabase?.createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  let currentUser = null;
  let userProfile = null;
  let syncTimer = null;
  let syncGeneration = 0;
  let authEpoch = 0;
  let authAbortController = new AbortController();
  let syncRunningEpoch = null;
  let syncQueued = false;
  const pendingDeletes = new Map();
  const AI_BRIEF_INTERVAL = 5200;
  let aiBriefTimer = null;
  let aiBriefIndex = 0;

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
  const INTERVIEW_STAGES = {
    screening: "Recruiter-Screening", first: "1. Gespräch", second: "2. Gespräch", final: "Finale Runde", other: "Weiteres Gespräch",
  };
  const INTERVIEW_FORMATS = { video: "Video", phone: "Telefon", onsite: "Vor Ort", other: "Andere" };

  const LINK_TYPES = [
    { id: "bestaetigung", label: "Bestätigung", color: "var(--s-offen)" },
    { id: "einladung", label: "Einladung", color: "var(--s-einladung)" },
    { id: "absage", label: "Absage", color: "var(--s-absage)" },
    { id: "inserat", label: "Inserat", color: "var(--s-angebot)" },
    { id: "sonstiges", label: "Sonstiges", color: "var(--s-keine)" },
  ];
  const LINK_TYPE = Object.fromEntries(LINK_TYPES.map((t) => [t.id, t]));

  const EMAIL_TEMPLATE_LABELS = {
    de: {
      follow7: "Freundliche Nachfrage nach 7 Tagen",
      follow14: "Freundliche Nachfrage nach 14 Tagen",
      follow21: "Freundliche Nachfrage nach 21 Tagen",
      thanks: "Dankesmail nach dem Interview",
      nextstep: "Nachfrage zum nächsten Prozessschritt",
    },
    en: {
      follow7: "Friendly follow-up after 7 days",
      follow14: "Friendly follow-up after 14 days",
      follow21: "Friendly follow-up after 21 days",
      thanks: "Thank-you email after the interview",
      nextstep: "Ask about the next step",
    },
  };
  const EMAIL_TEMPLATE_TAB_LABELS = {
    de: { follow7: "Nach 7 Tagen", follow14: "Nach 14 Tagen", follow21: "Nach 21 Tagen", thanks: "Danke", nextstep: "Nächster Schritt" },
    en: { follow7: "After 7 days", follow14: "After 14 days", follow21: "After 21 days", thanks: "Thank you", nextstep: "Next step" },
  };

  const MAGIC_IMPORT_ERRORS = {
    host_not_allowed: "Diese Jobplattform wird noch nicht unterstützt.",
    invalid_url: "Bitte füge einen gültigen Job-Link ein.",
    private_url: "Private Netzwerkadressen sind nicht erlaubt.",
    unresolvable_url: "Die Jobseite ist nicht öffentlich erreichbar.",
    rate_limited: "Zu viele Importe. Bitte versuche es später erneut.",
    upstream_failed: "Die Jobseite konnte nicht geladen werden.",
    not_html: "Der Link zeigt nicht auf eine Webseite.",
    upstream_too_large: "Die Jobseite ist zu gross.",
  };

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
  const $$ = (sel, root = document) => root.querySelectorAll(sel);
  const uid = () => globalThis.crypto?.randomUUID?.()
    || Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
  const safeId = (value) => SAFE_ID.test(String(value ?? "")) ? String(value) : uid();
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const todayISO = () => new Date().toISOString().slice(0, 10);
  const nextUpdated = (application) => Math.max(Date.now(), (Number(application?._syncedUpdated) || 0) + 1);
  const addDaysISO = (iso, days) => {
    const date = new Date(`${parseDate(iso) || todayISO()}T12:00:00`);
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  };

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
  function clearLegacyApplicationStorage() {
    try {
      for (const key of Object.keys(localStorage)) {
        if (key === STORAGE_KEY || key.startsWith(`${STORAGE_KEY}.`)) {
          localStorage.removeItem(key);
        }
      }
    } catch {}
  }

  function persist() {
    if (!currentUser) return;
    clearTimeout(syncTimer);
    const generation = ++syncGeneration;
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser.id;
    const signal = authAbortController.signal;
    setSyncState("syncing", "Speichert…");
    syncTimer = setTimeout(() => {
      syncTimer = null;
      void syncRemote(generation, expectedEpoch, expectedUserId, signal);
    }, 350);
  }

  function isActiveAuthContext(expectedEpoch, expectedUserId) {
    return authEpoch === expectedEpoch && currentUser?.id === expectedUserId;
  }

  function invalidateAuthWork() {
    authAbortController.abort();
    authAbortController = new AbortController();
    syncQueued = false;
    pendingDeletes.clear();
    authEpoch += 1;
    syncGeneration += 1;
    if (syncTimer !== null) {
      clearTimeout(syncTimer);
      syncTimer = null;
    }
    return authEpoch;
  }

  function setSyncState(kind, label) {
    const el = document.querySelector("#syncState");
    if (!el) return;
    el.className = `sync-state ${kind || ""}`;
    el.querySelector("span").textContent = label;
    el.title = label;
  }

  function toRow(a, userId) {
    return {
      id: String(a.id), user_id: userId, firma: a.firma, stelle: a.stelle || "",
      datum: a.datum || null, status: a.status, phase: a.phase,
      phase_dates: a.phaseDates || {}, entscheid_am: a.absageAm || null,
      links: a.links || [], notes: a.notes || [], updated_at: Number(a.updated || Date.now()),
      job_url: a.jobUrl || null, job_description: a.jobDescription || null,
      company_logo_url: a.companyLogoUrl || null, location: a.location || null,
      employment_type: a.employmentType || null, workload: a.workload || null,
      work_model: a.workModel || null, contact_name: a.contactName || null,
      contact_email: a.contactEmail || null, salary_text: a.salaryText || null,
      follow_up_at: a.followUpAt || null, follow_up_done_at: a.followUpDoneAt || null,
      next_action: a.nextAction || null,
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
      followUpAt: row.follow_up_at, followUpDoneAt: row.follow_up_done_at,
      nextAction: row.next_action,
      sourceMetadata: row.source_metadata,
      _syncedUpdated: Number(row.updated_at) || 0,
    });
  }

  async function syncRemote(generation, expectedEpoch, expectedUserId, signal) {
    if (signal.aborted || !isActiveAuthContext(expectedEpoch, expectedUserId) || generation !== syncGeneration) return;
    if (syncRunningEpoch === expectedEpoch) {
      syncQueued = true;
      return;
    }
    syncRunningEpoch = expectedEpoch;
    try {
      const snapshots = state.apps.map((app) => ({
        app,
        row: toRow(app, expectedUserId),
        expectedUpdated: Number(app._syncedUpdated) || 0,
      }));
      const deletions = [...pendingDeletes.entries()];

      for (const snapshot of snapshots) {
        if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
        if (snapshot.expectedUpdated === snapshot.row.updated_at) continue;

        if (!snapshot.expectedUpdated) {
          const { data, error } = await db.from("applications")
            .insert(snapshot.row)
            .select("updated_at")
            .single()
            .abortSignal(signal);
          if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
          if (error) throw error;
          if (snapshot.app._syncedUpdated === snapshot.expectedUpdated) snapshot.app._syncedUpdated = Number(data.updated_at);
          continue;
        }

        const { data, error } = await db.from("applications")
          .update(snapshot.row)
          .eq("user_id", expectedUserId)
          .eq("id", snapshot.row.id)
          .eq("updated_at", snapshot.expectedUpdated)
          .select("updated_at")
          .maybeSingle()
          .abortSignal(signal);
        if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
        if (error) throw error;
        if (!data) {
          const conflict = new Error("optimistic_conflict");
          conflict.code = "OPTIMISTIC_CONFLICT";
          throw conflict;
        }
        if (snapshot.app._syncedUpdated === snapshot.expectedUpdated) snapshot.app._syncedUpdated = Number(data.updated_at);
      }

      for (const [id, expectedUpdated] of deletions) {
        if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
        if (pendingDeletes.get(id) !== expectedUpdated) continue;
        const { data, error } = await db.from("applications")
          .delete()
          .eq("user_id", expectedUserId)
          .eq("id", id)
          .eq("updated_at", expectedUpdated)
          .select("id")
          .maybeSingle()
          .abortSignal(signal);
        if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
        if (error) throw error;
        if (!data) {
          const conflict = new Error("optimistic_conflict");
          conflict.code = "OPTIMISTIC_CONFLICT";
          throw conflict;
        }
        if (pendingDeletes.get(id) === expectedUpdated) pendingDeletes.delete(id);
      }
      if (isActiveAuthContext(expectedEpoch, expectedUserId) && generation === syncGeneration) setSyncState("", "Gespeichert");
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || signal.aborted) return;
      syncQueued = false;
      setSyncState("error", "Nicht synchronisiert");
      toast(error.code === "OPTIMISTIC_CONFLICT"
        ? "Änderungskonflikt: Bitte neu laden und erneut versuchen"
        : error.code === "42P01" ? "Supabase ist noch nicht eingerichtet" : "Cloud-Speicherung fehlgeschlagen");
    } finally {
      if (syncRunningEpoch === expectedEpoch) {
        syncRunningEpoch = null;
        if (syncQueued && isActiveAuthContext(expectedEpoch, expectedUserId) && !signal.aborted) {
          syncQueued = false;
          const nextGeneration = syncGeneration;
          queueMicrotask(() => void syncRemote(nextGeneration, expectedEpoch, expectedUserId, signal));
        }
      }
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
    const iContact = col("ansprechpartner", "kontakt", "kontaktperson", "contact name");
    const iEmail = col("kontakt-e-mail", "kontakt email", "e-mail", "email", "contact email");
    const iAction = col("nächste aktion", "naechste aktion", "next action");
    const iFollowUp = col("nachfassen am", "nachfassdatum", "follow-up", "follow up", "follow up at");
    const iFollowUpDone = col("nachfassen erledigt", "follow-up erledigt", "follow up done");

    if (iFirma < 0) return { apps: [], errors: ['Die Pflichtspalte „Firma“ fehlt.'], total: Math.max(0, rows.length - 1) };

    const apps = [], errors = [];
    rows.slice(1).forEach((r, index) => {
      const get = (i) => (i >= 0 ? (r[i] || "").trim() : "");
      const rowNo = index + 2;
      const firma = get(iFirma);
      const dateRaw = get(iDate), decisionRaw = get(iAbsage), statusRaw = get(iStatus), phaseRaw = get(iPhase);
      const followUpRaw = get(iFollowUp);
      const rowErrors = [];
      if (!firma) rowErrors.push("Firma fehlt");
      if (dateRaw && !parseDate(dateRaw)) rowErrors.push("Bewerbungsdatum ist ungültig");
      if (decisionRaw && !parseDate(decisionRaw)) rowErrors.push("Entscheiddatum ist ungültig");
      if (followUpRaw && !parseDate(followUpRaw)) rowErrors.push("Nachfassdatum ist ungültig");
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
        contactName: get(iContact),
        contactEmail: get(iEmail),
        nextAction: get(iAction),
        followUpAt: parseDate(followUpRaw),
        followUpDoneAt: /^(ja|yes|erledigt|done|1|true)$/i.test(get(iFollowUpDone)) ? new Date().toISOString() : "",
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
    const q = (value) => {
      const text = String(value ?? "");
      const neutralized = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
      return `"${neutralized.replace(/"/g, '""')}"`;
    };
    const header = ["Monat", "Bewerbung / Eingang", "Firma", "Stelle", "Status", "Verlauf", "Absage am", "Ansprechpartner", "Kontakt-E-Mail", "Nächste Aktion", "Nachfassen am", "Nachfassen erledigt", "Nachweis Eingang", "Nachweis Outcome", "Bemerkung"];
    const lines = [header.map(q).join(";")];
    for (const a of sortApps(apps, "date-desc")) {
      const proofIn = a.links.filter((l) => l.type === "bestaetigung").map((l) => l.url).join(" ");
      const proofOut = a.links.filter((l) => l.type !== "bestaetigung").map((l) => l.url).join(" ");
      const month = a.datum ? MONTHS[+a.datum.slice(5, 7) - 1] : "";
      lines.push([
        month, fmtDate(a.datum), a.firma, a.stelle, STATUS[a.status]?.label || "", PHASE[a.phase]?.label || "",
        fmtDate(a.absageAm), a.contactName, a.contactEmail, a.nextAction, fmtDate(a.followUpAt), a.followUpDoneAt ? "Ja" : "Nein",
        proofIn, proofOut, a.notes.map((n) => n.text.replace(/\s*\n\s*/g, " ")).join(" | "),
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
    interviews: [],
    filter: "alle",
    query: "",
    sort: "date-desc",
    draft: null,
    draftOriginal: "",
    isNew: false,
    view: "list",
    monthLayout: (() => { try { return localStorage.getItem(MONTH_LAYOUT_KEY) === "list" ? "list" : "tiles"; } catch { return "tiles"; } })(),
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
      return [a.firma, a.stelle, a.contactName, a.contactEmail, a.nextAction, STATUS[a.status]?.label, PHASE[a.phase]?.label, ...a.notes.map((n) => n.text)]
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

  function aiApplicationFact(applications) {
    const total = applications.length;
    const facts = [];
    const interviewCount = applications.filter(hadInterview).length;
    const finishedCount = applications.filter((app) => app.status !== "offen").length;
    const olderOpen = applications.filter((app) => app.status === "offen" && daysSince(app.datum) >= 14).length;
    const monthlyCounts = new Map();
    applications.forEach((app) => {
      const key = /^\d{4}-\d{2}/.test(String(app.datum || "")) ? app.datum.slice(0, 7) : "";
      if (key) monthlyCounts.set(key, (monthlyCounts.get(key) || 0) + 1);
    });
    const topMonth = [...monthlyCounts.entries()].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0];

    if (total && interviewCount) facts.push({
      text: `${interviewCount} von ${total} Bewerbungen erreichten mindestens ein Gespräch – das sind ${Math.round(interviewCount / total * 100)} %.`,
      action: "stats", label: "Statistiken ansehen",
    });
    if (topMonth) facts.push({
      text: `Dein aktivster Monat war ${MONTHS[Number(topMonth[0].slice(5, 7)) - 1]} ${topMonth[0].slice(0, 4)} mit ${topMonth[1]} Bewerbungen.`,
      action: "stats", label: "Verlauf ansehen",
    });
    if (total && finishedCount) facts.push({
      text: `${finishedCount} deiner ${total} Bewerbungen haben bereits einen abgeschlossenen Status.`,
      action: "stats", label: "Auswertung öffnen",
    });
    if (olderOpen) facts.push({
      text: `${olderOpen} offene ${olderOpen === 1 ? "Bewerbung wartet" : "Bewerbungen warten"} seit mindestens 14 Tagen auf eine Rückmeldung.`,
      action: "stats", label: "Offene Prozesse prüfen",
    });
    if (!facts.length) facts.push({
      text: "Konkrete Resultate und Beispiele machen Berufserfahrung schneller greifbar als reine Eigenschaftswörter.",
      action: "magic", label: "Bewerbung erfassen",
    });

    const dayIndex = Math.abs(Number(todayISO().replace(/-/g, ""))) % facts.length;
    return {
      id: `fact:${todayISO()}:${dayIndex}`,
      completable: false,
      tone: "fact", icon: "spark", title: "Bewerbungs-Fact",
      ...facts[dayIndex],
    };
  }

  function aiBriefItems() {
    const today = todayISO();
    const currentMonth = today.slice(0, 7);
    const applications = state.draft && !state.isNew
      ? state.apps.map((app) => app.id === state.draft.id ? state.draft : app)
      : state.apps;
    const monthCount = applications.filter((app) => String(app.datum || "").startsWith(currentMonth)).length;
    const goal = Number(userProfile?.monthly_application_goal) || 0;
    const completed = userProfile?.ai_completed_tasks && typeof userProfile.ai_completed_tasks === "object"
      ? userProfile.ai_completed_tasks : {};
    const dueFollowUps = applications
      .filter((app) => app.status === "offen" && app.followUpAt && !app.followUpDoneAt && app.followUpAt <= today)
      .sort((a, b) => String(a.followUpAt).localeCompare(String(b.followUpAt)));
    const dueIds = new Set(dueFollowUps.map((app) => app.id));
    const staleApplications = applications
      .filter((app) => app.status === "offen" && !app.followUpDoneAt && !hadInterview(app) && daysSince(app.datum) >= 7)
      .filter((app) => !dueIds.has(app.id))
      .sort((a, b) => daysSince(b.datum) - daysSince(a.datum));
    const activeInterviews = applications
      .filter((app) => app.status === "offen" && hadInterview(app))
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));

    const followUpItems = [];
    const goalItems = [];
    const interviewItems = [];
    const momentumItems = [];

    dueFollowUps.forEach((dueFollowUp) => {
      followUpItems.push({
        id: `followup:${dueFollowUp.id}:${dueFollowUp.followUpAt}`,
        tone: "attention", icon: "mail", title: "Nachfassen ist heute fällig",
        text: `Bei ${privateCompany(dueFollowUp.firma)} wartet eine geplante Nachfrage.`,
        action: "followup", appId: dueFollowUp.id, label: "E-Mail vorbereiten",
      });
    });
    staleApplications.forEach((staleApplication) => {
      const days = daysSince(staleApplication.datum);
      followUpItems.push({
        id: `stale:${staleApplication.id}:${staleApplication.datum}`,
        tone: "attention", icon: "clock", title: `Seit ${days} Tagen keine Rückmeldung`,
        text: `Du hast dich bei ${privateCompany(staleApplication.firma)} beworben. Möchtest du freundlich nachfragen?`,
        action: "followup", appId: staleApplication.id, label: "Nachfrage erstellen",
      });
    });

    if (goal > 0) {
      const remaining = Math.max(0, goal - monthCount);
      goalItems.push(remaining > 0 ? {
        id: `goal:${currentMonth}:${goal}:${monthCount}`,
        tone: "goal", icon: "target", title: `Noch ${remaining} bis zu deinem Monatsziel`,
        text: `${monthCount} von ${goal} Bewerbungen sind diesen Monat geschafft.`,
        action: "add", label: "Bewerbung hinzufügen",
      } : {
        id: `goal:${currentMonth}:${goal}:${monthCount}`,
        tone: "success", icon: "spark", title: "Monatsziel erreicht",
        text: `Stark – du hast diesen Monat ${monthCount} Bewerbungen erfasst.`,
        action: "stats", label: "Fortschritt ansehen",
      });
    } else {
      goalItems.push({
        id: "goal:setup",
        tone: "goal", icon: "target", title: "Setze dir ein Monatsziel",
        text: "Mit einem persönlichen Ziel zeigt dir Jobply jederzeit, wie viele Bewerbungen noch fehlen.",
        action: "settings", label: "Ziel festlegen",
      });
    }

    activeInterviews.forEach((activeInterview) => {
      interviewItems.push({
        id: `interview:${activeInterview.id}:${activeInterview.phase}:${activeInterview.phaseDates?.[activeInterview.phase] || ""}`,
        tone: "calm", icon: "briefcase", title: "Gespräch im Blick behalten",
        text: `${privateCompany(activeInterview.firma)} befindet sich in der Phase „${PHASE[activeInterview.phase]?.label || "Gespräch"}“.`,
        action: "open", appId: activeInterview.id, label: "Vorbereitung öffnen",
      });
      if (!activeInterview.contactEmail) interviewItems.push({
        id: `contact:${activeInterview.id}:${activeInterview.phase}`,
        tone: "goal", icon: "mail", title: "Kontakt für den nächsten Schritt ergänzen",
        text: `Bei ${privateCompany(activeInterview.firma)} fehlt noch eine Kontakt-E-Mail für dein Follow-up.`,
        action: "followup", appId: activeInterview.id, label: "Kontakt ergänzen",
      });
    });

    const thisWeekCount = applications.filter((app) => {
      const age = daysSince(app.datum);
      return age !== null && age >= 0 && age < 7;
    }).length;
    momentumItems.push(thisWeekCount ? {
      id: `momentum:${today}:${thisWeekCount}`, completable: false,
      tone: "success", icon: "spark", title: `Diese Woche schon ${thisWeekCount} ${thisWeekCount === 1 ? "Bewerbung" : "Bewerbungen"}`,
      text: "Guter Rhythmus. Prüfe als Nächstes, ob alle offenen Prozesse einen klaren nächsten Schritt haben.",
      action: "add", label: "Weitere hinzufügen",
    } : {
      id: `momentum:${today}:0`, completable: false,
      tone: "calm", icon: "spark", title: "Starte mit einem kleinen Schritt",
      text: "Diese Woche ist noch keine neue Bewerbung erfasst. Ein interessanter Job-Link reicht für den Magic Import.",
      action: "magic", label: "Magic Import starten",
    });

    const groups = [followUpItems, goalItems, interviewItems, momentumItems];
    const selected = [];
    const isPending = (item) => item.completable === false || !completed[item.id];
    groups.forEach((group) => {
      if (selected.length >= 3) return;
      const item = group.find((candidate) => isPending(candidate));
      if (item) selected.push(item);
    });
    const selectedIds = new Set(selected.map((item) => item.id));
    groups.flat().filter(isPending).forEach((item) => {
      if (selected.length < 3 && !selectedIds.has(item.id)) {
        selected.push(item);
        selectedIds.add(item.id);
      }
    });
    if (!selected.length) selected.push({
      id: `clear:${currentMonth}`, completable: false,
      tone: "calm", icon: "spark", title: "Alles auf dem aktuellen Stand",
      text: "Es gibt gerade keine dringenden Aufgaben. Neue Stellen kannst du direkt per Magic Import erfassen.",
      action: "magic", label: "Magic Import starten",
    });

    return [...selected.slice(0, 3), aiApplicationFact(applications)];
  }

  function renderAiBrief() {
    const element = $("#aiBrief");
    const items = aiBriefItems();
    const icons = {
      mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3"/><path d="M3 7l9 6 9-6"/></svg>',
      clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
      target: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M15 9l5-5"/></svg>',
      spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/></svg>',
      briefcase: ICONS.briefcase,
    };
    stopAiBriefCarousel();
    aiBriefIndex = 0;
    element.innerHTML = `
      <div class="ai-brief-head">
        <div><span class="ai-mark">AI</span><strong>Dein Tagesbriefing</strong></div>
        <div class="ai-carousel-meta">
          <small data-ai-counter>1 / ${items.length}</small>
          <div class="ai-carousel-dots" aria-label="Briefing-Hinweise">
            ${items.map((_, index) => `<button type="button" class="${index === 0 ? "active" : ""}" data-ai-slide="${index}" aria-label="Hinweis ${index + 1} anzeigen" aria-current="${index === 0 ? "true" : "false"}"></button>`).join("")}
          </div>
        </div>
      </div>
      <div class="ai-carousel-viewport">
        ${items.map((item, index) => `
          <article class="ai-brief-item ${item.tone} ${index === 0 ? "active" : ""}" aria-hidden="${index === 0 ? "false" : "true"}">
            ${item.completable === false ? '<span class="ai-task-check-placeholder"></span>' : `<button type="button" class="ai-task-check" data-ai-complete="${esc(item.id)}" aria-label="Aufgabe „${esc(item.title)}“ erledigen"><svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18.5 8"/></svg></button>`}
            <span class="ai-brief-icon">${icons[item.icon] || icons.spark}</span>
            <div><strong>${esc(item.title)}</strong><p>${esc(item.text)}</p></div>
            <button type="button" data-ai-action="${esc(item.action)}" ${item.appId ? `data-ai-app-id="${esc(item.appId)}"` : ""}>${esc(item.label)}<span>→</span></button>
          </article>`).join("")}
      </div>`;
    scheduleAiBriefCarousel();
  }

  async function completeAiTask(taskId, article) {
    if (!taskId || !currentUser?.id || !userProfile) return;
    const expectedUserId = currentUser.id;
    const expectedEpoch = authEpoch;
    const previous = userProfile.ai_completed_tasks && typeof userProfile.ai_completed_tasks === "object"
      ? { ...userProfile.ai_completed_tasks } : {};
    article?.classList.add("completing");
    await new Promise((resolve) => setTimeout(resolve, 280));
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    const cutoff = Date.now() - 120 * 86400000;
    const completed = Object.fromEntries(Object.entries(previous).filter(([, date]) => {
      const timestamp = Date.parse(String(date));
      return Number.isFinite(timestamp) && timestamp >= cutoff;
    }));
    completed[taskId] = new Date().toISOString();
    userProfile = { ...userProfile, ai_completed_tasks: completed };
    renderAiBrief();
    const { error } = await db.from("user_profiles").upsert({
      user_id: expectedUserId,
      ai_completed_tasks: completed,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (error && isActiveAuthContext(expectedEpoch, expectedUserId)) {
      userProfile = { ...userProfile, ai_completed_tasks: previous };
      renderAiBrief();
      toast("Aufgabe konnte nicht gespeichert werden");
      return;
    }
    if (isActiveAuthContext(expectedEpoch, expectedUserId) && /^(followup|stale):/.test(taskId)) {
      const appId = taskId.split(":")[1];
      const application = state.apps.find((app) => app.id === appId);
      if (application && !application.followUpDoneAt) {
        application.followUpDoneAt = todayISO();
        application.updated = nextUpdated(application);
        persist();
        render();
        toast("Als nachgefragt im Verlauf eingetragen");
      }
    }
  }

  function stopAiBriefCarousel() {
    if (aiBriefTimer) clearTimeout(aiBriefTimer);
    aiBriefTimer = null;
  }

  function scheduleAiBriefCarousel() {
    stopAiBriefCarousel();
    const slides = [...$("#aiBrief").querySelectorAll(".ai-brief-item")];
    if (slides.length < 2 || document.hidden) return;
    aiBriefTimer = setTimeout(() => showAiBriefSlide(aiBriefIndex + 1), AI_BRIEF_INTERVAL);
  }

  function showAiBriefSlide(nextIndex) {
    const element = $("#aiBrief");
    const slides = [...element.querySelectorAll(".ai-brief-item")];
    if (!slides.length) return;
    const next = ((nextIndex % slides.length) + slides.length) % slides.length;
    const current = slides.findIndex((slide) => slide.classList.contains("active"));

    if (current !== next) {
      if (current >= 0) {
        const outgoing = slides[current];
        outgoing.classList.remove("active");
        outgoing.classList.add("leaving");
        outgoing.setAttribute("aria-hidden", "true");
        setTimeout(() => {
          if (outgoing.isConnected) outgoing.classList.remove("leaving");
        }, 720);
      }
      const incoming = slides[next];
      incoming.classList.remove("leaving");
      requestAnimationFrame(() => incoming.classList.add("active"));
      incoming.setAttribute("aria-hidden", "false");
    }

    aiBriefIndex = next;
    const counter = element.querySelector("[data-ai-counter]");
    if (counter) counter.textContent = `${next + 1} / ${slides.length}`;
    element.querySelectorAll("[data-ai-slide]").forEach((dot, index) => {
      dot.classList.toggle("active", index === next);
      dot.setAttribute("aria-current", index === next ? "true" : "false");
    });
    scheduleAiBriefCarousel();
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
    const followUp = followUpChipHTML(a);
    return `
      <button class="card" data-id="${esc(a.id)}" style="--i:${Math.min(i, 24)};--c:${s.color}">
        <div class="avatar" style="--h:${hue(a.firma)}">${esc(privateInitials(a.firma))}</div>
        <div class="card-main">
          <div class="card-title"><strong>${esc(privateCompany(a.firma))}</strong></div>
          <div class="card-role">${esc(a.stelle || "—")}</div>
          <div class="card-meta">
            ${a.datum ? `<span>${ICONS.calendar}${fmtDateLong(a.datum)}</span>` : ""}
            ${a.links.length ? `<span>${ICONS.link}${a.links.length}</span>` : ""}
            ${a.notes.length ? `<span>${ICONS.note}${a.notes.length}</span>` : ""}
            ${followUp}
            ${phaseTagHTML(a)}
          </div>
        </div>
        <div class="card-side">
          <span class="pill ${a.status === "offen" ? "pulse" : ""}" style="--c:${s.color}"><i></i>${s.label}</span>
          ${age ? `<span class="age">${age}</span>` : ""}
        </div>
      </button>`;
  }

  function followUpChipHTML(a) {
    if (a.followUpDoneAt && (a.followUpAt || a.nextAction)) {
      return `<span class="followup-chip done" title="Nachfassen erledigt">${ICONS.check} Erledigt</span>`;
    }
    if (!a.followUpAt) return "";
    const delta = daysSince(a.followUpAt);
    const overdue = delta >= 0;
    const label = delta === 0 ? "Heute nachfassen" : delta > 0 ? `${delta} T. überfällig` : `Nachfassen ${relDays(delta)}`;
    return `<span class="followup-chip ${overdue ? "overdue" : "upcoming"}" title="Nachfassen am ${fmtDate(a.followUpAt)}">${ICONS.flag}${label}</span>`;
  }

  function renderList() {
    els.list.classList.remove("months-grid", "months-list");
    $("#layoutSwitch").querySelectorAll("[data-layout]").forEach((button) => {
      const active = button.dataset.layout === state.monthLayout;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", active ? "true" : "false");
    });
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
    els.list.classList.add(state.monthLayout === "tiles" ? "months-grid" : "months-list");

    // group by month, keeping the sort order
    const groups = new Map();
    for (const a of apps) {
      const key = a.datum ? a.datum.slice(0, 7) : "none";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(a);
    }
    const searching = !!state.query.trim();
    let html = "";
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
    if (open) {
      els.list.querySelectorAll(".month.open").forEach((month) => {
        if (month === section) return;
        month.classList.remove("open");
        month.querySelector(".month-head")?.setAttribute("aria-expanded", "false");
      });
      state.openMonths.clear();
    }
    section.classList.toggle("open", open);
    section.querySelector(".month-head").setAttribute("aria-expanded", open);
    open ? state.openMonths.add(key) : state.openMonths.delete(key);
    saveOpenMonths();
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
      <button class="mini-row" data-open-id="${esc(a.id)}">
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

  function interviewApplication(interview) {
    return state.apps.find((application) => application.id === interview.application_id) || null;
  }

  function interviewPrepHTML(prep) {
    if (!prep || typeof prep !== "object") return "";
    const questions = Array.isArray(prep.recruiterQuestions) ? prep.recruiterQuestions : [];
    const candidateQuestions = Array.isArray(prep.candidateQuestions) ? prep.candidateQuestions : [];
    const focusPoints = Array.isArray(prep.focusPoints) ? prep.focusPoints : [];
    return `
      <section class="prep-panel">
        <div class="prep-hero">
          <div class="prep-box"><h4>Was sucht das Unternehmen?</h4><p>${esc(prep.roleSummary || "–")}</p></div>
          <div class="prep-box"><h4>Dein Einstieg</h4><p>${esc(prep.openingPitch || "–")}</p></div>
          <div class="prep-box"><h4>Darauf solltest du achten</h4><ul>${focusPoints.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
          <div class="prep-box"><h4>Deine Fragen</h4><ul>${candidateQuestions.map((item) => `<li>${esc(item)}</li>`).join("")}</ul></div>
        </div>
        <div class="prep-questions"><h4>Mögliche Recruiter-Fragen</h4>${questions.map((item) => `
          <article class="prep-question"><strong>${esc(item.question || "")}</strong><p>${esc(item.answer || "")}</p><span class="prep-evidence">${esc(item.evidence || "Allgemeiner Vorschlag")}</span></article>`).join("")}</div>
      </section>`;
  }

  function renderInterviews() {
    const overview = $("#interviewOverview"), list = $("#interviewList");
    if (!overview || !list) return;
    const now = Date.now();
    const ordered = [...state.interviews].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
    const upcoming = ordered.filter((item) => new Date(item.scheduled_at).getTime() >= now);
    const prepared = ordered.filter((item) => item.ai_prep).length;
    overview.innerHTML = `
      <div class="interview-summary-card"><span>Kommende Gespräche</span><strong>${upcoming.length}</strong></div>
      <div class="interview-summary-card"><span>Vorbereitet</span><strong>${prepared}</strong></div>
      <div class="interview-summary-card"><span>Gesamt</span><strong>${ordered.length}</strong></div>`;
    if (!ordered.length) {
      list.innerHTML = `<div class="interview-empty"><div class="empty-icon">${ICONS.calendar}</div><h3>Noch kein Gespräch geplant</h3><p>Hänge dein erstes Bewerbungsgespräch an eine Bewerbung und lass dir auf Wunsch eine persönliche Vorbereitung erstellen.</p><button class="btn primary" type="button" data-interview-add>Gespräch hinzufügen</button></div>`;
      return;
    }
    const display = [...upcoming, ...ordered.filter((item) => !upcoming.includes(item)).reverse()];
    list.innerHTML = display.map((interview) => {
      const application = interviewApplication(interview);
      const date = new Date(interview.scheduled_at);
      const past = date.getTime() < now;
      const expanded = interview._expanded && interview.ai_prep;
      return `<article class="interview-card ${past ? "past" : ""}" data-interview-id="${esc(interview.id)}">
        <div class="interview-date"><b>${String(date.getDate()).padStart(2, "0")}</b><span>${MONTHS[date.getMonth()].slice(0,3)} · ${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}</span></div>
        <div class="interview-main"><h3>${esc(privateCompany(application?.firma || "Unbekannte Firma"))}</h3><p>${esc(application?.stelle || "Bewerbung")}</p>
          <div class="interview-meta"><span>${esc(INTERVIEW_STAGES[interview.stage] || INTERVIEW_STAGES.other)}</span><span>${esc(INTERVIEW_FORMATS[interview.format] || INTERVIEW_FORMATS.other)}</span>${interview.interviewer ? `<span>${esc(interview.interviewer)}</span>` : ""}</div>
        </div>
        <div class="interview-actions">
          ${interview.meeting_url ? `<a class="btn ghost sm" href="${esc(interview.meeting_url)}" target="_blank" rel="noopener noreferrer">Meeting</a>` : ""}
          <button class="btn ${interview.ai_prep ? "ghost" : "primary"} sm" type="button" data-interview-prep>${interview.ai_prep ? (expanded ? "Vorbereitung schließen" : "Vorbereitung öffnen") : "KI-Vorbereitung"}</button>
          ${interview.ai_prep ? `<button class="btn ghost sm" type="button" data-interview-regenerate>Neu erstellen</button>` : ""}
          <button class="btn ghost sm" type="button" data-interview-delete aria-label="Gespräch löschen">×</button>
        </div>
        ${expanded ? interviewPrepHTML(interview.ai_prep) : ""}
      </article>`;
    }).join("");
  }

  const interviewOverlay = $("#interviewOverlay"), interviewDialog = $("#interviewDialog"), interviewForm = $("#interviewForm");

  function openInterviewDialog(applicationId = "") {
    if (!state.apps.length) { toast("Erstelle zuerst eine Bewerbung"); return openDrawer(null); }
    const select = $("#interviewApplication");
    select.innerHTML = sortApps(state.apps, "date-desc").map((application) => `<option value="${esc(application.id)}">${esc(application.firma)} · ${esc(application.stelle || "Ohne Stellenbezeichnung")}</option>`).join("");
    select.value = state.apps.some((application) => application.id === applicationId) ? applicationId : select.options[0]?.value || "";
    const start = new Date(Date.now() + 86400000); start.setMinutes(0, 0, 0);
    $("#interviewDate").value = new Date(start.getTime() - start.getTimezoneOffset() * 60000).toISOString().slice(0,16);
    $("#interviewStage").value = "first"; $("#interviewFormat").value = "video";
    $("#interviewInterviewer").value = ""; $("#interviewMeetingUrl").value = ""; $("#interviewNotes").value = "";
    $("#interviewMessage").textContent = "";
    $("#interviewCvNudge").hidden = Boolean(userProfile?.cv_path);
    interviewOverlay.hidden = false; interviewDialog.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { interviewOverlay.classList.add("show"); interviewDialog.classList.add("open"); });
    setTimeout(() => select.focus({ preventScroll: true }), 120);
  }

  function closeInterviewDialog() {
    interviewOverlay.classList.remove("show"); interviewDialog.classList.remove("open"); interviewDialog.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(() => { if (!interviewDialog.classList.contains("open")) interviewOverlay.hidden = true; }, 250);
  }

  async function saveInterview(event) {
    event.preventDefault();
    if (!currentUser?.id) return;
    const submit = interviewForm.querySelector('[type="submit"]');
    const applicationId = $("#interviewApplication").value;
    const scheduled = new Date($("#interviewDate").value);
    if (!applicationId || !Number.isFinite(scheduled.getTime())) return $("#interviewMessage").textContent = "Bitte Bewerbung und Termin auswählen.";
    submit.disabled = true; $("#interviewMessage").textContent = "Gespräch wird gespeichert…";
    const row = {
      user_id: currentUser.id, application_id: applicationId, scheduled_at: scheduled.toISOString(),
      stage: $("#interviewStage").value, format: $("#interviewFormat").value,
      interviewer: $("#interviewInterviewer").value.trim().slice(0,120) || null,
      meeting_url: normalizedWebUrl($("#interviewMeetingUrl").value) || null,
      notes: $("#interviewNotes").value.trim().slice(0,2000), updated_at: new Date().toISOString(),
    };
    try {
      const { data, error } = await db.from("interviews").insert(row).select("*").single();
      if (error) throw error;
      state.interviews.push(data); closeInterviewDialog(); renderInterviews(); toast("Gespräch hinzugefügt");
    } catch (error) {
      $("#interviewMessage").textContent = error.code === "42P01" ? "Die Gesprächs-Datenbank ist noch nicht eingerichtet." : "Gespräch konnte nicht gespeichert werden.";
    } finally { submit.disabled = false; }
  }

  async function createInterviewPrep(interview) {
    const button = $(`[data-interview-id="${CSS.escape(interview.id)}"] [data-interview-prep]`);
    if (button) { button.disabled = true; button.textContent = "KI bereitet vor…"; }
    try {
      const { data, error } = await db.functions.invoke("interview-prep", { body: { interviewId: interview.id } });
      if (error || !data?.ok) throw new Error(data?.error || "prep_failed");
      interview.ai_prep = data.prep; interview.ai_prepared_at = data.preparedAt; interview._expanded = true;
      renderInterviews();
      toast(data.enrichedFromUrl ? "Inserat gelesen und Vorbereitung neu erstellt" : data.usedCv ? "Persönliche Vorbereitung erstellt" : "Vorbereitung ohne CV erstellt");
    } catch { toast("KI-Vorbereitung konnte nicht erstellt werden"); if (button) { button.disabled = false; button.textContent = "KI-Vorbereitung"; } }
  }

  async function deleteInterview(interview) {
    if (!confirm("Dieses Gespräch wirklich löschen?")) return;
    const { error } = await db.from("interviews").delete().eq("id", interview.id).eq("user_id", currentUser.id);
    if (error) return toast("Gespräch konnte nicht gelöscht werden");
    state.interviews = state.interviews.filter((item) => item.id !== interview.id); renderInterviews(); toast("Gespräch gelöscht");
  }

  function setView(view) {
    state.view = ["list", "interviews", "insights"].includes(view) ? view : "list";
    try { localStorage.setItem(VIEW_KEY, view); } catch {}
    const hash = state.view === "insights" ? "#statistiken" : state.view === "interviews" ? "#gespraeche" : location.pathname + location.search;
    history.replaceState(null, "", hash);
    $("#viewList").hidden = state.view !== "list";
    $("#viewInterviews").hidden = state.view !== "interviews";
    $("#viewInsights").hidden = state.view !== "insights";
    const copy = {
      list: ["Dashboard", "Deine Bewerbungen", "Alles an einem Ort – vom ersten Versand bis zum Angebot."],
      interviews: ["Interview Workspace", "Deine Gespräche", "Termine, Vorbereitung und Gesprächsnotizen an einem Ort."],
      insights: ["Analytics", "Deine Statistiken", "Trends, Erfolgsquoten und Fortschritt deiner Jobsuche."],
    }[state.view];
    $("#dashboardKicker").textContent = copy[0];
    $("#dashboardTitle").textContent = copy[1];
    $("#subtitle").textContent = copy[2];
    const addLabel = $("#addBtn span");
    addLabel.textContent = state.view === "interviews" ? "Gespräch hinzufügen" : "Neue Bewerbung";
    $("#addBtn").querySelector("svg").style.display = state.view === "insights" ? "none" : "";
    $("#addBtn").hidden = state.view === "insights";
    $$('[data-workspace-view]').forEach((button) => {
      const active = button.dataset.workspaceView === state.view;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    if (state.view === "insights") renderInsights();
    if (state.view === "interviews") renderInterviews();
  }

  function render({ transition = false } = {}) {
    const run = () => { renderStats(); renderAiBrief(); renderFilters(); renderList(); if (state.view === "insights") renderInsights(); if (state.view === "interviews") renderInterviews(); };
    if (transition && document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.startViewTransition(run);
    } else run();
  }

  /* ---------- Drawer ---------- */
  const drawer = $("#drawer"), overlay = $("#overlay"), form = $("#form");
  const statusPicker = $("#statusPicker"), phaseStepper = $("#phaseStepper"), phaseDateWrap = $("#phaseDateWrap"), phaseDate = $("#phaseDate"), linksList = $("#linksList"), notesList = $("#notesList");
  const linkType = $("#linkType"), linkUrl = $("#linkUrl"), noteText = $("#noteText");
  const followupState = $("#followupState"), snoozeFollowUpBtn = $("#snoozeFollowUpBtn"), completeFollowUpBtn = $("#completeFollowUpBtn");
  const followupBlock = $(".followup-block"), followupToggle = $("#followupToggle");
  const magicImport = $(".magic-import"), jobImportUrl = $("#jobImportUrl"), magicImportStatus = $("#magicImportStatus"), runMagicImportBtn = $("#runMagicImportBtn");
  const emailTemplateTabs = $("#emailTemplateTabs"), emailLanguagePicker = $("#emailLanguagePicker");
  const emailSubject = $("#emailSubject"), emailBody = $("#emailBody");
  const emailRecipient = $("#emailRecipient"), emailComposerHint = $("#emailComposerHint"), markEmailSentBtn = $("#markEmailSentBtn");
  const formField = (name) => form.elements.namedItem(name);
  let lastFocus = null;
  let emailTemplateId = "follow7";
  let emailLanguage = "de";
  let emailTextCustomized = false;
  let timelineDateMode = "phase";

  linkType.innerHTML = LINK_TYPES.map((t) => `<option value="${t.id}">${t.label}</option>`).join("");

  function setFollowupExpanded(expanded) {
    if (expanded) {
      const followupContent = $("#followupContent");
      const expandedHeight = followupToggle.offsetHeight + followupContent.scrollHeight + 2;
      followupBlock.style.setProperty("--followup-expanded-height", `${expandedHeight}px`);
    }
    followupBlock.classList.toggle("expanded", expanded);
    followupToggle.setAttribute("aria-expanded", expanded ? "true" : "false");
  }

  function openDrawer(app, { focusMagic = false } = {}) {
    state.isNew = !app;
    state.draft = app ? structuredClone(app) : {
      id: uid(), firma: "", stelle: "", datum: todayISO(), status: "offen", phase: "beworben", phaseDates: {}, absageAm: "",
      contactName: "", contactEmail: "", nextAction: "", followUpAt: "", followUpDoneAt: "",
      jobUrl: "", jobDescription: "", companyLogoUrl: "", location: "", employmentType: "", workload: "", workModel: "", salaryText: "", sourceMetadata: {},
      links: [], notes: [], updated: Date.now(), _syncedUpdated: 0,
    };
    state.draftOriginal = JSON.stringify(state.draft);
    timelineDateMode = state.draft.status === "absage" ? "outcome" : "phase";
    setFollowupExpanded(false);
    lastFocus = document.activeElement;

    form.firma.value = state.draft.firma;
    form.stelle.value = state.draft.stelle;
    form.datum.value = state.draft.datum;
    form.absageAm.value = state.draft.absageAm;
    form.contactName.value = state.draft.contactName || "";
    form.contactEmail.value = state.draft.contactEmail || "";
    form.nextAction.value = state.draft.nextAction || "";
    form.followUpAt.value = parseDate(state.draft.followUpAt);
    formField("location").value = state.draft.location || "";
    formField("employmentType").value = state.draft.employmentType || "";
    formField("workload").value = state.draft.workload || "";
    formField("workModel").value = state.draft.workModel || "";
    formField("salaryText").value = state.draft.salaryText || "";
    formField("jobDescription").value = state.draft.jobDescription || "";
    jobImportUrl.value = state.draft.jobUrl || "";
    runMagicImportBtn.disabled = false;
    $("#pasteJobUrlBtn").disabled = false;
    setMagicStatus("");
    form.firma.classList.remove("invalid");
    linkUrl.value = ""; noteText.value = "";
    linkType.value = "bestaetigung";
    $("#deleteBtn").hidden = state.isNew;

    renderDrawerHead(); renderStatusPicker(); renderPhase(); renderFollowUpControls(); renderLinks(); renderNotes();
    emailTemplateId = "follow7";
    emailLanguage = "de";
    emailTextCustomized = false;
    renderEmailComposer(true);

    overlay.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    const drawerBody = drawer.querySelector(".drawer-body");
    drawerBody.scrollTop = 0;
    drawerBody.scrollLeft = 0;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { overlay.classList.add("show"); drawer.classList.add("open"); });
    setTimeout(() => (focusMagic ? jobImportUrl : state.isNew ? form.firma : drawer.querySelector(".drawer-head .icon-btn")).focus({ preventScroll: true }), 120);
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
    renderAiBrief();
    lastFocus?.focus?.({ preventScroll: true });
  }

  function syncDraftFields() {
    const d = state.draft;
    d.firma = form.firma.value.trim();
    d.stelle = form.stelle.value.trim();
    d.datum = form.datum.value;
    d.absageAm = form.absageAm.value;
    d.contactName = form.contactName.value.trim();
    d.contactEmail = form.contactEmail.value.trim();
    d.nextAction = form.nextAction.value.trim();
    d.followUpAt = form.followUpAt.value;
    d.location = formField("location").value.trim();
    d.employmentType = formField("employmentType").value.trim();
    d.workload = formField("workload").value.trim();
    d.workModel = formField("workModel").value.trim();
    d.salaryText = formField("salaryText").value.trim();
    d.jobDescription = formField("jobDescription").value.trim();
    d.jobUrl = jobImportUrl.value.trim();
  }

  function setMagicStatus(message, kind = "") {
    magicImportStatus.textContent = message;
    magicImportStatus.className = `magic-import-status ${kind}`.trim();
    magicImport.classList.toggle("loading", kind === "loading");
  }

  function normalizedWebUrl(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).href; }
    catch { return ""; }
  }

  async function runMagicImport() {
    if (!state.draft || runMagicImportBtn.disabled) return;
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser?.id;
    const expectedDraft = state.draft;
    if (!expectedUserId) return;
    const url = normalizedWebUrl(jobImportUrl.value);
    if (!url) {
      setMagicStatus("Bitte füge einen gültigen Job-Link ein.", "error");
      jobImportUrl.focus();
      return;
    }
    jobImportUrl.value = url;
    runMagicImportBtn.disabled = true;
    $("#pasteJobUrlBtn").disabled = true;
    setMagicStatus("Stellenanzeige wird gelesen und mit OpenAI ausgewertet …", "loading");
    try {
      const { data, error } = await db.functions.invoke("magic-import", { body: { url } });
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || state.draft !== expectedDraft) return;
      if (error) {
        let code = "";
        try { code = String((await error.context?.json?.())?.error || ""); } catch {}
        const failure = new Error("magic_import_failed");
        failure.publicMessage = MAGIC_IMPORT_ERRORS[code] || "";
        throw failure;
      }
      if (!data?.ok || !data.data) {
        const failure = new Error("magic_import_failed");
        failure.publicMessage = MAGIC_IMPORT_ERRORS[data?.error] || "";
        throw failure;
      }
      const result = data.data;
      const values = {
        firma: result.company, stelle: result.role, location: result.location,
        employmentType: result.employmentType, workload: result.workload, workModel: result.workModel,
        contactName: result.contactName, contactEmail: result.contactEmail,
        salaryText: result.salaryText, jobDescription: result.description,
      };
      let filled = 0;
      Object.entries(values).forEach(([name, value]) => {
        const input = form.elements.namedItem(name);
        if (input && String(value || "").trim()) { input.value = String(value).trim(); filled++; }
      });
      state.draft.jobUrl = result.jobUrl || url;
      state.draft.companyLogoUrl = result.companyLogoUrl || "";
      state.draft.sourceMetadata = {
        ...(state.draft.sourceMetadata || {}),
        magicImport: { source: result.source, model: result.model, confidence: result.confidence, importedAt: new Date().toISOString() },
      };
      if (!state.draft.links.some((link) => link.type === "inserat" && link.url === state.draft.jobUrl)) {
        state.draft.links.push({ id: uid(), type: "inserat", url: state.draft.jobUrl });
      }
      syncDraftFields();
      renderDrawerHead();
      renderLinks();
      renderEmailComposer(!emailTextCustomized);
      const confidence = Math.round((Number(result.confidence) || 0) * 100);
      setMagicStatus(`${filled} Felder übernommen${confidence ? ` · ${confidence}% Erkennungssicherheit` : ""}. Bitte kurz prüfen.`, "success");
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || state.draft !== expectedDraft) return;
      setMagicStatus(error.publicMessage || "Magic Import ist gerade nicht verfügbar.", "error");
    } finally {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || state.draft !== expectedDraft) return;
      runMagicImportBtn.disabled = false;
      $("#pasteJobUrlBtn").disabled = false;
    }
  }

  function renderFollowUpControls() {
    const d = state.draft;
    const date = form.followUpAt.value;
    followupState.className = "followup-state";
    if (d.followUpDoneAt) {
      const doneDate = parseDate(d.followUpDoneAt);
      followupState.textContent = `Erledigt${doneDate ? ` am ${fmtDate(doneDate)}` : ""}`;
      followupState.classList.add("done");
      completeFollowUpBtn.textContent = "Reaktivieren";
    } else if (date) {
      const delta = daysSince(date);
      followupState.textContent = delta === 0 ? "Heute fällig" : delta > 0 ? `Seit ${delta} Tag${delta === 1 ? "" : "en"} überfällig` : `Fällig ${relDays(delta)}`;
      if (delta >= 0) followupState.classList.add("overdue");
      completeFollowUpBtn.textContent = "Erledigt";
    } else {
      followupState.textContent = "Noch kein Nachfassdatum gesetzt";
      completeFollowUpBtn.textContent = "Erledigt";
    }
    completeFollowUpBtn.disabled = !date && !form.nextAction.value.trim() && !d.followUpDoneAt;
    const sentDate = parseDate(d.followUpDoneAt);
    markEmailSentBtn.disabled = Boolean(sentDate);
    markEmailSentBtn.classList.toggle("sent", Boolean(sentDate));
    markEmailSentBtn.innerHTML = sentDate
      ? `${ICONS.check}<span>Gesendet · ${fmtDate(sentDate).slice(0, 6)}</span>`
      : `${ICONS.check}<span>Als gesendet markieren</span>`;
  }

  function latestInterviewDate() {
    const dates = PHASES.slice(1)
      .map((phase) => parseDate(state.draft?.phaseDates?.[phase.id]))
      .filter(Boolean)
      .sort()
      .reverse();
    return dates[0] || parseDate(form.datum.value) || todayISO();
  }

  function emailTemplateContent(templateId) {
    const english = emailLanguage === "en";
    const company = form.firma.value.trim() || (english ? "your company" : "dem Unternehmen");
    const role = form.stelle.value.trim() || (english ? "the advertised position" : "der ausgeschriebenen Position");
    const applicationDate = parseDate(form.datum.value) || todayISO();
    const interviewDate = latestInterviewDate();
    const contactName = form.contactName.value.trim();
    const greeting = english ? (contactName ? `Hi ${contactName},` : "Hello,") : (contactName ? `Hallo ${contactName},` : "Guten Tag,");
    const closing = english ? "Kind regards" : "Freundliche Grüsse";
    const date = (value) => english
      ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T00:00:00Z`))
      : fmtDate(value);
    const followDays = Number(templateId.replace("follow", ""));

    if (followDays) {
      const elapsedDays = Math.max(0, daysSince(applicationDate));
      if (english) {
        const elapsedSentence = elapsedDays === 0
          ? "I wanted to follow up and ask whether there are any updates on the hiring process."
          : `As ${elapsedDays} day${elapsedDays === 1 ? " has" : "s have"} passed since my application, I wanted to follow up and ask whether there are any updates on the hiring process.`;
        return {
          subject: `Follow-up on my application for ${role}`,
          body: `${greeting}\n\nI applied for the ${role} position at ${company} on ${date(applicationDate)}. ${elapsedSentence}\n\nI remain very interested in the opportunity and would appreciate any information you can share about the next steps.\n\n${closing}`,
        };
      }
      const elapsedSentence = elapsedDays === 0
        ? "Ich möchte mich freundlich nach dem aktuellen Stand des Auswahlprozesses erkundigen."
        : `Da seit meiner Bewerbung inzwischen ${elapsedDays} Tag${elapsedDays === 1 ? " vergangen ist" : "e vergangen sind"}, möchte ich mich freundlich nach dem aktuellen Stand des Auswahlprozesses erkundigen.`;
      return {
        subject: `Nachfrage zu meiner Bewerbung als ${role}`,
        body: `${greeting}\n\nam ${date(applicationDate)} habe ich mich bei ${company} als ${role} beworben. ${elapsedSentence}\n\nDie Position interessiert mich weiterhin sehr. Über eine kurze Rückmeldung zum weiteren Vorgehen freue ich mich.\n\n${closing}`,
      };
    }
    if (templateId === "thanks") {
      if (english) {
        return {
          subject: `Thank you for the interview – ${role}`,
          body: `${greeting}\n\nThank you for the enjoyable conversation on ${date(interviewDate)} about the ${role} position at ${company}. Our discussion further strengthened my interest in the role and in joining your team.\n\nPlease let me know if I can provide any additional information. I look forward to hearing about the next steps.\n\n${closing}`,
        };
      }
      return {
        subject: `Vielen Dank für das Gespräch zur Position ${role}`,
        body: `${greeting}\n\nvielen Dank für das angenehme Gespräch am ${date(interviewDate)} zur Position ${role} bei ${company}. Der Austausch hat mein Interesse an der Rolle und an einer Zusammenarbeit nochmals bestärkt.\n\nFalls Sie noch weitere Informationen von mir benötigen, lasse ich Ihnen diese gerne zukommen. Ich freue mich auf die nächsten Schritte.\n\n${closing}`,
      };
    }
    if (english) {
      return {
        subject: `Next steps in the hiring process – ${role}`,
        body: `${greeting}\n\nThank you again for our conversation on ${date(interviewDate)} regarding the ${role} position at ${company}. I wanted to ask about the next steps in the hiring process and when I might expect an update.\n\nI remain very interested in the position and look forward to hearing from you.\n\n${closing}`,
      };
    }
    return {
      subject: `Nächste Schritte im Bewerbungsprozess – ${role}`,
      body: `${greeting}\n\nnochmals vielen Dank für den bisherigen Austausch zur Position ${role} bei ${company} am ${date(interviewDate)}. Ich wollte mich freundlich erkundigen, wie der weitere Bewerbungsprozess aussieht und wann ich ungefähr mit einer Rückmeldung rechnen darf.\n\nMein Interesse an der Position besteht weiterhin, und ich freue mich auf den nächsten Schritt.\n\n${closing}`,
    };
  }

  function renderEmailComposer(resetText = false) {
    if (!state.draft) return;
    const recipient = form.contactEmail.value.trim();
    emailRecipient.textContent = recipient ? `An ${recipient}` : "Noch keine Kontakt-E-Mail hinterlegt";
    emailTemplateTabs.querySelectorAll("[data-email-template]").forEach((tab) => {
      const active = tab.dataset.emailTemplate === emailTemplateId;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.textContent = EMAIL_TEMPLATE_TAB_LABELS[emailLanguage][tab.dataset.emailTemplate];
    });
    emailLanguagePicker.querySelectorAll("[data-email-language]").forEach((button) => {
      const active = button.dataset.emailLanguage === emailLanguage;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    if (resetText || !emailTextCustomized) {
      const content = emailTemplateContent(emailTemplateId);
      emailSubject.value = content.subject;
      emailBody.value = content.body;
      emailTextCustomized = false;
    }
    emailComposerHint.textContent = EMAIL_TEMPLATE_LABELS[emailLanguage][emailTemplateId];
  }

  async function copyEmailDraft() {
    const text = `Betreff: ${emailSubject.value.trim()}\n\n${emailBody.value.trim()}`;
    try {
      await navigator.clipboard.writeText(text);
      toast("E-Mail-Text kopiert");
    } catch {
      emailBody.focus();
      emailBody.select();
      toast("Text markieren und mit ⌘/Ctrl + C kopieren");
    }
  }

  function openEmailDraft() {
    const recipient = form.contactEmail.value.trim();
    const subject = emailSubject.value.trim();
    const body = emailBody.value.trim();
    if (!subject && !body) return toast("Bitte ergänze zuerst den E-Mail-Text");
    const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    if (!recipient) toast("Mailprogramm geöffnet – Empfänger bitte ergänzen");
  }

  function markFollowUpDone({ sent = false } = {}) {
    state.draft.followUpDoneAt = todayISO();
    timelineDateMode = "followup";
    renderFollowUpControls();
    renderPhase();
    renderAiBrief();
    toast(sent ? "E-Mail als gesendet markiert" : "Nachfrage im Verlauf eingetragen");
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
    const hasRejection = d.status === "absage";
    const followedUpAt = parseDate(d.followUpDoneAt);
    const eventsAfterPhase = new Map();
    const addEvent = (afterIndex, event) => eventsAfterPhase.set(afterIndex, [...(eventsAfterPhase.get(afterIndex) || []), event]);
    if (followedUpAt) {
      let afterIndex = 0;
      PHASES.slice(1, idx + 1).forEach((phase, index) => {
        const phaseDateValue = parseDate(d.phaseDates?.[phase.id]);
        if (phaseDateValue && phaseDateValue <= followedUpAt) afterIndex = index + 1;
      });
      addEvent(afterIndex, { type: "followup", date: followedUpAt });
    }
    if (hasRejection) addEvent(idx, { type: "outcome", date: parseDate(form.absageAm.value) });
    eventsAfterPhase.forEach((events) => events.sort((a, b) => String(a.date).localeCompare(String(b.date))));
    const steps = [];
    phaseStepper.style.setProperty("--end", endColor);
    PHASES.forEach((p, i) => {
      const date = i === 0 ? form.datum.value : d.phaseDates[p.id];
      const cls = i < idx || (hasRejection && i === idx) ? "done" : i === idx ? "done current" : "";
      steps.push(`
        <button type="button" class="step ${cls}" data-phase="${p.id}" style="--i:${i}" aria-pressed="${i === idx}">
          <span class="step-dot">${i < idx || (hasRejection && i === idx) ? ICONS.check : i + 1}</span>
          <span class="step-label">${p.label}</span>
          <span class="step-date">${i <= idx && date ? fmtDate(date).slice(0, 6) : ""}</span>
        </button>`);
      (eventsAfterPhase.get(i) || []).forEach((event) => {
        if (event.type === "followup") steps.push(`
          <button type="button" class="step followup-step done" data-followup-step style="--i:${steps.length}" aria-pressed="${timelineDateMode === "followup"}">
            <span class="step-dot">${ICONS.mail}</span>
            <span class="step-label">Nachgefragt</span>
            <span class="step-date">${fmtDate(event.date).slice(0, 6)}</span>
          </button>`);
        if (event.type === "outcome") steps.push(`
          <button type="button" class="step outcome-step done current" data-outcome-step="absage" style="--i:${steps.length}" aria-pressed="${timelineDateMode === "outcome"}">
            <span class="step-dot">${ICONS.x}</span>
            <span class="step-label">Absage</span>
            <span class="step-date">${form.absageAm.value ? fmtDate(form.absageAm.value).slice(0, 6) : ""}</span>
          </button>`);
      });
    });
    phaseStepper.style.setProperty("--steps", String(steps.length));
    phaseStepper.innerHTML = steps.join("");
    phaseDateWrap.hidden = timelineDateMode === "phase" && idx === 0;
    if (timelineDateMode === "followup" && followedUpAt) {
      $("#phaseDateLabel").textContent = "Datum „Nachgefragt“";
      phaseDate.value = followedUpAt;
    } else if (hasRejection && timelineDateMode === "outcome") {
      $("#phaseDateLabel").textContent = "Datum „Absage“";
      phaseDate.value = form.absageAm.value || todayISO();
    } else if (idx > 0) {
      $("#phaseDateLabel").textContent = `Datum „${PHASE[d.phase].label}“`;
      phaseDate.value = d.phaseDates[d.phase] || "";
    }
  }

  function setPhase(id) {
    const d = state.draft;
    timelineDateMode = "phase";
    d.phase = id;
    const idx = phaseIdx(id);
    // keep dates of reached steps, drop the ones beyond
    PHASES.forEach((p, i) => { if (i > idx) delete d.phaseDates[p.id]; });
    if (idx > 0 && !d.phaseDates[id]) d.phaseDates[id] = todayISO();
    renderPhase();
    renderEmailComposer(!emailTextCustomized);
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
        <div class="link-item" data-id="${esc(l.id)}">
          <span class="link-icon" style="--c:${t.color}">${l.url.includes("mail.") ? ICONS.mail : ICONS.link}</span>
          <a href="${esc(href)}" target="_blank" rel="noopener noreferrer">
            <b>${t.label}</b><small>${esc(prettyUrl(l.url))}</small>
          </a>
          <button type="button" class="mini-btn" data-remove-link="${esc(l.id)}" aria-label="Link entfernen">${ICONS.x}</button>
        </div>`;
    }).join("") : `<div class="empty-mini">Noch keine Links – füge z.B. den Gmail-Link zur Bestätigung hinzu.</div>`;
  }

  function renderNotes() {
    const notes = [...state.draft.notes].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    notesList.innerHTML = notes.map((n) => `
      <li class="note" data-id="${esc(n.id)}">
        <div class="note-head">
          <time>${fmtDateLong(n.date)}</time>
          <button type="button" class="mini-btn" data-remove-note="${esc(n.id)}" aria-label="Notiz löschen">${ICONS.x}</button>
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
      timelineDateMode = "outcome";
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
    state.draft.updated = nextUpdated(state.draft);
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
    const el = els.list.querySelector(`[data-id="${CSS.escape(String(id))}"]`);
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
    if (app._syncedUpdated) pendingDeletes.set(app.id, Number(app._syncedUpdated));
    persist();
    closeDrawer(true);
    render({ transition: true });
    toast(state.privacy ? "Bewerbung gelöscht" : `${app.firma} gelöscht`, {
      action: "Rückgängig",
      onAction: () => { pendingDeletes.delete(app.id); state.apps.splice(idx, 0, app); persist(); render({ transition: true }); },
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

  /* ---------- Inbound E-Mail Assistant ---------- */
  const inboundDialog = $("#inboundDialog"), inboundOverlay = $("#inboundOverlay");
  const inboundAddress = $("#inboundAddress"), inboundStatusText = $("#inboundStatusText");
  const inboundStatusDot = $("#inboundStatusDot"), toggleInboundBtn = $("#toggleInboundBtn");
  const copyInboundAddressBtn = $("#copyInboundAddressBtn"), inboundSuggestionsList = $("#inboundSuggestionsList");
  const editInboundAliasBtn = $("#editInboundAliasBtn"), inboundAliasEditor = $("#inboundAliasEditor");
  const inboundAliasInput = $("#inboundAliasInput"), inboundDomainSuffix = $("#inboundDomainSuffix");
  const saveInboundAliasBtn = $("#saveInboundAliasBtn"), cancelInboundAliasBtn = $("#cancelInboundAliasBtn");
  const inboundBadge = $("#inboundBadge");
  let inboundSettings = null, inboundSuggestions = [], inboundLastFocus = null;

  const INBOUND_EVENT_LABELS = {
    confirmation: "Eingangsbestätigung",
    rejection: "Absage",
    interview_1: "Einladung · 1. Gespräch",
    interview_2: "Einladung · 2. Gespräch",
    final_round: "Finale Runde",
    offer: "Angebot",
    process_update: "Prozess-Update",
  };

  function updateInboundBadge() {
    const count = inboundSuggestions.length;
    inboundBadge.textContent = count > 99 ? "99+" : String(count);
    inboundBadge.hidden = !count;
    $("#inboundBtn").setAttribute("aria-label", count ? `E-Mail Inbox, ${count} offene Vorschläge` : "E-Mail Inbox");
  }

  function renderInboundSettings(error = "") {
    const configured = Boolean(inboundSettings?.configured);
    const enabled = Boolean(inboundSettings?.enabled);
    inboundAddress.value = inboundSettings?.email || "";
    inboundStatusDot.className = error ? "error" : enabled ? "active" : "";
    if (error) inboundStatusText.textContent = "Die E-Mail-Automatisierung ist noch nicht vollständig eingerichtet.";
    else if (!configured) inboundStatusText.textContent = "Die Resend-Domain muss noch mit Supabase verbunden werden.";
    else if (enabled) inboundStatusText.textContent = "Aktiv · weitergeleitete E-Mails werden als Vorschlag geprüft.";
    else inboundStatusText.textContent = "Bereit, aber noch deaktiviert.";
    toggleInboundBtn.disabled = !configured || Boolean(error);
    toggleInboundBtn.textContent = enabled ? "Deaktivieren" : "Aktivieren";
    copyInboundAddressBtn.disabled = !inboundSettings?.email;
    editInboundAliasBtn.disabled = !configured || Boolean(error);
    inboundDomainSuffix.textContent = `@${inboundSettings?.domain || "jobply.app"}`;
  }

  function closeInboundAliasEditor() {
    inboundAliasEditor.hidden = true;
    inboundAliasInput.setAttribute("aria-invalid", "false");
    editInboundAliasBtn.focus({ preventScroll: true });
  }

  function openInboundAliasEditor() {
    if (!inboundSettings?.configured) return;
    inboundAliasInput.value = inboundSettings.alias || String(inboundSettings.email || "").split("@")[0];
    inboundAliasEditor.hidden = false;
    inboundAliasInput.focus({ preventScroll: true });
    inboundAliasInput.select();
  }

  async function saveInboundAlias() {
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser?.id;
    if (!expectedUserId) return;
    const alias = inboundAliasInput.value.trim().toLowerCase();
    if (!/^[a-z][a-z0-9-]{2,31}$/.test(alias)) {
      inboundAliasInput.setAttribute("aria-invalid", "true");
      toast("Bitte 3–32 gültige Zeichen verwenden");
      return;
    }
    saveInboundAliasBtn.disabled = true;
    const { data, error } = await db.functions.invoke("inbound-settings", { body: { alias } });
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    saveInboundAliasBtn.disabled = false;
    if (error || !data?.ok) {
      inboundAliasInput.setAttribute("aria-invalid", "true");
      toast(data?.message || "Dieser Alias konnte nicht gespeichert werden");
      return;
    }
    inboundSettings = data.data;
    renderInboundSettings();
    closeInboundAliasEditor();
    toast("Deine Jobply-Adresse wurde aktualisiert");
  }

  function candidateOptions(selectedId = "") {
    const sorted = sortApps(state.apps, "updated");
    return `<option value="">Bewerbung auswählen …</option>${sorted.map((app) =>
      `<option value="${esc(app.id)}" ${app.id === selectedId ? "selected" : ""}>${esc(privateCompany(app.firma))} · ${esc(app.stelle || "Ohne Stelle")}</option>`
    ).join("")}`;
  }

  function renderInboundSuggestions({ loading = false, error = "" } = {}) {
    updateInboundBadge();
    if (loading) {
      inboundSuggestionsList.innerHTML = `<div class="suggestion-empty"><strong>Vorschläge werden geladen …</strong><span>Einen Moment bitte.</span></div>`;
      return;
    }
    if (error) {
      inboundSuggestionsList.innerHTML = `<div class="suggestion-empty"><strong>Noch nicht verbunden</strong><span>${esc(error)}</span></div>`;
      return;
    }
    if (!inboundSuggestions.length) {
      inboundSuggestionsList.innerHTML = `<div class="suggestion-empty"><strong>Alles erledigt</strong><span>Neue erkannte E-Mails erscheinen hier zur Bestätigung.</span></div>`;
      return;
    }
    inboundSuggestionsList.innerHTML = inboundSuggestions.map((suggestion) => {
      const payload = suggestion.payload || {};
      const changes = [];
      if (payload.suggestedStatus && payload.suggestedStatus !== "unchanged") changes.push(`Status: ${STATUS[payload.suggestedStatus]?.label || payload.suggestedStatus}`);
      if (payload.suggestedPhase && payload.suggestedPhase !== "unchanged") changes.push(`Phase: ${PHASE[payload.suggestedPhase]?.label || payload.suggestedPhase}`);
      if (payload.eventDate) changes.push(`Datum: ${fmtDate(payload.eventDate)}`);
      if (payload.contactName || payload.contactEmail) changes.push("Kontakt ergänzen");
      const matched = state.apps.some((app) => app.id === suggestion.application_id) ? suggestion.application_id : "";
      const confidence = Math.round((Number(suggestion.confidence) || 0) * 100);
      return `<article class="suggestion-card" data-suggestion-id="${esc(suggestion.id)}">
        <div class="suggestion-top">
          <div><span class="suggestion-event"><i></i>${esc(INBOUND_EVENT_LABELS[suggestion.suggestion_type] || "E-Mail-Update")}</span>
            <h4 class="suggestion-private">${esc(payload.company || "Firma nicht sicher erkannt")}</h4>
            <p class="suggestion-role suggestion-private">${esc(payload.role || "Stelle nicht sicher erkannt")}${payload.receivedAt ? ` · ${esc(fmtDate(String(payload.receivedAt).slice(0, 10)))}` : ""}</p>
          </div>
          <span class="suggestion-confidence">${confidence}% sicher</span>
        </div>
        <p class="suggestion-summary suggestion-private">${esc(payload.summary || "Änderung aus einer weitergeleiteten E-Mail erkannt.")}</p>
        ${changes.length ? `<div class="suggestion-changes">${changes.map((change) => `<span>${esc(change)}</span>`).join("")}</div>` : ""}
        <div class="suggestion-actions">
          <select data-inbound-application aria-label="Zugehörige Bewerbung">${candidateOptions(matched)}</select>
          <button type="button" class="btn ghost sm" data-reject-inbound>Verwerfen</button>
          <button type="button" class="btn primary sm" data-accept-inbound>Übernehmen</button>
        </div>
      </article>`;
    }).join("");
  }

  async function loadInboundSettings(expectedEpoch, expectedUserId) {
    const { data, error } = await db.functions.invoke("inbound-settings", { body: {} });
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    if (error || !data?.ok) throw error || new Error(data?.message || "Einstellungen konnten nicht geladen werden.");
    inboundSettings = data.data;
    renderInboundSettings();
  }

  async function loadInboundSuggestions({ quiet = false, expectedEpoch, expectedUserId } = {}) {
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    if (!quiet) renderInboundSuggestions({ loading: true });
    const { data, error } = await db.from("automation_suggestions")
      .select("id, application_id, suggestion_type, payload, confidence, created_at")
      .eq("source", "email").eq("status", "pending").order("created_at", { ascending: false });
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    if (error) throw error;
    inboundSuggestions = data || [];
    renderInboundSuggestions();
  }

  async function refreshInbound({ quiet = false } = {}) {
    if (!currentUser) return;
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser.id;
    try {
      await Promise.all([
        loadInboundSettings(expectedEpoch, expectedUserId),
        loadInboundSuggestions({ quiet, expectedEpoch, expectedUserId }),
      ]);
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      renderInboundSettings("E-Mail-Assistent gerade nicht verfügbar");
      if (!quiet) renderInboundSuggestions({ error: "Bitte zuerst Datenbank, Edge Functions und Resend konfigurieren." });
    }
  }

  function openInboundDialog() {
    inboundLastFocus = document.activeElement;
    inboundOverlay.hidden = false;
    inboundDialog.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => { inboundOverlay.classList.add("show"); inboundDialog.classList.add("open"); });
    refreshInbound();
    setTimeout(() => $("[data-close-inbound]", inboundDialog)?.focus({ preventScroll: true }), 100);
  }

  function closeInboundDialog() {
    if (!inboundDialog.classList.contains("open")) return;
    inboundDialog.classList.remove("open");
    inboundOverlay.classList.remove("show");
    inboundDialog.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    setTimeout(() => {
      if (!inboundDialog.classList.contains("open")) inboundOverlay.hidden = true;
      inboundLastFocus?.focus?.({ preventScroll: true });
    }, 300);
  }

  async function toggleInbound() {
    if (!inboundSettings?.configured) return;
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser?.id;
    if (!expectedUserId) return;
    toggleInboundBtn.disabled = true;
    const next = !inboundSettings.enabled;
    const { data, error } = await db.functions.invoke("inbound-settings", { body: { enabled: next } });
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    if (error || !data?.ok) {
      toggleInboundBtn.disabled = false;
      toast("Aktivierung konnte nicht geändert werden");
      return;
    }
    inboundSettings = data.data;
    renderInboundSettings();
    toast(next ? "E-Mail-Automatisierung aktiviert" : "E-Mail-Automatisierung deaktiviert");
  }

  async function reviewInboundSuggestion(card, accepted) {
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser?.id;
    if (!expectedUserId) return;
    const suggestion = inboundSuggestions.find((item) => item.id === card.dataset.suggestionId);
    if (!suggestion) return;
    const buttons = card.querySelectorAll("button");
    buttons.forEach((button) => (button.disabled = true));
    try {
      if (accepted) {
        const applicationId = card.querySelector("[data-inbound-application]").value;
        const app = state.apps.find((item) => item.id === applicationId);
        if (!app) throw new Error("Bitte wähle zuerst die passende Bewerbung aus.");
        const expectedUpdated = Number(app._syncedUpdated) || 0;
        if (!expectedUpdated) throw new Error("optimistic_conflict");
        const candidate = structuredClone(app);
        const payload = suggestion.payload || {};
        if (STATUS[payload.suggestedStatus] && payload.suggestedStatus !== "unchanged") candidate.status = payload.suggestedStatus;
        if (PHASE[payload.suggestedPhase] && payload.suggestedPhase !== "unchanged") candidate.phase = payload.suggestedPhase;
        const eventDate = parseDate(payload.eventDate);
        if (eventDate && PHASE[payload.suggestedPhase] && payload.suggestedPhase !== "beworben") candidate.phaseDates[payload.suggestedPhase] = eventDate;
        if (eventDate && ["absage", "angebot"].includes(payload.suggestedStatus)) candidate.absageAm = eventDate;
        if (eventDate && payload.eventType === "confirmation" && !candidate.datum) candidate.datum = eventDate;
        if (payload.contactName) candidate.contactName = String(payload.contactName);
        if (payload.contactEmail) candidate.contactEmail = String(payload.contactEmail);
        const summary = String(payload.summary || "").trim();
        if (summary && !candidate.notes.some((note) => note.text === summary)) candidate.notes.unshift({ id: uid(), text: summary, date: eventDate || todayISO() });
        candidate.sourceMetadata = { ...(candidate.sourceMetadata || {}), lastInboundSuggestionId: suggestion.id };
        candidate.updated = nextUpdated(candidate);
        const { data: updatedApplication, error: applicationError } = await db.from("applications")
          .update(toRow(candidate, expectedUserId))
          .eq("user_id", expectedUserId)
          .eq("id", app.id)
          .eq("updated_at", expectedUpdated)
          .select("updated_at")
          .maybeSingle();
        if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
        if (applicationError) throw applicationError;
        if (!updatedApplication) throw new Error("optimistic_conflict");
        Object.assign(app, candidate, { _syncedUpdated: Number(updatedApplication.updated_at) });
        suggestion.application_id = app.id;
      }
      const applicationId = accepted ? card.querySelector("[data-inbound-application]").value : suggestion.application_id;
      const { error } = await db.from("automation_suggestions").update({
        status: accepted ? "accepted" : "rejected",
        application_id: applicationId || null,
        reviewed_at: new Date().toISOString(),
      }).eq("id", suggestion.id);
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      if (error) throw error;
      inboundSuggestions = inboundSuggestions.filter((item) => item.id !== suggestion.id);
      persist();
      render({ transition: true });
      renderInboundSuggestions();
      toast(accepted ? "Änderung übernommen" : "Vorschlag verworfen");
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      toast(error?.message === "Bitte wähle zuerst die passende Bewerbung aus."
        ? error.message
        : error?.message === "optimistic_conflict" ? "Die Bewerbung wurde in einem anderen Tab geändert. Bitte neu laden."
        : "Vorschlag konnte nicht verarbeitet werden");
      buttons.forEach((button) => (button.disabled = false));
    }
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
    pendingImport = null;
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
    const expectedEpoch = authEpoch;
    const expectedUserId = currentUser?.id;
    if (!expectedUserId) return;
    if (file.size > 5 * 1024 * 1024) {
      showImportResult({ file, errors: ["Die Datei ist grösser als 5 MB."], fatal: true });
      return;
    }
    try {
      const text = await file.text();
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
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
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      showImportResult({ file, errors: [e.message || "Die Datei konnte nicht gelesen werden."], fatal: true });
    }
  }

  function commitImport() {
    if (!pendingImport) return;
    if (pendingImport.type === "json") {
      if (state.apps.length && !confirm(`Backup mit ${pendingImport.apps.length} Einträgen wiederherstellen? Die aktuellen Daten werden ersetzt.`)) return;
      const current = new Map(state.apps.map((app) => [app.id, app]));
      const restoredIds = new Set(pendingImport.apps.map((app) => app.id));
      state.apps.forEach((app) => {
        if (!restoredIds.has(app.id) && app._syncedUpdated) pendingDeletes.set(app.id, Number(app._syncedUpdated));
      });
      state.apps = pendingImport.apps.map((app) => {
        const existing = current.get(app.id);
        app._syncedUpdated = Number(existing?._syncedUpdated) || 0;
        app.updated = Date.now();
        return app;
      });
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
      id: safeId(a.id),
      firma: String(a.firma || ""),
      stelle: String(a.stelle || ""),
      datum: parseDate(a.datum),
      status: parsed.status,
      phase,
      phaseDates,
      absageAm: parseDate(a.absageAm),
      links: Array.isArray(a.links) ? a.links.filter((l) => l && l.url).map((l) => ({ id: safeId(l.id), type: LINK_TYPE[l.type] ? l.type : "sonstiges", url: String(l.url) })) : [],
      notes: Array.isArray(a.notes) ? a.notes.filter((n) => n && n.text).map((n) => ({ id: safeId(n.id), text: String(n.text), date: parseDate(n.date) || todayISO() })) : [],
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
      followUpAt: parseDate(a.followUpAt),
      followUpDoneAt: String(a.followUpDoneAt || ""),
      nextAction: String(a.nextAction || ""),
      sourceMetadata: a.sourceMetadata && typeof a.sourceMetadata === "object" ? a.sourceMetadata : {},
      updated: a.updated || Date.now(),
      _syncedUpdated: Number(a._syncedUpdated) || 0,
    };
  }

  /* ---------- Settings center ---------- */
  const settingsPanel = $("#settingsPanel"), settingsOverlay = $("#settingsOverlay");
  const deleteAccountConfirm = $("#deleteAccountConfirm"), deleteAccountInput = $("#deleteAccountInput");
  let settingsOpen = false;

  function updateNavIdentity(profile = null) {
    $("#userEmail").textContent = state.privacy ? "Konto geschützt" : (currentUser?.email || "Angemeldet");
  }

  async function openSettings() {
    if (!currentUser?.id || settingsOpen) return;
    settingsOpen = true;
    settingsOverlay.hidden = false;
    requestAnimationFrame(() => settingsOverlay.classList.add("show"));
    settingsPanel.classList.add("open");
    settingsPanel.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    deleteAccountConfirm.hidden = true;
    deleteAccountInput.value = "";
    $("#confirmDeleteAccountBtn").disabled = true;
    $("#deleteAccountMessage").textContent = "";
    $("#settingsAccountMessage").textContent = "Profil wird geladen…";
    $("#settingsEmail").value = currentUser.email || "";
    updateNavIdentity();
    try {
      const expectedUserId = currentUser.id;
      const { data, error } = await db.from("user_profiles")
        .select("display_name,target_role,employment_status,monthly_application_goal,ai_completed_tasks,cv_path,cv_name,cv_uploaded_at")
        .eq("user_id", expectedUserId).maybeSingle();
      if (error) throw error;
      if (!settingsOpen || currentUser?.id !== expectedUserId) return;
      $("#settingsName").value = data?.display_name || "";
      $("#settingsRole").value = data?.target_role || "";
      $("#settingsEmployment").value = data?.employment_status || "";
      $("#settingsGoal").value = data?.monthly_application_goal || 10;
      $("#settingsCvStatus").textContent = data?.cv_name ? `${data.cv_name} · privat gespeichert` : "Noch kein Lebenslauf hinterlegt";
      $("#settingsAccountMessage").textContent = "";
      userProfile = data || null;
      updateNavIdentity(data);
    } catch {
      $("#settingsAccountMessage").textContent = "Profildaten konnten nicht geladen werden.";
    }
  }

  function closeSettings() {
    if (!settingsOpen) return;
    settingsOpen = false;
    settingsPanel.classList.remove("open");
    settingsPanel.setAttribute("aria-hidden", "true");
    settingsOverlay.classList.remove("show");
    setTimeout(() => { if (!settingsOpen) settingsOverlay.hidden = true; }, 250);
    document.body.style.overflow = drawer.classList.contains("open") ? "hidden" : "";
    deleteAccountInput.value = "";
  }

  async function saveAccountSettings(event) {
    event.preventDefault();
    if (!currentUser?.id) return;
    const button = $("#saveAccountSettingsBtn");
    const message = $("#settingsAccountMessage");
    const expectedUserId = currentUser.id;
    const nextEmail = $("#settingsEmail").value.trim().toLowerCase();
    const goal = Math.max(1, Math.min(50, Number($("#settingsGoal").value) || 10));
    button.disabled = true;
    message.textContent = "Wird gespeichert…";
    try {
      const profile = {
        user_id: expectedUserId,
        display_name: $("#settingsName").value.trim().slice(0, 80) || null,
        target_role: $("#settingsRole").value.trim().slice(0, 120) || null,
        employment_status: $("#settingsEmployment").value || null,
        monthly_application_goal: goal,
        onboarding_completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error: profileError } = await db.from("user_profiles").upsert(profile, { onConflict: "user_id" });
      if (profileError) throw profileError;
      let emailNotice = "";
      if (nextEmail && nextEmail !== String(currentUser.email || "").toLowerCase()) {
        const { data, error } = await db.auth.updateUser({ email: nextEmail });
        if (error) throw error;
        if (data?.user) currentUser = data.user;
        emailNotice = " Bestätige die neue E-Mail-Adresse über den zugesandten Link.";
      }
      if (currentUser?.id !== expectedUserId) return;
      userProfile = { ...(userProfile || {}), ...profile };
      updateNavIdentity(profile);
      renderAiBrief();
      message.textContent = `Gespeichert.${emailNotice}`;
      toast("Account aktualisiert");
    } catch (error) {
      message.textContent = error?.message || "Änderungen konnten nicht gespeichert werden.";
    } finally {
      button.disabled = false;
    }
  }

  async function uploadCv(file, { onboarding = false } = {}) {
    if (!currentUser?.id || !file) return false;
    const allowed = ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
    if (!allowed.includes(file.type) || !/\.(pdf|docx)$/i.test(file.name)) {
      toast("Bitte verwende eine PDF- oder DOCX-Datei"); return false;
    }
    if (file.size > 10 * 1024 * 1024) { toast("Der Lebenslauf darf maximal 10 MB gross sein"); return false; }
    const expectedUserId = currentUser.id;
    const extension = file.name.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
    const path = `${expectedUserId}/cv/${crypto.randomUUID()}.${extension}`;
    const oldPath = userProfile?.cv_path || "";
    if (onboarding) $("#onboardingMessage").textContent = "Lebenslauf wird sicher gespeichert…";
    else $("#settingsCvStatus").textContent = "Lebenslauf wird hochgeladen…";
    const { error: uploadError } = await db.storage.from("private-cvs").upload(path, file, { contentType: file.type, upsert: false, cacheControl: "0" });
    if (uploadError) { toast("Lebenslauf konnte nicht hochgeladen werden"); return false; }
    const cvProfile = { user_id: expectedUserId, cv_path: path, cv_name: file.name.slice(0,180), cv_uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const { error: profileError } = await db.from("user_profiles").upsert(cvProfile, { onConflict: "user_id" });
    if (profileError || currentUser?.id !== expectedUserId) {
      await db.storage.from("private-cvs").remove([path]);
      toast("CV-Zuordnung konnte nicht gespeichert werden"); return false;
    }
    userProfile = { ...(userProfile || {}), ...cvProfile };
    if (oldPath && oldPath !== path) await db.storage.from("private-cvs").remove([oldPath]);
    $("#settingsCvStatus").textContent = `${file.name} · privat gespeichert`;
    $("#onboardingCvLabel").textContent = file.name;
    toast("Lebenslauf sicher gespeichert");
    return true;
  }

  async function deleteOwnAccount() {
    if (!currentUser?.id || deleteAccountInput.value.trim() !== "LÖSCHEN") return;
    const button = $("#confirmDeleteAccountBtn"), message = $("#deleteAccountMessage");
    button.disabled = true;
    message.textContent = "Account wird sicher gelöscht…";
    try {
      const { data, error } = await db.functions.invoke("delete-account", { body: { action: "delete-account", confirmation: "LÖSCHEN" } });
      if (error || !data?.ok) throw error || new Error(data?.message || "Löschen fehlgeschlagen");
      closeSettings();
      await db.auth.signOut({ scope: "local" }).catch(() => {});
      await stopApp();
      authStatus("Dein Account und alle zugehörigen Daten wurden gelöscht.", true);
    } catch {
      message.textContent = "Der Account konnte nicht gelöscht werden. Bitte versuche es erneut.";
      button.disabled = false;
    }
  }

  async function deleteAllUserData() {
    if (!currentUser?.id || !confirm("Wirklich ALLE Daten löschen? Bewerbungen, E-Mail-Automationen und Profildaten werden unwiderruflich entfernt. Dein Login bleibt bestehen.")) return;
    const button = $("#deleteAllDataBtn");
    button.disabled = true;
    try {
      const { data, error } = await db.functions.invoke("delete-account", { body: { action: "delete-data", confirmation: "ALLE DATEN LÖSCHEN" } });
      if (error || !data?.ok) throw error || new Error("Löschen fehlgeschlagen");
      state.apps = [];
      state.interviews = [];
      inboundSettings = null;
      inboundSuggestions = [];
      pendingDeletes.clear();
      closeSettings();
      render({ transition: true });
      updateInboundBadge();
      toast("Alle Daten wurden gelöscht");
    } catch {
      toast("Die Daten konnten nicht gelöscht werden");
    } finally {
      button.disabled = false;
    }
  }

  function applyPrivacyMode({ announce = false } = {}) {
    document.body.classList.toggle("privacy-mode", state.privacy);
    const button = $("#privacyBtn");
    button.classList.toggle("active", state.privacy);
    button.setAttribute("aria-pressed", String(state.privacy));
    button.setAttribute("aria-label", state.privacy ? "Privacy-Modus deaktivieren" : "Privacy-Modus aktivieren");
    button.title = state.privacy ? "Normale Ansicht wiederherstellen" : "Sichere Ansicht für Screenshots";
    if (currentUser) updateNavIdentity();
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
    applyPrivacyMode({ announce: true });
  }

  function handleAction(action) {
    const stamp = todayISO();
    switch (action) {
      case "add": openDrawer(null); break;
      case "export-csv":
        download(`bewerbungen-${stamp}.csv`, appsToCSV(state.apps), "text/csv;charset=utf-8");
        toast("CSV exportiert"); break;
      case "export-json":
        download(`bewerbungen-backup-${stamp}.json`, JSON.stringify(state.apps, (key, value) => key === "_syncedUpdated" ? undefined : value, 2), "application/json");
        toast("Backup gespeichert"); break;
      case "import": openImportDialog(); break;
      case "reset":
        if (confirm("Wirklich ALLE Bewerbungen löschen? Tipp: vorher ein Backup speichern.")) {
          state.apps.forEach((app) => {
            if (app._syncedUpdated) pendingDeletes.set(app.id, Number(app._syncedUpdated));
          });
          state.apps = []; persist(); render({ transition: true }); toast("Alle Daten gelöscht");
        }
        break;
      case "signout":
        db.auth.signOut();
        break;
    }
  }

  /* ---------- Events ---------- */
  $("#addBtn").addEventListener("click", () => state.view === "interviews" ? openInterviewDialog() : openDrawer(null));
  $("#workspaceSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-workspace-view]");
    if (button) setView(button.dataset.workspaceView);
  });
  $("#interviewList").addEventListener("click", (event) => {
    if (event.target.closest("[data-interview-add]")) return openInterviewDialog();
    const card = event.target.closest("[data-interview-id]");
    if (!card) return;
    const interview = state.interviews.find((item) => item.id === card.dataset.interviewId);
    if (!interview) return;
    if (event.target.closest("[data-interview-delete]")) return void deleteInterview(interview);
    if (event.target.closest("[data-interview-regenerate]")) return void createInterviewPrep(interview);
    if (event.target.closest("[data-interview-prep]")) {
      if (interview.ai_prep) { interview._expanded = !interview._expanded; renderInterviews(); }
      else void createInterviewPrep(interview);
    }
  });
  interviewForm.addEventListener("submit", saveInterview);
  interviewOverlay.addEventListener("click", closeInterviewDialog);
  $("#interviewCloseBtn").addEventListener("click", closeInterviewDialog);
  $("#interviewCancelBtn").addEventListener("click", closeInterviewDialog);
  $("#interviewCvUploadBtn").addEventListener("click", () => $("#quickCvInput").click());
  $("#settingsCvBtn").addEventListener("click", () => $("#quickCvInput").click());
  $("#quickCvInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file && await uploadCv(file)) $("#interviewCvNudge").hidden = true;
    event.target.value = "";
  });
  $("#magicImportBtn").addEventListener("click", () => openDrawer(null, { focusMagic: true }));
  $("#inboundBtn").addEventListener("click", openInboundDialog);
  $("#privacyBtn").addEventListener("click", togglePrivacyMode);
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#settingsCloseBtn").addEventListener("click", closeSettings);
  settingsOverlay.addEventListener("click", closeSettings);
  $("#accountSettingsForm").addEventListener("submit", saveAccountSettings);
  $("#settingsBackupBtn").addEventListener("click", () => handleAction("export-json"));
  $("#settingsCsvBtn").addEventListener("click", () => handleAction("export-csv"));
  $("#settingsImportBtn").addEventListener("click", () => { closeSettings(); openImportDialog(); });
  $("#openPremiumStatsBtn").addEventListener("click", () => { closeSettings(); setView("insights"); });
  $("#settingsSignoutBtn").addEventListener("click", () => { closeSettings(); db.auth.signOut(); });
  $("#deleteAllDataBtn").addEventListener("click", deleteAllUserData);
  $("#revealDeleteAccountBtn").addEventListener("click", () => {
    deleteAccountConfirm.hidden = !deleteAccountConfirm.hidden;
    if (!deleteAccountConfirm.hidden) deleteAccountInput.focus();
  });
  deleteAccountInput.addEventListener("input", () => {
    $("#confirmDeleteAccountBtn").disabled = deleteAccountInput.value.trim() !== "LÖSCHEN";
    $("#deleteAccountMessage").textContent = "";
  });
  $("#confirmDeleteAccountBtn").addEventListener("click", deleteOwnAccount);
  $("#aiBrief").addEventListener("click", (event) => {
    const dot = event.target.closest("[data-ai-slide]");
    if (dot) return showAiBriefSlide(Number(dot.dataset.aiSlide));
    const check = event.target.closest("[data-ai-complete]");
    if (check) return completeAiTask(check.dataset.aiComplete, check.closest(".ai-brief-item"));
    const button = event.target.closest("[data-ai-action]");
    if (!button) return;
    const action = button.dataset.aiAction;
    const application = button.dataset.aiAppId && state.apps.find((app) => app.id === button.dataset.aiAppId);
    if (action === "add") return openDrawer(null);
    if (action === "magic") return openDrawer(null, { focusMagic: true });
    if (action === "stats") return setView("insights");
    if (action === "settings") return openSettings();
    if (application) {
      openDrawer(application);
      if (action === "followup") {
        setFollowupExpanded(true);
        requestAnimationFrame(() => $(".followup-block")?.scrollIntoView({ behavior: "smooth", block: "start" }));
      }
    }
  });
  $("#aiBrief").addEventListener("pointerenter", stopAiBriefCarousel);
  $("#aiBrief").addEventListener("pointerleave", scheduleAiBriefCarousel);
  $("#aiBrief").addEventListener("focusin", stopAiBriefCarousel);
  $("#aiBrief").addEventListener("focusout", (event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) scheduleAiBriefCarousel();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAiBriefCarousel();
    else scheduleAiBriefCarousel();
  });

  inboundOverlay.addEventListener("click", closeInboundDialog);
  inboundDialog.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-inbound]")) return closeInboundDialog();
    const card = event.target.closest("[data-suggestion-id]");
    if (!card) return;
    if (event.target.closest("[data-accept-inbound]")) reviewInboundSuggestion(card, true);
    else if (event.target.closest("[data-reject-inbound]")) reviewInboundSuggestion(card, false);
  });
  $("#refreshInboundBtn").addEventListener("click", () => refreshInbound());
  toggleInboundBtn.addEventListener("click", toggleInbound);
  editInboundAliasBtn.addEventListener("click", openInboundAliasEditor);
  cancelInboundAliasBtn.addEventListener("click", closeInboundAliasEditor);
  saveInboundAliasBtn.addEventListener("click", saveInboundAlias);
  inboundAliasInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); saveInboundAlias(); }
    if (event.key === "Escape") { event.preventDefault(); closeInboundAliasEditor(); }
  });
  copyInboundAddressBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(inboundAddress.value);
      toast("Weiterleitungsadresse kopiert");
    } catch { toast("Adresse konnte nicht kopiert werden"); }
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
  $("#layoutSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-layout]");
    if (!button || button.dataset.layout === state.monthLayout) return;
    state.monthLayout = button.dataset.layout === "list" ? "list" : "tiles";
    try { localStorage.setItem(MONTH_LAYOUT_KEY, state.monthLayout); } catch {}
    const update = () => renderList();
    if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) document.startViewTransition(update);
    else update();
  });

  els.list.addEventListener("click", (e) => {
    const monthShare = e.target.closest("[data-share-month]");
    if (monthShare) return shareCardForMonth(monthShare.dataset.shareMonth);
    const monthExport = e.target.closest("[data-export-month]");
    if (monthExport) return exportMonth(monthExport.dataset.exportMonth);
    const head = e.target.closest(".month-head");
    if (head) return toggleMonth(head.closest(".month"));
    const card = e.target.closest(".card");
    if (!card) return;
    const app = state.apps.find((a) => a.id === card.dataset.id);
    if (app) openDrawer(app);
  });

  $("#homeBtn").addEventListener("click", () => {
    if (state.view !== "list") setView("list");
    window.scrollTo({ top: 0, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  });
  const appNavbar = $("#appNavbar");
  let navbarCompact = false;
  const updateNavbarShape = () => {
    if (!navbarCompact && window.scrollY > 90) navbarCompact = true;
    else if (navbarCompact && window.scrollY < 24) navbarCompact = false;
    appNavbar.classList.toggle("scrolled", navbarCompact);
  };
  window.addEventListener("scroll", updateNavbarShape, { passive: true });
  updateNavbarShape();

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
      timelineDateMode = st.dataset.status === "absage" ? "outcome" : "phase";
      renderStatusPicker(); renderPhase();
      return;
    }
    const outcome = e.target.closest("[data-outcome-step]");
    if (outcome) {
      timelineDateMode = "outcome";
      renderPhase();
      phaseDate.focus();
      return;
    }
    const followup = e.target.closest("[data-followup-step]");
    if (followup) {
      timelineDateMode = "followup";
      renderPhase();
      phaseDate.focus();
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
    if (timelineDateMode === "followup" && state.draft.followUpDoneAt) {
      state.draft.followUpDoneAt = phaseDate.value;
      if (!phaseDate.value) timelineDateMode = "phase";
      renderFollowUpControls();
      renderAiBrief();
    } else if (timelineDateMode === "outcome" && state.draft.status === "absage") {
      form.absageAm.value = phaseDate.value;
      state.draft.absageAm = phaseDate.value;
    } else if (phaseDate.value) state.draft.phaseDates[state.draft.phase] = phaseDate.value;
    else delete state.draft.phaseDates[state.draft.phase];
    renderPhase();
    renderEmailComposer(!emailTextCustomized);
  });
  form.absageAm.addEventListener("change", () => {
    state.draft.absageAm = form.absageAm.value;
    renderPhase();
  });
  form.datum.addEventListener("change", () => { renderPhase(); renderEmailComposer(!emailTextCustomized); });
  form.firma.addEventListener("input", () => { renderDrawerHead(); renderEmailComposer(!emailTextCustomized); });
  form.stelle.addEventListener("input", () => { renderDrawerHead(); renderEmailComposer(!emailTextCustomized); });
  form.contactName.addEventListener("input", () => renderEmailComposer(!emailTextCustomized));
  form.contactEmail.addEventListener("input", () => renderEmailComposer(false));
  emailTemplateTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-email-template]");
    if (!tab) return;
    emailTemplateId = tab.dataset.emailTemplate;
    emailTextCustomized = false;
    renderEmailComposer(true);
  });
  emailLanguagePicker.addEventListener("click", (event) => {
    const button = event.target.closest("[data-email-language]");
    if (!button || button.dataset.emailLanguage === emailLanguage) return;
    emailLanguage = button.dataset.emailLanguage;
    emailTextCustomized = false;
    renderEmailComposer(true);
  });
  emailSubject.addEventListener("input", () => { emailTextCustomized = true; });
  emailBody.addEventListener("input", () => { emailTextCustomized = true; });
  $("#copyEmailBtn").addEventListener("click", copyEmailDraft);
  $("#openEmailBtn").addEventListener("click", openEmailDraft);
  markEmailSentBtn.addEventListener("click", () => markFollowUpDone({ sent: true }));
  runMagicImportBtn.addEventListener("click", runMagicImport);
  jobImportUrl.addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); runMagicImport(); }
  });
  jobImportUrl.addEventListener("paste", () => {
    setTimeout(() => { if (normalizedWebUrl(jobImportUrl.value)) runMagicImport(); }, 80);
  });
  $("#pasteJobUrlBtn").addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!normalizedWebUrl(text)) throw new Error("In der Zwischenablage ist kein gültiger Link.");
      jobImportUrl.value = text.trim();
      runMagicImport();
    } catch (error) {
      setMagicStatus(error.message === "In der Zwischenablage ist kein gültiger Link."
        ? error.message
        : "Zwischenablage konnte nicht gelesen werden. Füge den Link direkt ein.", "error");
    }
  });
  form.nextAction.addEventListener("input", () => {
    if (state.draft.followUpDoneAt) {
      state.draft.followUpDoneAt = "";
      timelineDateMode = "phase";
      renderPhase();
      renderAiBrief();
    }
    renderFollowUpControls();
  });
  form.followUpAt.addEventListener("change", () => {
    state.draft.followUpDoneAt = "";
    timelineDateMode = "phase";
    renderFollowUpControls();
    renderPhase();
    renderAiBrief();
  });
  snoozeFollowUpBtn.addEventListener("click", () => {
    form.followUpAt.value = addDaysISO(todayISO(), 7);
    state.draft.followUpDoneAt = "";
    timelineDateMode = "phase";
    renderFollowUpControls();
    renderPhase();
    renderAiBrief();
    toast("Nachfassen auf in 7 Tagen gesetzt");
  });
  completeFollowUpBtn.addEventListener("click", () => {
    if (state.draft.followUpDoneAt) {
      state.draft.followUpDoneAt = "";
      timelineDateMode = "phase";
      renderFollowUpControls();
      renderPhase();
      renderAiBrief();
      return;
    }
    markFollowUpDone();
  });
  followupToggle.addEventListener("click", () => setFollowupExpanded(!followupBlock.classList.contains("expanded")));
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
    const interviewOpen = interviewDialog.classList.contains("open");
    const importOpen = importDialog.classList.contains("open");
    const shareOpen = sharePreview.classList.contains("open");
    const inboundOpen = inboundDialog.classList.contains("open");
    if (e.key === "Escape") { if (interviewOpen) closeInterviewDialog(); else if (settingsOpen) closeSettings(); else if (inboundOpen) closeInboundDialog(); else if (shareOpen) closeSharePreview(); else if (importOpen) closeImportDialog(); else if (open) closeDrawer(); return; }
    if (importOpen || inboundOpen) return;
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
  const authMessage = $("#authMessage"), authSubmit = $("#authSubmit");
  const loginTab = $("#loginTab"), signupTab = $("#signupTab"), googleAuthBtn = $("#googleAuthBtn");
  const authPassword = $("#authPassword"), authPasswordToggle = $("#authPasswordToggle");
  const onboardingShell = $("#onboardingShell"), onboardingForm = $("#onboardingForm");
  const onboardingBack = $("#onboardingBack"), onboardingNext = $("#onboardingNext");
  const onboardingSkip = $("#onboardingSkip"), onboardingGoal = $("#onboardingGoal");
  let authMode = "login";
  let onboardingStep = 0;
  let employmentStatus = null;
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
    return "Anmeldung fehlgeschlagen. Bitte versuche es erneut.";
  }

  function setAuthBusy(busy) {
    authSubmit.disabled = busy;
    googleAuthBtn.disabled = busy;
    loginTab.disabled = busy;
    signupTab.disabled = busy;
  }

  function resetPasswordVisibility() {
    authPassword.type = "password";
    authPasswordToggle.classList.remove("showing");
    authPasswordToggle.setAttribute("aria-label", "Passwort anzeigen");
  }

  function setAuthMode(mode) {
    authMode = mode === "signup" ? "signup" : "login";
    const signup = authMode === "signup";
    loginTab.classList.toggle("active", !signup);
    signupTab.classList.toggle("active", signup);
    loginTab.setAttribute("aria-selected", String(!signup));
    signupTab.setAttribute("aria-selected", String(signup));
    $("#authTitle").textContent = signup ? "Deine Jobsuche beginnt hier." : "Schön, dich wiederzusehen.";
    $("#authSubtitle").textContent = signup
      ? "Erstelle dein Konto und bring Struktur in deine Jobsuche."
      : "Melde dich an und mach dort weiter, wo du aufgehört hast.";
    authSubmit.querySelector("span").textContent = signup ? "Kostenlos registrieren" : "Anmelden";
    googleAuthBtn.querySelector("span").textContent = signup ? "Mit Google registrieren" : "Mit Google anmelden";
    $("#authTerms").textContent = signup
      ? "Mit der Registrierung stimmst du einer sicheren Verarbeitung deiner Daten zu."
      : "Mit der Anmeldung stimmst du einer sicheren Verarbeitung deiner Daten zu.";
    authPassword.autocomplete = signup ? "new-password" : "current-password";
    authPassword.value = "";
    resetPasswordVisibility();
    authStatus("");
  }

  async function loadCloudData(expectedEpoch, expectedUserId, signal) {
    setSyncState("syncing", "Lädt…");
    const { data, error } = await db.from("applications")
      .select("*")
      .eq("user_id", expectedUserId)
      .order("datum", { ascending: false, nullsFirst: false })
      .abortSignal(signal);
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return null;
    if (error) throw error;
    return (data || []).map(fromRow);
  }

  async function loadUserProfile(expectedEpoch, expectedUserId, signal) {
    const { data, error } = await db.from("user_profiles")
      .select("display_name,target_role,employment_status,monthly_application_goal,onboarding_completed_at,ai_completed_tasks,cv_path,cv_name,cv_uploaded_at")
      .eq("user_id", expectedUserId)
      .maybeSingle()
      .abortSignal(signal);
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return null;
    if (error) throw error;
    return data || null;
  }

  async function loadInterviews(expectedEpoch, expectedUserId, signal) {
    const { data, error } = await db.from("interviews")
      .select("id,user_id,application_id,scheduled_at,stage,format,interviewer,meeting_url,notes,ai_prep,ai_prepared_at,created_at,updated_at")
      .eq("user_id", expectedUserId)
      .order("scheduled_at", { ascending: true })
      .abortSignal(signal);
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return null;
    if (error) {
      if (error.code === "42P01") return [];
      throw error;
    }
    return data || [];
  }

  function setOnboardingStep(step) {
    onboardingStep = Math.max(0, Math.min(3, step));
    $$('[data-onboarding-step]').forEach((panel) => {
      const active = Number(panel.dataset.onboardingStep) === onboardingStep;
      panel.hidden = !active;
      panel.classList.toggle("active", active);
    });
    $$('[data-onboarding-indicator]').forEach((indicator) => {
      const index = Number(indicator.dataset.onboardingIndicator);
      indicator.classList.toggle("active", index === onboardingStep);
      indicator.classList.toggle("done", index < onboardingStep);
    });
    onboardingBack.hidden = onboardingStep === 0;
    onboardingNext.querySelector("span").textContent = onboardingStep === 3 ? "Setup abschließen" : "Weiter";
    $("#onboardingMessage").textContent = "";
  }

  function updateOnboardingGoal(value) {
    const safeValue = Math.max(1, Math.min(50, Number(value) || 10));
    onboardingGoal.value = String(safeValue);
    $("#onboardingGoalOutput").querySelector("strong").textContent = String(safeValue);
    $$('[data-goal]').forEach((button) => button.classList.toggle("active", Number(button.dataset.goal) === safeValue));
  }

  function showOnboarding() {
    onboardingForm.reset();
    $("#onboardingCvLabel").textContent = "Lebenslauf auswählen";
    employmentStatus = null;
    $$('[data-employment]').forEach((button) => button.classList.remove("selected"));
    updateOnboardingGoal(10);
    setOnboardingStep(0);
    authShell.hidden = true;
    mainApp.hidden = true;
    onboardingShell.hidden = false;
  }

  function onboardingRequested(user) {
    let googleIntent = false;
    try { googleIntent = sessionStorage.getItem("jobply_google_onboarding") === "1"; } catch {}
    const createdAt = Date.parse(user?.created_at || "");
    const createdAfterRelease = Number.isFinite(createdAt) && createdAt >= ONBOARDING_RELEASE_AT;
    return user?.user_metadata?.onboarding_required === true || googleIntent || createdAfterRelease;
  }

  async function needsOnboarding(user, expectedEpoch, signal) {
    if (!onboardingRequested(user)) return false;
    const { data, error } = await db.from("user_profiles")
      .select("onboarding_completed_at")
      .eq("user_id", user.id)
      .maybeSingle()
      .abortSignal(signal);
    if (!isActiveAuthContext(expectedEpoch, user.id)) return false;
    if (error) throw error;
    return !data?.onboarding_completed_at;
  }

  function revealMainApp() {
    onboardingShell.hidden = true;
    let view = "list";
    try { const saved = localStorage.getItem(VIEW_KEY); view = ["list", "interviews", "insights"].includes(saved) ? saved : "list"; } catch {}
    if (location.hash === "#statistiken") view = "insights";
    if (location.hash === "#gespraeche") view = "interviews";
    setView(view);
    document.body.classList.toggle("privacy-mode", state.privacy);
    const privacyButton = $("#privacyBtn");
    privacyButton.classList.toggle("active", state.privacy);
    privacyButton.setAttribute("aria-pressed", String(state.privacy));
    privacyButton.setAttribute("aria-label", state.privacy ? "Privacy-Modus deaktivieren" : "Privacy-Modus aktivieren");
    privacyButton.title = state.privacy ? "Normale Ansicht wiederherstellen" : "Sichere Ansicht für Screenshots";
    mainApp.hidden = false;
    render();
    refreshInbound({ quiet: true });
  }

  async function completeOnboarding(skipped = false) {
    if (!currentUser?.id) return;
    onboardingNext.disabled = true;
    onboardingSkip.disabled = true;
    $("#onboardingMessage").textContent = skipped ? "Wird übersprungen…" : "Dein Setup wird gespeichert…";
    const profile = {
      user_id: currentUser.id,
      display_name: skipped ? null : ($("#onboardingName").value.trim().slice(0, 80) || null),
      target_role: skipped ? null : ($("#onboardingRole").value.trim().slice(0, 120) || null),
      employment_status: skipped ? null : employmentStatus,
      monthly_application_goal: skipped ? null : Number(onboardingGoal.value),
      onboarding_completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    try {
      const cvFile = skipped ? null : $("#onboardingCv").files?.[0];
      if (cvFile && !await uploadCv(cvFile, { onboarding: true })) throw new Error("cv_upload_failed");
      const { error } = await db.from("user_profiles").upsert(profile, { onConflict: "user_id" });
      if (error) throw error;
      userProfile = { ...(userProfile || {}), ...profile };
      try {
        const { data } = await db.auth.updateUser({ data: { onboarding_required: false } });
        if (data?.user) currentUser = data.user;
      } catch {}
      try { sessionStorage.removeItem("jobply_google_onboarding"); } catch {}
      revealMainApp();
    } catch {
      $("#onboardingMessage").textContent = "Das Setup konnte nicht gespeichert werden. Bitte versuche es erneut.";
    } finally {
      onboardingNext.disabled = false;
      onboardingSkip.disabled = false;
    }
  }

  async function startApp(session) {
    const expectedUserId = session?.user?.id;
    if (!expectedUserId) return;
    if (appStarted && currentUser?.id === expectedUserId) {
      currentUser = session.user;
      updateNavIdentity();
      return;
    }

    const expectedEpoch = invalidateAuthWork();
    const signal = authAbortController.signal;
    closeDrawer(true);
    closeInterviewDialog();
    closeImportDialog();
    closeSharePreview();
    closeInboundDialog();
    inboundAliasEditor.hidden = true;
    appStarted = true;
    currentUser = session.user;
    // Credentials must never survive in hidden login controls after a
    // successful authentication or an account switch.
    authForm.reset();
    resetPasswordVisibility();
    state.apps = [];
    state.interviews = [];
    inboundSettings = null;
    inboundSuggestions = [];
    updateInboundBadge();
    updateNavIdentity();
    authShell.hidden = true;
    onboardingShell.hidden = true;
    mainApp.hidden = true;
    try {
      const applications = await loadCloudData(expectedEpoch, expectedUserId, signal);
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || applications === null) return;
      state.apps = applications;
      setSyncState("", "Gespeichert");
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      state.apps = [];
      setSyncState("error", "Einrichtung nötig");
      setTimeout(() => toast(error.code === "42P01" ? "Bitte zuerst das Supabase SQL-Skript ausführen" : "Cloud-Daten konnten nicht geladen werden"), 500);
    }
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    try {
      const interviews = await loadInterviews(expectedEpoch, expectedUserId, signal);
      if (!isActiveAuthContext(expectedEpoch, expectedUserId) || interviews === null) return;
      state.interviews = interviews;
    } catch { state.interviews = []; }
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    try {
      userProfile = await loadUserProfile(expectedEpoch, expectedUserId, signal);
    } catch {
      userProfile = null;
    }
    if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
    try {
      if (await needsOnboarding(currentUser, expectedEpoch, signal)) return showOnboarding();
    } catch (error) {
      if (!isActiveAuthContext(expectedEpoch, expectedUserId)) return;
      setTimeout(() => toast(error.code === "42P01" ? "Onboarding-Datenbank muss noch eingerichtet werden" : "Onboarding konnte nicht geladen werden"), 400);
    }
    revealMainApp();
  }

  function scrubSensitiveClientState() {
    stopAiBriefCarousel();
    state.apps = [];
    state.interviews = [];
    userProfile = null;
    state.draft = null;
    state.draftOriginal = "";
    state.isNew = false;
    state.query = "";
    inboundSettings = null;
    inboundSuggestions = [];
    pendingImport = null;
    pendingShareCard = null;
    employmentStatus = null;

    // Reset values first, then remove all rendered user-controlled content.
    // The structural dialog markup stays intact so another account can log in
    // without requiring a page reload.
    document.querySelectorAll("form").forEach((element) => element.reset());
    document.querySelectorAll("input, textarea").forEach((element) => {
      if (element.type !== "button" && element.type !== "submit") element.value = "";
    });

    [els.stats, els.dist, els.filters, els.list, $("#aiBrief"), $("#viewInsights"), linksList,
      $("#interviewOverview"), $("#interviewList"), notesList, inboundSuggestionsList, importResult, $("#toasts")]
      .forEach((element) => element?.replaceChildren());
    statsBuilt = false;

    sharePreviewImage.removeAttribute("src");
    importResult.hidden = true;
    inboundAliasEditor.hidden = true;
    tip.hidden = true;
    tip.textContent = "";
    $("#userEmail").textContent = "";
    $("#settingsAccountMessage").textContent = "";
    $("#deleteAccountMessage").textContent = "";
    deleteAccountConfirm.hidden = true;
    $("#drawerTitle").textContent = "";
    $("#drawerMeta").textContent = "";
    $("#drawerAvatar").textContent = "?";
    emailRecipient.textContent = "";
    inboundStatusText.textContent = "";
    inboundDomainSuffix.textContent = "";
    setMagicStatus("");
    updateInboundBadge();
  }

  async function stopApp() {
    invalidateAuthWork();
    closeSettings();
    closeDrawer(true);
    closeInterviewDialog();
    closeImportDialog();
    closeSharePreview();
    closeInboundDialog();
    currentUser = null;
    scrubSensitiveClientState();
    mainApp.hidden = true;
    onboardingShell.hidden = true;
    authShell.hidden = false;
    setAuthMode("login");
    setAuthBusy(false);
    appStarted = false;
  }

  async function authenticate() {
    if (!db) return authStatus("Supabase konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.");
    const email = $("#authEmail").value.trim();
    const password = authPassword.value;
    if (!email || password.length < 6) return authStatus("Bitte E-Mail und mindestens 6 Passwort-Zeichen eingeben.");
    const createAccount = authMode === "signup";
    authStatus(createAccount ? "Konto wird erstellt…" : "Anmeldung läuft…", true);
    setAuthBusy(true);
    try {
      const result = createAccount
        ? await db.auth.signUp({ email, password, options: { data: { onboarding_required: true } } })
        : await db.auth.signInWithPassword({ email, password });
      // Credentials must not remain in the DOM after either success or failure.
      authPassword.value = "";
      resetPasswordVisibility();
      if (result.error) return authStatus(friendlyAuthError(result.error));
      if (result.data.session) await startApp(result.data.session);
      else if (createAccount) authStatus("Konto erstellt. Bitte öffne den Bestätigungslink in deiner E-Mail.", true);
    } catch {
      authPassword.value = "";
      resetPasswordVisibility();
      authStatus("Die Verbindung ist fehlgeschlagen. Bitte versuche es erneut.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function authenticateWithGoogle() {
    if (!db) return authStatus("Supabase konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.");
    authStatus("Google-Anmeldung wird geöffnet…", true);
    setAuthBusy(true);
    const redirectTo = `${location.origin}${location.pathname}`;
    try { sessionStorage.setItem("jobply_google_onboarding", authMode === "signup" ? "1" : "0"); } catch {}
    try {
      const { error } = await db.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo, queryParams: { prompt: "select_account" } }
      });
      if (error) {
        try { sessionStorage.removeItem("jobply_google_onboarding"); } catch {}
        setAuthBusy(false);
        authStatus("Google-Anmeldung konnte nicht gestartet werden. Bitte versuche es erneut.");
      }
    } catch {
      try { sessionStorage.removeItem("jobply_google_onboarding"); } catch {}
      setAuthBusy(false);
      authStatus("Google-Anmeldung konnte nicht gestartet werden. Bitte versuche es erneut.");
    }
  }

  authForm.addEventListener("submit", (event) => { event.preventDefault(); void authenticate(); });
  loginTab.addEventListener("click", () => setAuthMode("login"));
  signupTab.addEventListener("click", () => setAuthMode("signup"));
  googleAuthBtn.addEventListener("click", () => void authenticateWithGoogle());
  authPasswordToggle.addEventListener("click", () => {
    const show = authPassword.type === "password";
    authPassword.type = show ? "text" : "password";
    authPasswordToggle.classList.toggle("showing", show);
    authPasswordToggle.setAttribute("aria-label", show ? "Passwort ausblenden" : "Passwort anzeigen");
  });
  onboardingNext.addEventListener("click", () => {
    if (onboardingStep < 3) setOnboardingStep(onboardingStep + 1);
    else void completeOnboarding(false);
  });
  onboardingBack.addEventListener("click", () => setOnboardingStep(onboardingStep - 1));
  onboardingSkip.addEventListener("click", () => void completeOnboarding(true));
  $("#employmentOptions").addEventListener("click", (event) => {
    const button = event.target.closest("[data-employment]");
    if (!button) return;
    employmentStatus = button.dataset.employment;
    $$('[data-employment]').forEach((option) => option.classList.toggle("selected", option === button));
  });
  onboardingGoal.addEventListener("input", () => updateOnboardingGoal(onboardingGoal.value));
  $("#onboardingCv").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    $("#onboardingCvLabel").textContent = file?.name || "Lebenslauf auswählen";
  });
  $$('.onboarding-presets [data-goal]').forEach((button) => button.addEventListener("click", () => updateOnboardingGoal(button.dataset.goal)));
  setAuthMode("login");

  async function boot() {
    if (!db) return authStatus("Supabase konnte nicht geladen werden. Bitte Seite neu laden.");
    const { data } = await db.auth.getSession();
    if (data.session) await startApp(data.session);
    db.auth.onAuthStateChange((event, session) => {
      setTimeout(() => {
        if (session) void startApp(session);
        else void stopApp();
      }, 0);
    });
  }
  boot();
})();
