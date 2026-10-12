# Tulis Learn

Platforma do aktywnej nauki: fiszki z rzeczywistym harmonogramem FSRS, quiz, dopasowywanie, wpisywanie odpowiedzi i graf pojęć. Działa z serwerem Node.js/SQLite oraz jako lokalna aplikacja na hostingu statycznym. Opcjonalna integracja Gemini korzysta z klucza użytkownika.

## Uruchomienie

Wymagany Node.js 24. Nie trzeba instalować pakietów npm.

```sh
node server.js
```

Otwórz `http://localhost:3000/`. Aplikacja jest gotowa do natychmiastowej nauki z trzema domyślnymi taliami. Dostępna jest rejestracja konta lub szybki start. Wylogowanie jest zachowywane po odświeżeniu.

Konfiguracja przez zmienne środowiskowe:

| Zmienna | Domyślnie | Znaczenie |
| --- | --- | --- |
| `PORT` | `3000` | Port HTTP |
| `HOST` | `127.0.0.1` | Interfejs nasłuchiwania |
| `TULIS_DB_PATH` | `tulis.db` obok kodu | Lokalizacja SQLite; testy używają `:memory:` |
| `PUBLIC_ORIGIN` | lokalny origin żądania | Docelowy origin HTTPS za reverse proxy; walidacja Host i Origin |
| `DISABLE_DEMO` | `0` | Ustaw `1`, aby wyłączyć tworzenie kont demo |

Przy publicznym wdrożeniu Node skonfiguruj HTTPS, stały `PUBLIC_ORIGIN`, trwały dysk dla SQLite i kopie bazy. Limiter działa na adres połączenia, bez zaufania do dowolnego `X-Forwarded-For`; przy reverse proxy trzeba także zastosować limitowanie na brzegu infrastruktury.

## Architektura

| Plik | Odpowiedzialność |
| --- | --- |
| `index.html`, `app.js` | Interfejs, i18n, pięć trybów nauki, klient API i integracja AI |
| `api-contract.js` | Wspólna walidacja kont, talii, historii i kopii |
| `server.js` | REST, autoryzacja, ograniczenia żądań, CSP i zamknięta lista zasobów publicznych |
| `db.js` | SQLite/WAL, przygotowane zapytania, scrypt, sesje i transakcyjny import |
| `local-api.js` | Lokalny adapter API, profile, Web Crypto PBKDF2, atomowy zapis i Web Locks |
| `review-store.js` | Rzeczywiste stany FSRS, terminy powtórek, oceny i kopie harmonogramu |
| `vendor/ts-fsrs.js` | Przypięta biblioteka `ts-fsrs` 5.4.2, MIT |
| `sw.js`, `manifest.json` | Cache publicznej powłoki, offline, instalacja w katalogu głównym lub podkatalogu |
| `build-static.js` | Przygotowanie wyłącznie publicznych plików do `dist/` |
| `test_suite.js`, `regression-tests.js` | Oryginalne kontrole i testy regresji SQLite, fallbacku, FSRS i PWA |

### Dwa tryby zapisu

Serwer przechowuje konta, talie i historię w SQLite. Hosting statyczny korzysta z osobnej lokalnej bazy w `localStorage`. Oba adaptery stosują ten sam kontrakt walidacji, własność danych, wygasanie sesji i semantykę CRUD/importu. Lokalny profil nie jest zewnętrzną usługą tożsamości: osoba mająca dostęp do przeglądarki może odczytać lub zmienić jej pamięć.

Tryb jest wybierany przez kontrolę `/api/health` i zapamiętywany dla originu. Błąd serwera nie uruchamia cichego zapisu do drugiej bazy. Przy niedostępnym serwerze można kontynuować naukę, pracować z lokalnym FSRS i wyeksportować notatki, ale zapis talii i historii na serwerze wymaga ponownego połączenia. Nie ma automatycznej synchronizacji lokalnej bazy z SQLite ani kolejki ponawiania zapisów. Po świadomej zmianie typu hostingu na tym samym originie usuń wyłącznie preferencję `tulis_api_mode` w narzędziach przeglądarki.

Newsletter w SQLite rejestruje adres na liście; wysyłka wiadomości wymaga osobnej usługi. Tryb lokalny zwraca błąd dostępności, zamiast potwierdzać fikcyjną subskrypcję. Kontakt otwiera aplikację pocztową użytkownika.

### FSRS

Biblioteka `ts-fsrs` oblicza stabilność, trudność, szacowane przypomnienie i termin następnej powtórki. Przyciski prezentują interwały obliczone dla konkretnej fiszki. Dostępne są cztery oceny: Again, Hard, Good i Easy. Przycisk „Powtórz zaplanowane” wybiera fiszki wymagające nauki teraz.

Harmonogram jest lokalny, rozdzielony według profilu i trybu zapisu, a fiszki są identyfikowane przez parę pytanie–odpowiedź. Identyczna para w dwóch taliach tego samego profilu współdzieli stan pamięci. Zmiana treści tworzy nową fiszkę. Domyślna docelowa retencja to 90%, bez losowego fuzzingu. Wykres w oknie analityki jest ilustracją; wartości liczbowe pochodzą z ocenionych fiszek. Quiz i porównanie wpisanego tekstu nie udają pomiaru pamięci ani automatycznej oceny FSRS.

Kopia pobierana z panelu obejmuje talie, historię oraz lokalny harmonogram FSRS. Samo REST `GET /api/backup` zwraca talie i historię. Import jest dodający: nie usuwa istniejących talii. Dane SQLite są importowane w jednej transakcji, lokalna baza jednym zapisem. Harmonogram jest walidowany przed importem i łączony oddzielnie, zachowując nowsze oceny. Błąd jego zapisu po imporcie talii jest zgłaszany wprost. Historia ocen FSRS obejmuje ostatnie 2000 ocen; serwerowa kopia historii do 10 000 sesji.

### AI i prywatność

Własny klucz Gemini jest przechowywany w `sessionStorage` bieżącej karty, nigdy w kodzie ani w kopii zapasowej. Wywołania używają nagłówka `x-goog-api-key`, limitu czasu i wybranego modelu. Test połączenia wykonuje małą generację na wybranym modelu i może podlegać rozliczeniu dostawcy. Wywołania AI przesyłają wybrany tekst do Google; zasady retencji i wykorzystania danych wynikają z warunków dostawcy. Projekt nie gwarantuje Zero Data Retention.

Bez klucza parser wyodrębnia istniejące pary i proste definicje. Asystent pokazuje wyraźnie oznaczone ćwiczenie lokalne. Nie zmyśla odpowiedzi i nie zastępuje nieudanego wyniku przykładową talią. Generowane odpowiedzi wymagają sprawdzenia przez użytkownika. Integracja Anthropic i Google OAuth nie są zaimplementowane i nie są oferowane w interfejsie.

## Testy

```sh
node test_suite.js
node build-static.js
```

Zestaw sam uruchamia własny serwer na wolnym porcie i bazę SQLite w pamięci; nie wymaga działającego serwera i nie modyfikuje `tulis.db`. Sprawdza m.in. izolację użytkowników, błędne JSON-y/tokeny, limity rozmiaru, atomowy import, awarie pamięci, równoległe zapisy, wygaśnięcie sesji, stany i kopie FSRS oraz cache PWA w podkatalogu. Kontrole UI obejmują również rzeczywiste przepływy w przeglądarce; same testy tekstowe DOM nie dowodzą poprawności runtime.

## Wdrożenie statyczne

Netlify odczyta `netlify.toml`, uruchomi `node build-static.js` i opublikuje tylko `dist/`. Nie publikuj katalogu repozytorium: zawiera kod serwera, testy i lokalną bazę. Build odmawia publikacji nieoczekiwanych starych plików w `dist/`.

Dla GitHub Pages wybierz **Settings → Pages → Source: GitHub Actions**, a następnie ręcznie uruchom workflow **Publish public Tulis Learn assets**. Workflow najpierw uruchamia testy, a potem publikuje `dist/`. Jest uruchamiany wyłącznie na żądanie. Ścieżki aplikacji i service workera są względne, także pod `/nazwa-repozytorium/`. GitHub Pages nie stosuje pliku `_headers`; nagłówki CSP są aktywne na Node i Netlify.

PWA wymaga HTTPS albo localhost. Po pierwszym udanym załadowaniu cache pozwala uruchomić powłokę offline; pierwsza wizyta bez sieci nie może pobrać aplikacji. Service worker nie cache'uje API, tokenów ani odpowiedzi zewnętrznego AI i usuwa wyłącznie własne stare cache.

## Funkcjonalności produkcyjne

- **5 trybów nauki**: Fiszki, Quiz, Dopasowywanie (Speed Match), Wpisywanie (Type-In Recall) oraz Semantyczny Graf Pojęć.
- **Silnik powtórek FSRS 5.4.2**: Matematycznie optymalny harmonogram powtórek oparty na krzywej zapominania Ebbinghausa.
- **Asystent Sokratyczny i Ekstrakcja AI**: Integracja z modelami Google Gemini (z kluczem użytkownika).
- **Bezpieczeństwo i prywatność**: Klucz API przechowywany w sesji klienta, pełna izolacja baz danych SQLite i ochrona CSP.

## Źródła i licencja zależności

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs), wersja 5.4.2; licencja w `vendor/LICENSE.ts-fsrs`. Integralność archiwum npm sprawdzono SHA-512: `z4qop4pzTcyTzuJ566d9EaX/4bZZzhYfeaPImfVr+xcYT65c5oBgFDijUhCE/D+C78eaolHIhKRZ04/RwF+v2g==`.
- [Gemini GenerateContent](https://ai.google.dev/api/generate-content).
- [GitHub Pages custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

W trakcie przeglądu usunięto zakodowany w kodzie klucz API. Należy unieważnić go u dostawcy, ponieważ może pozostać w poprzednich commitach. Usunięcie ciągu z aktualnego pliku nie unieważnia credentiala.
