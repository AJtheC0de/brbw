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

Die Daten werden nach der Anmeldung in Supabase gespeichert und zusätzlich lokal
zwischengespeichert. Beim ersten Öffnen werden die Einträge aus `data/bewerbungen.csv`
einmalig in das persönliche Konto übernommen.

## Supabase einrichten

1. Im Supabase-Dashboard den SQL Editor öffnen.
2. Den Inhalt von `supabase/setup.sql` ausführen.
3. Unter Authentication → Providers sicherstellen, dass E-Mail aktiviert ist.
4. In der App ein Konto erstellen und die E-Mail bestätigen.

Die Row-Level-Security-Regeln erlauben jedem angemeldeten Benutzer ausschliesslich den
Zugriff auf die eigenen Bewerbungen. Der `service_role`-Key wird nicht verwendet.

Tastatur: `N` neue Bewerbung · `/` Suche · `Esc` schliessen · `⌘/Ctrl + S` speichern

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
