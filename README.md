# Bewerbungs-Tracker

Statische Web-App (HTML/CSS/JS) zum Tracken von Bewerbungen – gehostet über GitHub Pages.

- Bewerbungen erfassen, bearbeiten, löschen (mit Rückgängig)
- Verlauf: Beworben → 1. Gespräch → 2. Gespräch → Finale Runde (mit Datum)
- Ergebnis: Offen, Angebot, Absage, Keine Antwort, Zurückgezogen
- Monatsübersicht zum Aufklappen
- Links zu Bestätigungen, Einladungen, Absagen, Inseraten
- Notizen mit Datum (Timeline)
- Suche, Filter, Sortierung, Statistik
- Import/Export als CSV und JSON-Backup

Die Daten werden im Browser (localStorage) gespeichert. Beim ersten Öffnen werden die
Einträge aus `data/bewerbungen.csv` geladen. Regelmässig über das Menü ein Backup speichern.

Tastatur: `N` neue Bewerbung · `/` Suche · `Esc` schliessen · `⌘/Ctrl + S` speichern
