# Datenschutz im Betrieb – Checkliste vor dem Launch

Der Code setzt Datensparsamkeit, Einwilligungen und Löschfristen technisch um.
Die folgenden Punkte liegen ausserhalb des Repositorys und müssen einmalig
erledigt und belegt werden. Die Nachweise (PDF/Screenshot mit Datum) gehören in
einen privaten Ordner, nicht ins Repository.

## 1. Rechtstexte ausfüllen

- [ ] Alle gelb markierten Platzhalter `[…]` in `datenschutz.html` und `impressum.html` ersetzen.
- [ ] Datum „gültig ab“ setzen. Bei späteren inhaltlichen Änderungen `PRIVACY_POLICY_VERSION` in `app.js` und die Version in `datenschutz.html` erhöhen.
- [ ] Für kostenpflichtige Pläne: AGB/Nutzungsbedingungen ergänzen (Leistung, Preis, Kündigung, Haftung).
- [ ] Texte einmal von einer Fachperson (Datenschutz-/Anwaltskanzlei) prüfen lassen.

## 2. Auftragsbearbeitungsverträge (DPA)

| Anbieter | Wo | Erledigt |
|---|---|---|
| Supabase | Dashboard → Organization → Legal Documents → DPA | [ ] |
| Vercel | vercel.com/legal/dpa (im Account akzeptieren) | [ ] |
| OpenAI | platform.openai.com → Settings → Organization → Data Processing Addendum | [ ] |
| Resend | resend.com/legal/dpa | [ ] |
| Google (OAuth) | Google Cloud Console: Consent-Screen mit Link zur Datenschutzerklärung | [ ] |

Für jeden US-Anbieter festhalten: DPF-zertifiziert (dataprivacyframework.gov) **oder**
Standardvertragsklauseln mit Schweizer Anpassung. Ergebnis in Abschnitt 6 der
Datenschutzerklärung eintragen.

## 3. Regionen und Speicherung

- [ ] **Supabase:** Projektregion prüfen (Settings → General). Empfehlung: `eu-central-1` (Frankfurt) oder `eu-central-2` (Zürich). Ein Wechsel erfordert ein neues Projekt mit Datenmigration.
- [ ] **Supabase Backups:** Aufbewahrung laut Plan notieren (Datenschutzerklärung Abschnitt 7).
- [ ] **OpenAI:** Zero Data Retention beantragen (Account-Team/Support) und, falls verfügbar, EU-Datenresidenz für das Projekt aktivieren. Training-Opt-in muss **aus** sein.
- [ ] **Resend:** Aufbewahrung empfangener E-Mails prüfen und so kurz wie möglich setzen; gespeicherte Inbound-Mails regelmässig im Dashboard löschen. Die API bietet derzeit keinen dokumentierten Lösch-Endpunkt; bei Accountlöschungen auf Anfrage manuell löschen.
- [ ] **Vercel:** Log-Aufbewahrung des Plans notieren.

## 4. Supabase-Sicherheitseinstellungen (Dashboard → Authentication)

- [ ] Minimum password length: **10** (entspricht der App). Password requirements: Buchstaben + Ziffern.
- [ ] **Leaked password protection** aktivieren (HaveIBeenPwned-Abgleich).
- [ ] E-Mail-Bestätigung bei Registrierung aktiv.
- [ ] Rate limits für Auth-E-Mails prüfen.
- [ ] Site URL und Redirect-URLs auf die Produktionsdomain beschränken.

## 5. Datenbank

- [ ] Migration `202610290001_privacy_consent_retention.sql` ausführen **bevor** das neue Frontend live geht (die App liest die neuen Profilspalten).
- [ ] Prüfen, dass der Cron-Job läuft: `select * from cron.job where jobname = 'jobply-retention';`
- [ ] Policies im Produktivsystem mit dem Repo abgleichen: Dashboard → Advisors → Security Advisor ohne Befunde.
- [ ] Edge Functions `interview-prep`, `inbound-email`, `inbound-settings` neu deployen (serverseitige Einwilligungsprüfung).

## 6. Organisatorisches

- [ ] **Verzeichnis der Bearbeitungstätigkeiten** anlegen (DSG Art. 12; bei unter 250 Mitarbeitenden und geringem Risiko freiwillig, aber empfohlen – die Tabellen der Datenschutzerklärung sind eine gute Grundlage).
- [ ] **Datenschutz-Folgenabschätzung** kurz dokumentieren: Lebensläufe + KI-Auswertung können ein erhöhtes Risiko darstellen.
- [ ] **Incident-Response:** Wer prüft, wer entscheidet, wer meldet? Meldung an den EDÖB „so rasch als möglich“ bei hohem Risiko (DSG Art. 24), EU-Behörde innert 72 Stunden (DSGVO Art. 33). Kontaktliste und Vorlage bereithalten.
- [ ] **Anfragen von Betroffenen:** Postfach für die Datenschutz-Adresse einrichten, Antwortfrist 30 Tage.
- [ ] Lokale Exporte mit echten Daten (z.B. `bewerbungsnachweis-*.csv`, `outputs/`) löschen oder verschlüsselt ablegen.

## 7. Offene technische Verbesserungen

- MFA (TOTP) über Supabase Auth anbieten.
- Virenscan hochgeladener Lebensläufe.
- Löschung inaktiver Konten (z.B. nach 24 Monaten mit Erinnerungsmail) als geplanter Job.
- Zentrale Fehlermeldung bei `ai_consent_required` in allen Edge-Function-Aufrufen.
