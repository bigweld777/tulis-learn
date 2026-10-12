# 🧠 Tulis Learn — Intelligent Spaced Repetition Platform

Nowoczesna, w pełni responsywna platforma do efektywnej nauki oparta o algorytm **FSRS** (*Free Spaced Repetition Scheduler*), zintegrowana z bazą danych **SQLite (WAL mode)**, systemem uwierzytelniania, panelem zarządzania taliami, asystentem sokratejskim AI oraz zaawansowanymi trybami powtórek pamięciowych.

---

## ✨ Kluczowe Funkcje Platformy

- **Autentykacja & Baza Danych SQLite:**
  - Wbudowany silnik **SQLite (WAL mode)** bez zewnętrznych kompilacji (`node:sqlite` w Node.js 24).
  - Bezpieczne haszowanie haseł za pomocą `scryptSync` i kryptograficznych soli (`node:crypto`).
  - Rejestracja, logowanie sesyjne (Bearer tokens), profil użytkownika, statystyki streak & retention.
  - Szybkie logowanie jednym kliknięciem: **Konto demonstracyjne** (Tomasz Tulis · Plan PRO).
- **Zarządzanie Taliami & Analityka:**
  - Panel zarządzania (`#managementModal`) z zakładkami: Moje Talie, Historia Powtórek, Profil & Konto, Kopia Zapasowa.
  - CRUD dla talii fiszek z bezpośrednim zapisem w bazie danych SQLite.
  - Wizualny **Heatmap Aktywności (14 dni)** w stylu GitHub / Duolingo w profilu użytkownika.
  - Rejestrowanie sesji powtórek w tabeli `study_logs`.
  - Eksport i import bazy w formacie JSON (`GET /api/backup` & `POST /api/backup`).
- **5 Zaawansowanych Trybów Nauki:**
  1. 🃏 **Fiszki 3D:** Przestrzenne obracanie fiszek, ocena trudności (Trudne +1d, Dobre +3d, Łatwe +7d) z algorytmem FSRS, obsługa skrótów klawiaturowych (Spacja, Strzałki, 1/2/3).
  2. 📝 **Quiz Wielokrotnego Wyboru:** Automatyczne generowanie realistycznych dystraktorów, pasek postępu i natychmiastowe wyjaśnienia.
  3. ⚡ **Dopasowywanie na Czas:** Dynamiczna gra pamięciowa par pojęcie-definicja z pomiarem czasu.
  4. ✍️ **Tryb Wpisywania (Type-in Active Recall):** Najskuteczniejsza metoda aktywnego odtwarzania z pamięci z inteligentnym porównywaniem tokenów i podświetlaniem różnic.
  5. 🕸️ **Semantyczny Graf Pojęć:** Interaktywny graf wiedzy na silniku HTML5 Canvas (fizyka 2D, przeciąganie węzłów).
- **Inteligentny Asystent Sokratejski AI:**
  - Czat sokratejski w wysuwanej szufladzie z obsługą pytań użytkownika oraz 4 strategii: Technika Feynmana, Kotwica mnemotechniczna, Pytanie sokratejskie, Przykład z życia.
  - Integracja na żywo z modelem wnioskowania **Gemini 3.8 Flash** z natychmiastowym fallbackiem semantycznym offline.
- **Konfigurator Modeli AI (`#aiSettingsModal`):**
  - Dostępny z paska nawigacji przycisk `⚡ Gemini 3.8`.
  - Możliwość weryfikacji połączenia live z pomiarem pingu (ms) oraz opcjonalnego podpięcia własnego klucza API (zapisywanego lokalnie w `localStorage`).
- **Progresywna Aplikacja PWA & Offline:**
  - Zaimplementowany Service Worker (`sw.js`) z cache'owaniem zasobów statycznych i pełnym wsparciem offline.
  - Aplikacja może być instalowana na urządzeniach mobilnych i desktopach.
- **Architektura Dual-Mode (Node.js + GitHub Pages / Netlify Fallback):**
  - **Tryb Full-Stack:** Po uruchomieniu `node server.js` całe API REST i baza SQLite działają lokalnie na `http://localhost:3000/`.
  - **Tryb Statyczny (Offline Fallback):** Po wrzuceniu na **GitHub Pages** lub Netlify bez serwera Node, wbudowany mechanizm `localFallbackApi` w `app.js` automatycznie przejmuje zapytania i synchronizuje stan w `localStorage`.
- **Wielojęzyczność (100% Parity):**
  - Pełne wsparcie dla języka polskiego (PL) i angielskiego (EN) ze 100% symetrią kluczy tłumaczeń (214 kluczy).

---

## 🚀 Uruchomienie Lokalne (Full-Stack)

1. Upewnij się, że masz zainstalowany **Node.js v22+** (rekomendowany v24 z natywnym `node:sqlite`).
2. Uruchom serwer:
   ```bash
   node server.js
   ```
3. Otwórz w przeglądarce:
   ```
   http://localhost:3000/
   ```

### Dane konta demonstracyjnego:
- **E-mail:** `tomasz@tulislearn.com`
- **Hasło:** `demo1234`
- *(Możesz też kliknąć przycisk „Zaloguj jako Demo” w oknie logowania).*

---

## 🧪 Testy Jakościowe i Bezpieczeństwa

Projekt zawiera zautomatyzowany audyt weryfikujący spójność DOM, ikony SVG, klucze i18n, bezpieczeństwo blokad plików bazodanowych oraz endpointy REST API:

```bash
node test_suite.js
```

Wynik: **32/32 testów zdanych (100% pass rate)**.

---

## 🌐 Wdrożenie na GitHub / GitHub Pages / Netlify

### 1. Inicjalizacja repozytorium Git:
```bash
git init
git add .
git commit -m "feat: complete Tulis Learn full-stack platform with PWA, SQLite and AI tutor"
```

### 2. Podpięcie pod Twoje repozytorium na GitHubie:
```bash
git remote add origin https://github.com/<TWOJ_LOGIN>/<NAZWA_REPOZYTORIUM>.git
git branch -M main
git push -u origin main
```

### 3. Hosting na GitHub Pages:
- W ustawieniach repozytorium na GitHubie: **Settings -> Pages**.
- Wybierz źródło: `Deploy from a branch` -> branch `main` -> folder `/ (root)`.
- Gotowe! Dzięki wbudowanemu `localFallbackApi` i `sw.js` aplikacja natychmiast działa w 100% bez konfiguracji zewnętrznych serwerów.
