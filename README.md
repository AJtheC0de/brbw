# Bewerbungs-Tracker

Web-App (HTML/CSS/JS) zum Tracken von Bewerbungen mit geschützter Supabase-Synchronisation.

- Bewerbungen erfassen, bearbeiten, löschen (mit Rückgängig)
- Verlauf: Beworben → 1. Gespräch → 2. Gespräch → Finale Runde (mit Datum)
- Ergebnis: Offen, Angebot, Absage, Keine Antwort, Zurückgezogen
- Monatsübersicht zum Aufklappen
- Links zu Bestätigungen, Einladungen, Absagen, Inseraten
- Notizen mit Datum (Timeline)
- Suche, Filter, Sortierung, Statistik
- Import/Export als CSV und JSON-Backup, inklusive CSV-Export einzelner Monate
- Smart Magic Import: Job-URL einfügen und Firma, Rolle, Beschreibung sowie Stellendetails mit OpenAI übernehmen

Die Daten werden nach der Anmeldung in Supabase gespeichert und zusätzlich lokal
zwischengespeichert. Beim ersten Öffnen werden die Einträge aus `data/bewerbungen.csv`
einmalig in das persönliche Konto übernommen.

## Supabase einrichten

1. Im Supabase-Dashboard den SQL Editor öffnen.
2. Den Inhalt von `supabase/setup.sql` ausführen.
3. Unter Authentication → Providers sicherstellen, dass E-Mail aktiviert ist.
4. In der App ein Konto erstellen und die E-Mail bestätigen.

Für ein bereits eingerichtetes Projekt kann `supabase/setup.sql` erneut ausgeführt werden.
Das Skript ergänzt die Phase-1-Felder und Tabellen idempotent, ohne bestehende Bewerbungen zu löschen.

Die Row-Level-Security-Regeln erlauben jedem angemeldeten Benutzer ausschliesslich den
Zugriff auf die eigenen Bewerbungen. Der `service_role`-Key wird nicht verwendet.

Tastatur: `N` neue Bewerbung · `/` Suche · `Esc` schliessen · `⌘/Ctrl + S` speichern

## Automatisierungs-Grundlage (Phase 1)

Die Datenbank ist für die geplanten Funktionen vorbereitet:

- zusätzliche Stellen-, Kontakt- und Follow-up-Felder an Bewerbungen
- getrennt gespeicherte KI-Artefakte mit Eingabe-Hash und Modellangabe
- bestätigungspflichtige Automatisierungsvorschläge statt stiller Statusänderungen
- unerratbare, standardmässig deaktivierte Inbound-Mail-Aliasse
- datensparsame Ausführungsprotokolle ohne rohe E-Mails oder API-Schlüssel
- benutzerspezifisches Rate-Limiting für Edge Functions
- serverseitige Authentifizierung, CORS-Allowlist und URL-/SSRF-Schutz

`foundation-health` ist ein authentifizierter Diagnose-Endpunkt. Lokal:

```sh
supabase start
supabase functions serve foundation-health
```

Vor dem Deployment sollten zusätzliche Produktionsdomains als kommagetrennte
Variable `ALLOWED_ORIGINS` in den Supabase Edge Function Secrets hinterlegt werden.
KI- oder E-Mail-API-Schlüssel gehören ebenfalls ausschliesslich dorthin und niemals
in `app.js`, Git oder Browser-Storage. Die Publishable Supabase-ID im Frontend ist
kein geheimer Schlüssel; der Service-Role-Key wird weiterhin nicht im Browser benutzt.

Für den Magic Import werden in Supabase unter Edge Functions → Secrets gesetzt:

- `OPENAI_API_KEY`: geheimer OpenAI API-Key
- `OPENAI_MODEL` (optional): standardmässig `gpt-6-luna`

Danach muss die Edge Function `magic-import` veröffentlicht werden. Sie lädt nur öffentliche
HTTP(S)-Stellenanzeigen, blockiert private Netzwerke, begrenzt Grösse und Laufzeit und nutzt
Structured Outputs der OpenAI Responses API. Der API-Key wird nie an den Browser ausgeliefert.

## Importformat

Der Import akzeptiert CSV-Dateien (Komma oder Semikolon als Trennzeichen) und JSON-Backups aus der App.
In einer CSV ist nur die Spalte `Firma` verpflichtend. Unterstützt werden zusätzlich:

- `Bewerbung / Eingang`: `TT.MM.JJJJ` oder `JJJJ-MM-TT`
- `Stelle`: freier Jobtitel
- `Status`: `Offen`, `Angebot`, `Absage`, `Keine Antwort` oder `Zurückgezogen`
- `Verlauf`: `Beworben`, `1. Gespräch`, `2. Gespräch` oder `Finale Runde`
- `Absage am` / `Entscheid`: `TT.MM.JJJJ` oder `JJJJ-MM-TT`
- `Nachweis Eingang` und `Nachweis Outcome`: Links, mehrere durch Leerzeichen getrennt
- `Bemerkung`: Freitext, mehrere Notizen durch ` | ` getrennt

Ungültige CSV-Zeilen werden vor dem Import angezeigt und übersprungen. Einträge mit derselben Firma,
Stelle und demselben Bewerbungsdatum gelten als Duplikate. Die aktuelle CSV-Vorlage kann direkt im
Import-Dialog heruntergeladen werden.
