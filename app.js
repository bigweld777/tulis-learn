"use strict";

(() => {
  const $ = (id) => document.getElementById(id);
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  // Preferences may be ephemeral; data adapters report persistence failures explicitly.
  const memoryPreferences = new Map();
  const preferences = {
    getItem(key) { try { return window.localStorage.getItem(key); } catch { return memoryPreferences.get(key) ?? null; } },
    setItem(key, value) { try { window.localStorage.setItem(key, String(value)); } catch { memoryPreferences.set(key, String(value)); } },
    removeItem(key) { try { window.localStorage.removeItem(key); } catch {} memoryPreferences.delete(key); }
  };
  const durableStorage = {
    getItem(key) { return window.localStorage.getItem(key); },
    setItem(key, value) { window.localStorage.setItem(key, value); }
  };
  const aiKeys = {
    get() {
      try {
        return window.localStorage.getItem('tulis_custom_ai_key') || window.sessionStorage.getItem('tulis_custom_ai_key') || '';
      } catch {
        return '';
      }
    },
    set(value) {
      try { window.localStorage.setItem('tulis_custom_ai_key', value); } catch {}
      try { window.sessionStorage.setItem('tulis_custom_ai_key', value); } catch {}
    }
  };
  let ratingPending = false;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let currentMode = 'cards';
  function reviewStore() {
    return TulisReviews.create(durableStorage, currentUser ? currentUser.id + ':' + apiMode : 'guest');
  }

  const contact = 'kontakt@tulislearn.tech';

  // Update contact links in footer
  const footerMailEl = $("footerEmail");
  if (footerMailEl) {
    footerMailEl.href = `mailto:${contact}`;
    footerMailEl.textContent = `${contact} ↗`;
  }

  const limits = { cards: 100, characters: 20000 };
  let deck = [];
  let cardIndex = 0;
  let revealed = false;
  let quiz = null;
  let matchGame = null;
  let isExtracting = false;

  // Multi-domain Curated Presets
  const PRESETS = {
    bio: `Na czym polega aktywne przypominanie? | Na odtwarzaniu wiedzy z pamięci bez zaglądania do materiałów.
Co oznacza fotosynteza? | Wytwarzanie związków organicznych z użyciem energii światła.
Które organellum odpowiada za fotosyntezę? | Chloroplast.
Jaki gaz roślina pobiera podczas fotosyntezy? | Dwutlenek węgla.
Co stanowi produkt uboczny fazy jasnej fotosyntezy? | Tlen cząsteczkowy (O2).
Czym jest cykl Calvina w fotosyntezie? | Cyklem reakcji biochemicznych fazy ciemnej wiążącym CO2 w glukozę.`,

    cs: `Czym różni się model wnioskowania (Reasoning) od klasycznego LLM? | Model wnioskowania generuje wewnętrzny łańcuch myśli (Chain-of-Thought) przed udzieleniem odpowiedzi.
Co to jest technika Prompt Chaining w systemach agentowych? | Rozbicie złożonego zadania na sekwencję mniejszych promptów, gdzie wynik jednego jest wejściem kolejnego.
Jak działa algorytm FSRS (Free Spaced Repetition Scheduler)? | Wyznacza optymalne interwały powtórek na podstawie macierzy stabilności i trudności pamięciowej.
Czym różni się RAG (Retrieval-Augmented Generation) od Fine-Tuningu? | RAG dynamicznie dołącza fragmenty bazy wiedzy do promptu, nie modyfikując wag modelu.
Dlaczego metoda sokratyczna jest najskuteczniejsza w edukacji z AI? | Zamiast dawać gotową odpowiedź, stymuluje myślenie krytyczne poprzez pytania naprowadzające.
Co oznacza odporność na halucynacje w zaawansowanych modelach? | Zdolność modelu do ścisłego trzymania się faktów z tekstu źródłowego i unikania zmyślonych twierdzeń.`,

    law: `Czym jest zdolność prawna w polskim Kodeksie Cywilnym? | Zdolnością do bycia podmiotem praw i obowiązków, przysługującą każdemu człowiekowi od chwili urodzenia.
Kiedy osoba fizyczna nabywa pełną zdolność do czynności prawnych? | Z chwilą uzyskania pełnoletności (ukończenia 18 lat lub zawarcia małżeństwa przez kobietę od 16 lat).
Czym jest przedawnienie roszczeń majątkowych? | Utratą możliwości przymusowego dochodzenia roszczenia przed sądem po upływie określonego w ustawie czasu.
Jaki jest ogólny termin przedawnienia roszczeń według art. 118 k.c.? | 6 lat, a dla roszczeń o świadczenia okresowe oraz związanych z prowadzeniem działalności gospodarczej - 3 lata.
Czym różni się umowa zlecenia od umowy o dzieło? | Umowa zlecenia to umowa starannego działania, a umowa o dzieło to umowa rezultatu.
Co oznacza zasada pacta sunt servanda? | Umów należy dotrzymywać (podstawowa zasada prawa zobowiązań).`
  };

  const PRESETS_EN = {
    bio: `What is active recall? | Retrieving information from memory without looking at notes.
What is photosynthesis? | The synthesis of organic compounds using light energy, CO2, and water.
Which organelle carries out photosynthesis in plant cells? | The chloroplast.
Which gas is absorbed by plants during photosynthesis? | Carbon dioxide (CO2).
What is the primary byproduct of light-dependent reactions? | Molecular oxygen (O2).
What is the Calvin cycle? | The biochemical reactions of the light-independent phase fixing CO2 into glucose.`,

    cs: `What distinguishes reasoning models from standard LLMs? | Reasoning models generate an internal Chain-of-Thought (CoT) before producing the final response.
What is Prompt Chaining in agentic workflows? | Decomposing a complex task into atomic steps where the output of step N feeds step N+1.
How does the FSRS algorithm optimize human memory? | Calculates mathematically optimal review intervals using memory stability and difficulty matrices.
How does RAG differ from model fine-tuning? | RAG injects retrieved ground-truth context dynamically at inference without retraining weights.
Why is Socratic questioning superior in AI-assisted tutoring? | Guides students toward first-principles understanding rather than feeding passive answers.
What is hallucination resistance in advanced language models? | The model's verified adherence to source facts, refusing to invent unsupported claims.`,

    law: `What is legal capacity in civil law? | The innate capacity to hold legal rights and obligations from the moment of birth.
When does full capacity for legal acts occur? | Upon reaching the age of majority (18 years) in standard civil jurisdictions.
What is the statute of limitations? | A law that sets the maximum time after an event within which legal proceedings may be initiated.
What distinguishes an obligation of means from an obligation of result? | Means requires diligent best-effort, whereas result requires delivering the promised outcome.
What does 'pacta sunt servanda' mean? | Agreements must be kept (fundamental rule of contract law).
What is force majeure? | Unforeseeable circumstances that prevent someone from fulfilling a contract.`
  };

  // Comprehensive Bilingual i18n Dictionary
  const TRANSLATIONS = {
    pl: {
      due_review: "Powtórz zaplanowane",
      nav_app: "Aplikacja",
      nav_features: "Funkcje",
      nav_reviews: "Opinie",
      nav_plans: "Cennik",
      nav_faq: "FAQ",
      nav_login: "Zaloguj się",
      nav_start_free: "Zacznij za darmo",
      hero_badge: "Platforma Edukacyjna AI · Nowa Generacja",
      hero_h1_1: "Zrozum więcej.",
      hero_h1_2: "Wracaj w dobrym czasie.",
      hero_h1_3: "Ucz się aktywnie.",
      hero_desc: "Zamień notatki w fiszki, sprawdź wiedzę w pięciu trybach i planuj powtórki z FSRS. Zacznij lokalnie; dodaj własny klucz, gdy potrzebujesz AI.",
      hero_try_btn: "Rozpocznij naukę bezpłatnie",
      hero_login_btn: "Zaloguj się do platformy",
      hero_micro: "Brak wymogu karty. Gotowe do nauki w kilka sekund.",
      stat_cards: "trybów nauki",
      stat_retention: "adaptacyjne powtórki",
      stat_speed: "lokalna nauka",
      stat_rating: "dwa języki",
      workspace_eyebrow: "INTERAKTYWNY WARSZTAT NAUKI",
      workspace_title: "Mniej teorii. Więcej pamiętania.",
      workspace_desc: "Wybierz talię lub wpisz pary pytanie | odpowiedź. Lokalny parser działa offline; opcjonalna generacja AI korzysta z modeli Anthropic Claude.",
      dash_streak: "dni serii",
      dash_decks: "zestawy",
      dash_retention: "retencji FSRS",
      deck_sel_label: "Talia:",
      btn_import: "📥 Wgraj plik",
      btn_save: "💾 Zapisz",
      btn_export: "📤 Eksportuj",
      editor_label: "Twoje materiały",
      btn_load_example: "Wczytaj domyślne",
      preset_label: "Przykłady:",
      preset_bio: "🌿 Biologia",
      preset_cs: "⚡ Informatyka & AI",
      preset_law: "⚖️ Prawo cywilne",
      notes_help: "Wklej notatki (format: <strong>pytanie | odpowiedź</strong> lub surowy tekst) i kliknij ekstrakcję AI.",
      btn_create: "Kompiluj fiszki",
      btn_ai_simulate: "✨ Inteligentna ekstrakcja AI",
      study_title: "Przestrzeń powtórki",
      tab_cards: "Fiszki",
      tab_quiz: "Quiz",
      tab_match: "Dopasowywanie",
      tts_btn: "🔊 Odsłuchaj",
      btn_prev: "Poprzednia",
      btn_shuffle: "🔀 Przetasuj",
      btn_next: "Następna",
      srs_title: "Powtórka interwałowa (Algorytm FSRS):",
      srs_hard: "Trudne (+1 d)",
      srs_med: "Dobre (+3 d)",
      srs_easy: "Łatwe (+7 d)",
      quiz_done_h: "Powtórka zakończona!",
      quiz_restart: "Spróbuj jeszcze raz",
      match_win_h: "Wszystkie pojęcia połączone!",
      match_restart: "Zagraj ponownie",
      testi_eyebrow: "SPOŁECZNOŚĆ AKTYWNYCH STUDENTÓW",
      testi_title: "Co mówią osoby, które uczą się z Tulis Learn?",
      testi_desc: "Przykłady zastosowania aktywnego przypominania i algorytmu FSRS na studiach.",
      pricing_eyebrow: "TRANSPARENTNE PAKIETY",
      pricing_title: "Wybierz plan dopasowany do Twojej nauki",
      pricing_desc: "Zacznij bezpłatnie na zawsze. Odblokuj pełną moc AI, gdy zbliża się sesja.",
      bill_monthly: "Miesięcznie",
      bill_save: "Oszczędzasz 20%",
      plan_free_name: "Starter",
      plan_free_tag: "Darmowy na zawsze",
      plan_free_caption: "Wszystko, co potrzebne do codziennej nauki",
      btn_plan_free: "Rozpocznij naukę",
      plan_pro_name: "Student Pro",
      plan_pro_tag: "Najpopularniejszy",
      plan_pro_caption: "Maksymalne przyspieszenie z silnikiem AI",
      btn_plan_pro: "Wybierz Student Pro",
      plan_team_name: "Campus & Grupy",
      plan_team_tag: "Koła naukowe",
      plan_team_caption: "Dla grup studenckich i roczników",
      btn_plan_team: "Skontaktuj się",
      faq_eyebrow: "PYTANIA I ODPOWIEDZI",
      faq_title: "Najczęściej zadawane pytania",
      faq_desc: "Wszystko, co musisz wiedzieć o nauce z Tulis Learn.",
      about_title: "Nowoczesna edukacja bez zbędnego chaosu.",
      about_desc: "Cześć, tu Tomasz Tulis. Tworzę Tulis Learn jako platformę nowej generacji — łączącą kognitywistykę, algorytmy powtórek interwałowych FSRS oraz sztuczną inteligencję. Chcę, by każdy student i uczeń w Polsce i Europie mógł uczyć się skutecznie, w spokoju i bez marnowania czasu na bezproduktywne zakuwanie.",
      cta_banner_h: "Gotowy, by uczyć się skuteczniej?",
      cta_banner_p: "Wybierz talię i sprawdź, ile potrafisz odtworzyć z pamięci.",
      cta_banner_btn: "Otwórz warsztat nauki",
      auth_title: "Witaj w Tulis Learn",
      auth_sub: "Zaloguj się, aby zsynchronizować talie i śledzić postępy powtórek FSRS.",
      auth_email: "Adres e-mail",
      auth_pass: "Hasło",
      auth_submit: "Zaloguj się",
      auth_quick_start_btn: "⚡ Szybki start (dostęp natychmiastowy)",
      card_question_tag: "PYTANIE",
      card_answer_tag: "ODPOWIEDŹ",
      card_hint_flip: "Kliknij, aby odsłonić odpowiedź",
      card_hint_back: "Kliknij, aby wrócić do pytania",
      study_help: "Przypomnij sobie odpowiedź, zanim odwrócisz kartę.",
      footer_contact_ask: "Masz pomysł albo chcesz porozmawiać?",
      quiz_score: "Poprawne: ",
      quiz_next: "Następne pytanie",
      quiz_finish: "Zobacz wynik",
      tech_eyebrow: "SILNIK KOGNITYWNY · ARCHITEKTURA AI",
      tech_title: "Zaawansowany potok semantyczny.<br />Od notatek do trwałej wiedzy.",
      tech_intro: "Połącz fiszki z adaptacyjnym harmonogramem FSRS, przejrzyj wspólne słowa na grafie i skorzystaj z pytań generowanych przez Claude 3.5.",
      tech_tag: "Silnik Kognitywny · Architektura AI",
      tech_feat1_h: "Ważne pojęcia, wyłuskane z kontekstu",
      tech_feat1_p: "Parser przekształca pary i proste definicje w fiszki. Z własnym kluczem możesz wygenerować pytania z surowych notatek.",
      tech_feat2_h: "Asystent sokratyczny, który pomaga dojść do odpowiedzi",
      tech_feat2_p: "Adaptacyjne podpowiedzi i wyjaśnienia błędów prowadzą do głębokiego zrozumienia, zamiast mechanicznego wkuwania.",
      tech_feat3_h: "Kontrola nad materiałami",
      tech_feat3_p: "Lokalny parser nie wysyła notatek. Generacja AI wymaga Twojego klucza i przesyła wybrany tekst bezpośrednio do API Anthropic Claude.",
      pipeline_title: "Potok Kognitywny & Architektura AI",
      pipeline_badge: "⚡ Hybrydowy Potok LLM",
      pipe1_badge: "KROK 1 · Szybka Ingestia",
      pipe1_h: "Ingestia & Segmentacja",
      pipe1_p: "Odczyt tekstu lub plików TXT i CSV z parami pytanie–odpowiedź.",
      pipe2_badge: "KROK 2 · Głębokie Rozumowanie",
      pipe2_h: "Analiza Semantyczna",
      pipe2_p: "Zaawansowany model Claude 3.5 Sonnet analizuje notatki i automatycznie generuje atomowe pytania oraz definicje.",
      pipe3_badge: "KROK 3 · Pętla Sokratyczna",
      pipe3_h: "Pętla Sokratyczna",
      pipe3_p: "Interaktywny tutor sokratyczny prowadzi Cię przez tok myślenia i wyjaśnia błędy kognitywne.",
      pipe4_badge: "KROK 4 · Algorytm FSRS",
      pipe4_h: "Optymalizacja Pamięci",
      pipe4_p: "Adaptacyjny algorytm Free Spaced Repetition Scheduler przelicza krzywą zapominania Ebbinghausa dla każdego pojęcia.",
      tech_note: "Nowoczesna architektura Tulis Learn łączy lokalny silnik FSRS z zaawansowanymi modelami językowymi. Twoje dane i notatki są bezpieczne.",
      testi_1_text: "„Zdałam anatomię prawidłową w 1. terminie! Wklejam notatki z wykładów, a silnik AI wyciąga najtrudniejsze zależności i tworzy fiszki, których nie muszę pisać ręcznie.”",
      testi_1_role: "Kierunek Lekarski · Collegium Medicum UJ",
      testi_2_text: "„Algorytm FSRS w połączeniu z trybem dopasowywania to absolutny game-changer. Uczę się algorytmów i systemów operacyjnych 3 razy szybciej niż z suchych slajdów.”",
      testi_2_role: "Informatyka · Politechnika Warszawska",
      testi_3_text: "„Do egzaminu na aplikację radcowską materiału jest za dużo na zwykłe notatki. Tulis Learn pozwala mi powtarzać kodeksy w tramwaju i sprawdzać się w szybkich quizach.”",
      testi_3_role: "Aplikantka Radcowska · OIRP Wrocław",
      p1_f1: "Fiszki, Quizy i Tryb Dopasowywania",
      p1_f2: "Algorytm powtórek FSRS w przeglądarce",
      p1_f3: "Własna biblioteka talii",
      p1_f4: "Brak reklam i brak wymogu rejestracji",
      p2_f1: "Wszystko z planu Starter",
      p2_f2: "Inteligentna ekstrakcja AI z notatek",
      p2_f3: "Lektor Audio (wymowa i nauka słuchowa)",
      p2_f4: "Nielimitowane zestawy w bibliotece",
      p2_f5: "Sokratyczny asystent wyjaśniający błędy",
      p3_f1: "Wszystko z planu Student Pro",
      p3_f2: "Współdzielona baza talii dla grupy",
      p3_f3: "Eksport JSON, CSV i Anki",
      p3_f4: "Dedykowane wsparcie i priorytet API",
      faq_q1: "Jak Tulis Learn pomaga uczyć się szybciej?",
      faq_a1: "Łączymy dwie najskuteczniejsze techniki kognitywne poparte badaniami: aktywne przypominanie (Active Recall) oraz algorytm powtórek interwałowych FSRS. Zamiast biernego czytania notatek po raz dziesiąty, zmuszasz mózg do odtwarzania wiedzy, a algorytm serwuje Ci pytania dokładnie wtedy, gdy zaczynasz je zapominać.",
      faq_q2: "Czym różni się algorytm FSRS od klasycznego SuperMemo/Anki SM-2?",
      faq_a2: "FSRS modeluje stabilność i trudność pamięci na podstawie ocen powtórek. Tulis Learn korzysta z biblioteki ts-fsrs; interwały zależą od historii danej fiszki.",
      faq_q3: "Czy mogę wgrywać własne pliki i notatki z uczelni?",
      faq_a3: "Tak! Możesz wkleić dowolny tekst, zaimportować pliki tekstowe (.txt, .csv) lub skorzystać z przycisku „Inteligentna ekstrakcja AI”, który w ułamku sekundy automatycznie wychwyci definicje i przekształci je w zestaw pytań i odpowiedzi.",
      faq_q4: "Czy moje materiały edukacyjne są prywatne?",
      faq_a4: "Lokalny parser pracuje na urządzeniu. W trybie serwera talie trafiają do SQLite. Opcjonalne zapytania AI przesyłane są bezpośrednio do API Anthropic Claude z zachowaniem pełnej poufności danych.",
      faq_q5: "Czy aplikacja działa na smartfonach i tabletach?",
      faq_a5: "Tak, platforma jest w pełni responsywna i zoptymalizowana pod ekrany dotykowe. Możesz uczyć się w podróży, przewijając fiszki kciukiem lub testując się w quizach w dowolnym miejscu.",
      tab_graph: "Graf pojęć",
      graph_title: "🕸️ Semantyczna mapa pojęć i powiązań",
      graph_reset: "↺ Wycentruj",
      graph_help: "Wizualizacja zależności pojęciowych w talii. Przeciągaj węzły, kliknij dwukrotnie, aby przejść do fiszki.",
      socratic_btn: "💡 Asystent Sokratejski AI",
      socratic_feynman: "👶 Wyjaśnij jak 5-latkowi",
      socratic_mnemonic: "🧠 Mnemotechnika / Skojarzenie",
      socratic_question: "❓ Pytanie sokratejskie",
      socratic_example: "🌍 Przykład z życia",
      btn_print: "🖨️ Drukuj (A4)",
      print_modal_title: "🖨️ Przygotuj fiszki do druku (A4)",
      print_modal_sub: "Zestaw gotowy do wycięcia i nauki offline z przerywanymi liniami zagięcia.",
      print_cards_in_deck: "fiszek w aktywnej talii",
      print_btn_action: "🖨️ Drukuj teraz (Ctrl+P)",
      fsrs_modal_title: "🧠 Analityka Kognitywna & Model FSRS",
      fsrs_modal_sub: "Krzywa zapominania Hermanna Ebbinghausa vs. Free Spaced Repetition Scheduler",
      fsrs_legend_ebbinghaus: "Krzywa Ebbinghausa (bez powtórek)",
      fsrs_legend_fsrs: "Krzywa FSRS (optymalne powtórki)",
      fsrs_m_stab_lbl: "Stabilność (S)",
      fsrs_m_stab_sub: "średni czas do 90% retencji",
      fsrs_m_diff_lbl: "Trudność (D)",
      fsrs_m_diff_sub: "współczynnik złożoności",
      fsrs_m_ret_lbl: "Szacowane przypomnienie (R)",
      fsrs_m_ret_sub: "na podstawie ocenionych fiszek",
      fsrs_why_title: "Dlaczego FSRS przewyższa tradycyjne metody?",
      fsrs_why_desc: "FSRS dynamicznie modeluje stabilność pamięci i współczynnik trudności każdego pojęcia. Powtórki są planowane dokładnie w momencie, gdy retencja spada do optymalnego progu.",
      btn_close: "Zamknij",
      auth_tab_login: "Logowanie",
      auth_tab_register: "Rejestracja",
      auth_name: "Imię i nazwisko",
      auth_btn_register: "Zarejestruj się",
      mgmt_deck_title: "Nazwa talii",
      mgmt_title: "👤 Twoje Konto & Biblioteka Talii",
      mgmt_sub: "Zarządzaj swoimi taliami, historią powtórek i postępami w nauce.",
      mgmt_tab_decks: "📚 Moje Talie",
      mgmt_tab_history: "📊 Historia Powtórek",
      mgmt_tab_profile: "👤 Profil & Konto",
      mgmt_tab_backup: "💾 Kopia Zapasowa",
      mgmt_decks_hint: "Wszystkie talie zapisane w Twojej lokalnej bazie danych:",
      mgmt_btn_new_deck: "+ Nowa talia",
      mgmt_history_hint: "Rejestr sesji powtórkowych zapisywany automatycznie przez algorytm FSRS:",
      mgmt_btn_logout: "🚪 Wyloguj się z konta",
      mgmt_backup_hint: "Pobierz kopię talii, historii i harmonogramu FSRS lub zaimportuj kopię JSON:",
      mgmt_btn_download_backup: "📥 Pobierz kopię bazy (JSON)",
      mgmt_btn_import_backup: "📤 Wgraj kopię z pliku",
      tab_type: "Wpisywanie",
      type_label: "Wpisz odpowiedź z pamięci (Active Recall):",
      type_btn_check: "Sprawdź odpowiedź (Enter)",
      type_btn_skip: "Pokaż odpowiedź",
      socratic_custom_ph: "Zadaj własne pytanie asystentowi AI...",
      socratic_send_btn: "Zapytaj 🚀",
      mgmt_heatmap_title: "AKTYWNOŚĆ POWTÓREK (OSTATNIE 14 DNI)",
      ai_modal_title: "⚙️ Konfiguracja Modeli Kognitywnych AI",
      ai_modal_sub: "Wybierz model Claude lub Gemini, własny klucz API i temperaturę generacji.",
      ai_status_label: "Aktywny silnik platformy:",
      ai_status_desc: "Anthropic Claude 3.5 Sonnet & Haiku • Hybrydowy potok Applied AI • Ekstrakcja w locie • Metoda sokratejska.",
      ai_provider_label: "Wybór silnika AI:",
      ai_custom_key_label: "Własny klucz API (Claude lub Gemini, zapisany w tej przeglądarce):",
      ai_key_hint: "Wpisz swój klucz Anthropic Claude API (sk-ant-...) lub Google Gemini. Klucz jest zapisywany lokalnie w Twojej przeglądarce i nie trafia na nasze serwery.",
      ai_temp_label: "Temperatura wnioskowania:",
      ai_btn_test: "⚡ Przetestuj połączenie",
      ai_btn_save: "Zapisz ustawienia",
      newsletter_badge: "NOWOŚĆ · BIULETYN KOGNITYWNY",
      newsletter_title: "📬 Techniki Efektywnej Nauki w Twojej Skrzynce",
      newsletter_sub: "Cotygodniowe praktyczne wskazówki: psychologia uczenia się, optymalizacja powtórek FSRS oraz jak zdać najtrudniejsze egzaminy bez wypalenia.",
      newsletter_btn_sub: "Zapisz się bezpłatnie",
      footer_shortcuts_link: "⌨️ Skróty klawiszowe (?)",
      footer_cookie_settings: "🍪 Ustawienia cookies",
      cookie_title: "Prywatność & Pliki Cookie",
      cookie_desc: "Używamy pamięci lokalnej (LocalStorage) oraz niezbędnych ciasteczek do zapamiętywania preferencji językowych, motywu i Twoich talii fiszek zgodnie z RODO. Nie prowadzimy inwazyjnego profilowania reklamowego.",
      cookie_privacy_link: "Polityka prywatności",
      cookie_necessary: "Tylko niezbędne",
      cookie_accept_all: "Zezwól na wszystkie",
      shortcuts_title: "⌨️ Skróty Klawiszowe",
      shortcuts_subtitle: "Błyskawiczne sterowanie platformą bez odrywania rąk od klawiatury",
      shortcut_space: "Obróć bieżącą fiszkę (Pytanie / Odpowiedź)",
      shortcut_arrows: "Poprzednia / Następna fiszka w talii",
      shortcut_fsrs: "Ocena FSRS (1: Jeszcze raz, 2: Trudne, 3: Dobre, 4: Łatwe)",
      shortcut_enter: "Sprawdź wpisaną odpowiedź (Tryb Wpisywanie)",
      shortcut_f: "Przełącz na tryb Fiszki",
      shortcut_q: "Przełącz na tryb Quiz",
      shortcut_m: "Przełącz na tryb Dopasowywanie",
      shortcut_t: "Przełącz na tryb Wpisywanie (Active Recall)",
      shortcut_g: "Otwórz Graf pojęć",
      shortcut_s: "Otwórz Asystenta Sokratejskiego AI",
      shortcut_question: "Otwórz / Zamknij to okno skrótów klawiszowych",
      shortcut_esc: "Zamknij aktywne okno modalne lub asystenta",
      export_modal_title: "📤 Eksportuj Talię Fiszek",
      export_modal_sub: "Wybierz format eksportu dopasowany do Twojego ulubionego ekosystemu:",
      export_fmt_anki: "Format Anki (.txt / TSV) — bezpośredni import do Anki / AnkiWeb",
      export_fmt_json: "Format JSON (.json) — kompletna struktura danych i kopia zapasowa",
      export_fmt_csv: "Arkusz kalkulacyjny (.csv) — dla Excela, Google Sheets i Numbers"
    },
    en: {
      due_review: "Review due cards",
      nav_app: "App Workspace",
      nav_features: "Features",
      nav_reviews: "Reviews",
      nav_plans: "Pricing",
      nav_faq: "FAQ",
      nav_login: "Log in",
      nav_start_free: "Get Started Free",
      hero_badge: "Next-Gen AI Learning Platform",
      hero_h1_1: "Understand more.",
      hero_h1_2: "Review at the right time.",
      hero_h1_3: "Learn actively.",
      hero_desc: "Turn notes into flashcards, test your knowledge in five modes, and schedule reviews with FSRS. Start locally; add your own key for AI guidance.",
      hero_try_btn: "Start Learning for Free",
      hero_login_btn: "Sign in to Platform",
      hero_micro: "No credit card required. Ready to study in seconds.",
      stat_cards: "study modes",
      stat_retention: "adaptive reviews",
      stat_speed: "local study",
      stat_rating: "two languages",
      workspace_eyebrow: "INTERACTIVE STUDY WORKSPACE",
      workspace_title: "Less theory. Deep retention.",
      workspace_desc: "Choose a deck or enter question | answer pairs. Local parsing works offline; optional AI generation uses Anthropic Claude models.",
      dash_streak: "day streak",
      dash_decks: "active decks",
      dash_retention: "FSRS retention",
      deck_sel_label: "Deck:",
      btn_import: "📥 Import File",
      btn_save: "💾 Save",
      btn_export: "📤 Export",
      editor_label: "Your Source Material",
      btn_load_example: "Load Default",
      preset_label: "Domains:",
      preset_bio: "🌿 Biology & Med",
      preset_cs: "⚡ Computer Science & AI",
      preset_law: "⚖️ Civil Law",
      notes_help: "Paste source material (format: <strong>question | answer</strong> or raw text) and run AI extraction.",
      btn_create: "Compile Flashcards",
      btn_ai_simulate: "✨ Smart AI Extraction",
      study_title: "Active Study Session",
      tab_cards: "Flashcards",
      tab_quiz: "Quiz",
      tab_match: "Match Game",
      tts_btn: "🔊 Audio TTS",
      btn_prev: "Previous",
      btn_shuffle: "🔀 Shuffle",
      btn_next: "Next",
      srs_title: "Spaced Repetition Scheduler (FSRS Algorithm):",
      srs_hard: "Hard (+1 d)",
      srs_med: "Good (+3 d)",
      srs_easy: "Easy (+7 d)",
      quiz_done_h: "Review Completed!",
      quiz_restart: "Try Again",
      match_win_h: "All concepts matched!",
      match_restart: "Play Again",
      testi_eyebrow: "ACTIVE LEARNER COMMUNITY",
      testi_title: "What learners say about Tulis Learn",
      testi_desc: "Real-world active recall workflows and FSRS study routines.",
      pricing_eyebrow: "TRANSPARENT PRICING",
      pricing_title: "Choose the plan that fits your study pace",
      pricing_desc: "Free forever for core studying. Unlock unlimited AI power when exam season peaks.",
      bill_monthly: "Monthly",
      bill_save: "Save 20%",
      plan_free_name: "Starter",
      plan_free_tag: "Free Forever",
      plan_free_caption: "Everything needed for daily study sessions",
      btn_plan_free: "Start Learning",
      plan_pro_name: "Student Pro",
      plan_pro_tag: "Most Popular",
      plan_pro_caption: "Maximum acceleration with full AI power",
      btn_plan_pro: "Choose Student Pro",
      plan_team_name: "Campus & Groups",
      plan_team_tag: "Study Clubs",
      plan_team_caption: "For study groups and academic departments",
      btn_plan_team: "Contact Team",
      faq_eyebrow: "QUESTIONS & ANSWERS",
      faq_title: "Frequently Asked Questions",
      faq_desc: "Everything you need to know about learning with Tulis Learn.",
      about_title: "Modern education without needless friction.",
      about_desc: "Hi, I'm Tomasz Tulis. I'm building Tulis Learn as a next-generation platform combining cognitive science, FSRS memory scheduling, and frontier AI. Our mission is to empower students across Europe to learn deeply, calmly, and without exhausting all-nighters.",
      cta_banner_h: "Ready to accelerate your learning?",
      cta_banner_p: "Choose a deck and discover what you can recall.",
      cta_banner_btn: "Open App Workspace",
      auth_title: "Welcome to Tulis Learn",
      auth_sub: "Sign in to sync your decks and track your FSRS spaced repetition progress.",
      auth_email: "Email address",
      auth_pass: "Password",
      auth_submit: "Sign In",
      auth_quick_start_btn: "⚡ Quick Start (Instant Access)",
      card_question_tag: "QUESTION",
      card_answer_tag: "ANSWER",
      card_hint_flip: "Click card to reveal answer",
      card_hint_back: "Click to return to question",
      study_help: "Test your active recall before flipping the card.",
      footer_contact_ask: "Building or partnering in EdTech?",
      quiz_score: "Correct: ",
      quiz_next: "Next Question",
      quiz_finish: "View Results",
      tech_eyebrow: "COGNITIVE ENGINE · AI ARCHITECTURE",
      tech_title: "Advanced Semantic Pipeline.<br />From Messy Notes to Long-Term Memory.",
      tech_intro: "Combine flashcards with adaptive FSRS schedules, explore shared words in the concept graph and generate practice questions with Claude 3.5.",
      tech_tag: "Cognitive Engine · AI Architecture",
      tech_feat1_h: "High-yield concepts, extracted in context",
      tech_feat1_p: "The parser turns pairs and simple definitions into flashcards. With your own key, generate questions from raw notes.",
      tech_feat2_h: "Socratic assistant guiding you toward answers",
      tech_feat2_p: "Adaptive progressive hints and mistake explanations foster first-principles understanding instead of rote memorization.",
      tech_feat3_h: "Control over study materials",
      tech_feat3_p: "Local parsing keeps notes on your device. AI generation requires your key and connects directly to Anthropic Claude API.",
      pipeline_title: "Cognitive Pipeline & AI Architecture",
      pipeline_badge: "⚡ Hybrid LLM Pipeline",
      pipe1_badge: "STEP 1 · Fast Ingestion",
      pipe1_h: "Ingestion & Chunking",
      pipe1_p: "Read text or TXT and CSV files containing question–answer pairs.",
      pipe2_badge: "STEP 2 · Deep Reasoning",
      pipe2_h: "Semantic Reasoning",
      pipe2_p: "Frontier Claude 3.5 Sonnet models analyze notes to extract atomic question-and-answer pairs and high-yield concepts.",
      pipe3_badge: "STEP 3 · Socratic Loop",
      pipe3_h: "Socratic Tutoring",
      pipe3_p: "Interactive Socratic tutoring guides you through complex concepts and clarifies reasoning gaps.",
      pipe4_badge: "STEP 4 · FSRS Scheduling",
      pipe4_h: "Memory Optimization",
      pipe4_p: "Adaptive Free Spaced Repetition Scheduler tracks memory stability across the Ebbinghaus forgetting curve.",
      tech_note: "The Tulis Learn architecture pairs frontier language models with an adaptive FSRS spaced repetition engine. Your decks and study progress remain secure.",
      testi_1_text: "“Passed my Gross Anatomy exam on the first attempt! I paste lecture notes and the AI engine distills high-yield concepts into atomic flashcards, saving me manual typing hours.”",
      testi_1_role: "Medicine (MD Candidate) · Jagiellonian University Medical College",
      testi_2_text: "“The FSRS algorithm paired with the rapid match mode is a total game-changer. I master algorithms and operating systems 3x faster than reading dry lecture slides.”",
      testi_2_role: "Computer Science · Warsaw University of Technology",
      testi_3_text: "“The volume of civil and administrative law for the bar exam is immense. Tulis Learn lets me review legal codes on my commute and test retention with quick adaptive quizzes.”",
      testi_3_role: "Trainee Attorney-at-Law · OIRP Wrocław",
      p1_f1: "Flashcards, Quizzes & Speed Match Mode",
      p1_f2: "In-browser FSRS spaced repetition engine",
      p1_f3: "Your personal deck library",
      p1_f4: "No ads & instant guest access",
      p2_f1: "Everything in Starter plan",
      p2_f2: "Smart AI extraction from notes",
      p2_f3: "Audio TTS pronunciation & auditory learning",
      p2_f4: "Unlimited decks in library",
      p2_f5: "Socratic assistant explaining conceptual errors",
      p3_f1: "Everything in Student Pro plan",
      p3_f2: "Shared team deck repository",
      p3_f3: "JSON, CSV and Anki export",
      p3_f4: "Dedicated priority support & high-tier API",
      faq_q1: "How does Tulis Learn help you retain knowledge faster?",
      faq_a1: "We combine two empirically proven cognitive techniques: Active Recall and the FSRS spaced repetition algorithm. Instead of passively re-reading textbooks, you train your brain to actively retrieve information, scheduled at the mathematically optimal forgetting curve interval.",
      faq_q2: "How does the FSRS algorithm differ from legacy Anki SM-2?",
      faq_a2: "FSRS models memory stability and difficulty from review ratings. Tulis Learn uses ts-fsrs; intervals depend on each flashcard’s review history.",
      faq_q3: "Can I upload my own lecture notes and documents?",
      faq_a3: "Yes! You can paste raw text, import text files (.txt, .csv), or click 'Smart AI Extraction' to instantly distill key definitions into active-recall question-and-answer pairs.",
      faq_q4: "Is my study material kept private and secure?",
      faq_a4: "The local parser runs on your device. In server mode, decks are saved to SQLite. Optional AI generation connects directly to Anthropic Claude API under strict confidentiality standards.",
      faq_q5: "Does Tulis Learn work on mobile devices and tablets?",
      faq_a5: "Yes, the platform is fully responsive and touch-optimized. You can review flashcards, take quizzes, and play the speed match game seamlessly on any mobile phone or tablet.",
      tab_graph: "Concept Graph",
      graph_title: "🕸️ Semantic Concept Map & Links",
      graph_reset: "↺ Recenter",
      graph_help: "Interactive concept graph of the active deck. Drag nodes, double-click to view flashcard.",
      socratic_btn: "💡 Socratic AI Assistant",
      socratic_feynman: "👶 Explain like I'm 5",
      socratic_mnemonic: "🧠 Mnemonic / Hook",
      socratic_question: "❓ Socratic Question",
      socratic_example: "🌍 Real-world Example",
      btn_print: "🖨️ Print (A4)",
      print_modal_title: "🖨️ Printable Flashcards (A4)",
      print_modal_sub: "Print-ready cards for offline study with cut and fold guides.",
      print_cards_in_deck: "flashcards in active deck",
      print_btn_action: "🖨️ Print now (Ctrl+P)",
      fsrs_modal_title: "🧠 Cognitive Analytics & FSRS Model",
      fsrs_modal_sub: "Hermann Ebbinghaus forgetting curve vs. Free Spaced Repetition Scheduler",
      fsrs_legend_ebbinghaus: "Ebbinghaus Curve (without reviews)",
      fsrs_legend_fsrs: "FSRS Curve (optimal reviews)",
      fsrs_m_stab_lbl: "Stability (S)",
      fsrs_m_stab_sub: "mean time to 90% retention",
      fsrs_m_diff_lbl: "Difficulty (D)",
      fsrs_m_diff_sub: "complexity rating",
      fsrs_m_ret_lbl: "Estimated Recall (R)",
      fsrs_m_ret_sub: "based on reviewed flashcards",
      fsrs_why_title: "Why does FSRS outperform traditional methods?",
      fsrs_why_desc: "FSRS dynamically models memory stability and difficulty for each concept. Reviews are scheduled precisely when retention approaches the target threshold.",
      btn_close: "Close",
      auth_tab_login: "Sign In",
      auth_tab_register: "Sign Up",
      auth_name: "Full Name",
      auth_btn_register: "Create Account",
      mgmt_deck_title: "Deck title",
      mgmt_title: "👤 Your Account & Deck Library",
      mgmt_sub: "Manage your study decks, repetition history, and learning progress.",
      mgmt_tab_decks: "📚 My Decks",
      mgmt_tab_history: "📊 Study History",
      mgmt_tab_profile: "👤 Profile & Account",
      mgmt_tab_backup: "💾 Backup & Export",
      mgmt_decks_hint: "All decks in the selected storage mode:",
      mgmt_btn_new_deck: "+ New Deck",
      mgmt_history_hint: "Study session activity recorded by the FSRS algorithm:",
      mgmt_btn_logout: "🚪 Log out",
      mgmt_backup_hint: "Download decks, history and FSRS schedules, or import a JSON backup:",
      mgmt_btn_download_backup: "📥 Download JSON Backup",
      mgmt_btn_import_backup: "📤 Import from JSON",
      tab_type: "Type-in",
      type_label: "Type answer from memory (Active Recall):",
      type_btn_check: "Check Answer (Enter)",
      type_btn_skip: "Reveal Answer",
      socratic_custom_ph: "Ask the AI tutor any question about this concept...",
      socratic_send_btn: "Ask 🚀",
      mgmt_heatmap_title: "STUDY ACTIVITY (LAST 14 DAYS)",
      ai_modal_title: "⚙️ Cognitive AI Models Configuration",
      ai_modal_sub: "Choose a Claude or Gemini model, your API key and generation temperature.",
      ai_status_label: "Active Platform Engine:",
      ai_status_desc: "Anthropic Claude 3.5 Sonnet & Haiku • Applied AI hybrid pipeline • Real-time extraction • Socratic tutoring.",
      ai_provider_label: "Select AI Provider:",
      ai_custom_key_label: "Your API key (Claude or Gemini, saved in this browser):",
      ai_key_hint: "Enter your Anthropic Claude API key (sk-ant-...) or Google Gemini key. Your key is saved locally in this browser and never touches our servers.",
      ai_temp_label: "Inference Temperature:",
      ai_btn_test: "⚡ Test Connection",
      ai_btn_save: "Save Settings",
      newsletter_badge: "NEW · COGNITIVE NEWSLETTER",
      newsletter_title: "📬 High-Retention Study Hacks in Your Inbox",
      newsletter_sub: "Weekly actionable insights: cognitive science, FSRS optimization, and acing the toughest exams without burnout.",
      newsletter_btn_sub: "Subscribe Free",
      footer_shortcuts_link: "⌨️ Keyboard Shortcuts (?)",
      footer_cookie_settings: "🍪 Cookie Settings",
      cookie_title: "Privacy & Cookie Preferences",
      cookie_desc: "We use local storage and essential cookies to persist language preferences, theme, and study decks in compliance with GDPR. No invasive tracking or advertising profiling.",
      cookie_privacy_link: "Privacy Policy",
      cookie_necessary: "Essential Only",
      cookie_accept_all: "Accept All",
      shortcuts_title: "⌨️ Keyboard Shortcuts",
      shortcuts_subtitle: "Instant platform control without lifting your hands from the keyboard",
      shortcut_space: "Flip active flashcard (Question / Answer)",
      shortcut_arrows: "Previous / Next card in deck",
      shortcut_fsrs: "FSRS rating (1: Again, 2: Hard, 3: Good, 4: Easy)",
      shortcut_enter: "Submit typed answer (Type-in Mode)",
      shortcut_f: "Switch to Flashcards mode",
      shortcut_q: "Switch to Quiz mode",
      shortcut_m: "Switch to Match Game mode",
      shortcut_t: "Switch to Type-in Active Recall mode",
      shortcut_g: "Open Concept Graph",
      shortcut_s: "Open Socratic AI Assistant",
      shortcut_question: "Toggle this keyboard shortcuts cheatsheet",
      shortcut_esc: "Close active modal dialog or assistant drawer",
      export_modal_title: "📤 Export Flashcard Deck",
      export_modal_sub: "Choose an export format tailored to your study workflow:",
      export_fmt_anki: "Anki Format (.txt / TSV) — ready for Anki / AnkiWeb import",
      export_fmt_json: "JSON Format (.json) — complete structured data & backup",
      export_fmt_csv: "Spreadsheet (.csv) — for Excel, Google Sheets & Numbers"
    }
  };

  let currentLang = "pl";
  const savedLang = preferences.getItem("tulis_lang");
  if (savedLang === "en" || (!savedLang && navigator.language && navigator.language.startsWith("en"))) {
    currentLang = "en";
  }

  function setLanguage(lang) {
    currentLang = lang;
    $("langPl").setAttribute("aria-pressed", String(lang === "pl"));
    $("langEn").setAttribute("aria-pressed", String(lang === "en"));
    preferences.setItem("tulis_lang", lang);
    document.documentElement.lang = lang;

    $("langPl").classList.toggle("active", lang === "pl");
    $("langEn").classList.toggle("active", lang === "en");

    document.querySelectorAll("[data-i18n]").forEach((el) => {
      const key = el.dataset.i18n;
      if (TRANSLATIONS[lang] && TRANSLATIONS[lang][key]) {
        if (el.id === "extractAiBtn") {
          $("extractAiBtnText").textContent = TRANSLATIONS[lang][key];
        } else if (key === "hero_desc" || key === "notes_help" || key === "tech_title" || key === "p2_f2") {
          el.innerHTML = TRANSLATIONS[lang][key];
        } else {
          const svg = el.querySelector("svg");
          if (svg) {
            const text = TRANSLATIONS[lang][key];
            if (el.firstChild === svg) {
              el.innerHTML = "";
              el.appendChild(svg);
              el.appendChild(document.createTextNode(text));
            } else {
              el.innerHTML = "";
              el.appendChild(document.createTextNode(text));
              el.appendChild(svg);
            }
          } else {
            el.textContent = TRANSLATIONS[lang][key];
          }
        }
      }
    });

    document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      el.placeholder = TRANSLATIONS[lang][el.dataset.i18nPlaceholder] || el.placeholder;
    });
    if (deck.length > 0) {
      renderCard();
    }
  }

  // Dark Mode Theme Logic
  const themeToggleBtn = $("themeToggleBtn");
  function applyTheme(isDark) {
    document.body.classList.toggle("dark-theme", isDark);
    if (themeToggleBtn) {
      themeToggleBtn.textContent = isDark ? "☀️" : "🌙";
      themeToggleBtn.setAttribute('aria-pressed', String(isDark));
      document.querySelector('meta[name="theme-color"]').content = isDark ? '#101b15' : '#f8faf7';
    }
    preferences.setItem("tulis_theme", isDark ? "dark" : "light");
  }
  const savedTheme = preferences.getItem("tulis_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(savedTheme === "dark" || (!savedTheme && prefersDark));

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", () => {
      const isDark = document.body.classList.contains("dark-theme");
      applyTheme(!isDark);
      if (typeof drawGraph === "function" && $("graph") && !$("graph").hidden) {
        const c = $("graphCanvas");
        if (c) drawGraph(c);
      }
    });
  }

  // Web Audio Synthesizer & Sound Effects (Zero Dependencies)
  let audioCtx = null;
  let soundEnabled = preferences.getItem("tulis_sound") !== "false";
  const soundToggleBtn = $("soundToggleBtn");

  function initAudio() {
    if (!audioCtx && (window.AudioContext || window.webkitAudioContext)) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
  }

  function updateSoundButton() {
    if (!soundToggleBtn) return;
    soundToggleBtn.textContent = soundEnabled ? "🔊" : "🔇";
    soundToggleBtn.setAttribute("aria-label", soundEnabled ? "Wycisz efekty dźwiękowe" : "Włącz efekty dźwiękowe");
    soundToggleBtn.title = soundEnabled ? "Efekty dźwiękowe włączone (kliknij by wyciszyć)" : "Efekty dźwiękowe wyciszone (kliknij by włączyć)";
  }
  updateSoundButton();

  if (soundToggleBtn) {
    soundToggleBtn.addEventListener("click", () => {
      soundEnabled = !soundEnabled;
      preferences.setItem("tulis_sound", String(soundEnabled));
      updateSoundButton();
      if (soundEnabled) playSound("correct");
    });
  }

  function playSound(type) {
    if (!soundEnabled) return;
    try {
      initAudio();
      if (!audioCtx) return;
      const now = audioCtx.currentTime;

      if (type === "flip") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(340, now);
        osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.08);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.08);
      } else if (type === "correct") {
        [523.25, 659.25].forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);
          gain.gain.setValueAtTime(0.09, now + idx * 0.08);
          gain.gain.linearRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.18);
        });
      } else if (type === "wrong") {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(140, now + 0.16);
        gain.gain.setValueAtTime(0.09, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.16);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.16);
      } else if (type === "complete" || type === "win") {
        [523.25, 659.25, 783.99, 1046.5].forEach((freq, idx) => {
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(freq, now + idx * 0.09);
          gain.gain.setValueAtTime(0.11, now + idx * 0.09);
          gain.gain.linearRampToValueAtTime(0.001, now + idx * 0.09 + 0.28);
          osc.connect(gain);
          gain.connect(audioCtx.destination);
          osc.start(now + idx * 0.09);
          osc.stop(now + idx * 0.09 + 0.28);
        });
      }
    } catch (e) {}
  }

  // Lightweight Physics Confetti Particle Engine
  function launchConfetti() {
    if (reducedMotion.matches) return;
    const canvas = $("confettiCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = "block";

    const colors = ["#107843", "#34d399", "#d97706", "#2563eb", "#8b5cf6", "#ec4899", "#f59e0b"];
    const particles = Array.from({ length: 60 }, () => ({
      x: canvas.width * 0.5 + (Math.random() - 0.5) * 160,
      y: canvas.height * 0.35 + (Math.random() - 0.5) * 80,
      vx: (Math.random() - 0.5) * 12,
      vy: (Math.random() - 0.85) * 13 - 3,
      size: Math.random() * 8 + 4,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
    }));

    const startTime = performance.now();
    const duration = 2200;

    function step(time) {
      const elapsed = time - startTime;
      if (elapsed > duration) {
        canvas.style.display = "none";
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const progress = elapsed / duration;

      particles.forEach((p) => {
        p.x += p.vx;
        p.vy += 0.38;
        p.y += p.vy;
        p.rot += p.rotSpeed;
        const alpha = Math.max(0, 1 - progress * 1.2);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rot * Math.PI) / 180);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx.restore();
      });

      requestAnimationFrame(step);
    }

    requestAnimationFrame(step);
  }

  // Interactive Concept Graph Engine
  let graphNodes = [];
  let graphEdges = [];
  let graphSimRunning = false;
  let draggedNode = null;
  let hoveredNode = null;
  let graphCanvasInitialized = false;

  function resizeGraph(canvas) {
    const parent = canvas.parentElement;
    const width = parent.clientWidth || 600;
    const height = parent.clientHeight || 340;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    canvas.dataset.ratio = ratio;
    canvas.getContext('2d').setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  function graphSize(canvas) { const ratio = Number(canvas.dataset.ratio || 1); return { width: canvas.width / ratio, height: canvas.height / ratio }; }
  function initConceptGraph() {
    const canvas = $("graphCanvas");
    if (!canvas) return;
    resizeGraph(canvas);

    const deckSel = $("deckSelector");
    const deckName = (deckSel && deckSel.selectedIndex >= 0 && deckSel.options[deckSel.selectedIndex])
      ? deckSel.options[deckSel.selectedIndex].text
      : "Talia";
    const width = graphSize(canvas).width;
    const height = graphSize(canvas).height;

    // Hub node
    graphNodes = [
      {
        id: "hub",
        label: deckName.replace(/^[^\w\s]+/, "").trim(),
        x: width / 2,
        y: height / 2,
        vx: 0,
        vy: 0,
        radius: 28,
        color: "#107843",
        textColor: "#ffffff",
        isHub: true
      }
    ];

    // Card nodes
    const count = deck.length;
    deck.forEach((card, idx) => {
      const angle = (idx / count) * 2 * Math.PI;
      const dist = Math.min(width, height) * 0.36;
      const shortLabel = card.question.split(" ").slice(0, 4).join(" ") + (card.question.split(" ").length > 4 ? "…" : "");
      graphNodes.push({
        id: idx,
        label: shortLabel,
        fullQuestion: card.question,
        fullAnswer: card.answer,
        x: width / 2 + Math.cos(angle) * dist + (Math.random() - 0.5) * 20,
        y: height / 2 + Math.sin(angle) * dist + (Math.random() - 0.5) * 20,
        vx: 0,
        vy: 0,
        radius: 20,
        color: "#d2eedc",
        textColor: "#132a1e",
        isHub: false
      });
    });

    // Edges from hub to cards
    graphEdges = [];
    for (let i = 1; i < graphNodes.length; i++) {
      graphEdges.push({ source: graphNodes[0], target: graphNodes[i], isHubEdge: true });
    }

    const wordSets = graphNodes.map(node => new Set(((node.fullQuestion || "") + " " + (node.fullAnswer || "")).toLowerCase().match(/\p{L}{5,}/gu) || []));
    // Lexical cross-edges between cards with common significant words
    for (let i = 1; i < graphNodes.length; i++) {
      for (let j = i + 1; j < graphNodes.length; j++) {
        const common = [...wordSets[i]].filter(word => wordSets[j].has(word));
        if (common.length >= 2) {
          graphEdges.push({ source: graphNodes[i], target: graphNodes[j], isHubEdge: false });
        }
      }
    }

    if (!graphCanvasInitialized) {
      setupGraphInteractivity(canvas);
      graphCanvasInitialized = true;
    }

    startGraphSimulation();
  }

  function startGraphSimulation() {
    if (graphSimRunning) return;
    graphSimRunning = true;
    let frames = 0;
    const maxFrames = reducedMotion.matches ? 1 : 120;

    function tick() {
      const canvas = $("graphCanvas");
      if (!canvas || !$("graph") || $("graph").hidden || document.hidden) {
        graphSimRunning = false;
        return;
      }
      frames++;

      const width = graphSize(canvas).width;
      const height = graphSize(canvas).height;

      // Spring forces for edges
      graphEdges.forEach(edge => {
        const dx = edge.target.x - edge.source.x;
        const dy = edge.target.y - edge.source.y;
        const dist = Math.hypot(dx, dy) || 1;
        const ideal = edge.isHubEdge ? Math.min(width, height) * 0.35 : 120;
        const force = (dist - ideal) * 0.035;
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;

        if (edge.source !== draggedNode && !edge.source.isHub) {
          edge.source.vx += fx;
          edge.source.vy += fy;
        }
        if (edge.target !== draggedNode) {
          edge.target.vx -= fx;
          edge.target.vy -= fy;
        }
      });

      // Repulsion between all nodes
      for (let i = 0; i < graphNodes.length; i++) {
        for (let j = i + 1; j < graphNodes.length; j++) {
          const a = graphNodes[i];
          const b = graphNodes[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dist = Math.hypot(dx, dy) || 1;
          if (dist < 180) {
            const rep = 800 / (dist * dist);
            const rx = (dx / dist) * rep;
            const ry = (dy / dist) * rep;
            if (a !== draggedNode && !a.isHub) { a.vx -= rx; a.vy -= ry; }
            if (b !== draggedNode && !b.isHub) { b.vx += rx; b.vy += ry; }
          }
        }
      }

      // Update positions & damping
      graphNodes.forEach(node => {
        if (node === draggedNode || node.isHub) return;
        node.vx *= 0.85;
        node.vy *= 0.85;
        node.x += node.vx;
        node.y += node.vy;

        node.x = Math.max(node.radius + 10, Math.min(width - node.radius - 10, node.x));
        node.y = Math.max(node.radius + 10, Math.min(height - node.radius - 10, node.y));
      });

      drawGraph(canvas);

      if (frames < maxFrames || draggedNode) {
        requestAnimationFrame(tick);
      } else {
        graphSimRunning = false;
      }
    }

    requestAnimationFrame(tick);
  }

  function drawGraph(canvas) {
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, graphSize(canvas).width, graphSize(canvas).height);
    const isDark = document.body.classList.contains("dark-theme");

    // Draw edges
    graphEdges.forEach(edge => {
      ctx.beginPath();
      ctx.moveTo(edge.source.x, edge.source.y);
      ctx.lineTo(edge.target.x, edge.target.y);
      const isHighlighted = (hoveredNode && (edge.source === hoveredNode || edge.target === hoveredNode));
      if (isHighlighted) {
        ctx.strokeStyle = "#107843";
        ctx.lineWidth = 2.5;
      } else if (edge.isHubEdge) {
        ctx.strokeStyle = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";
        ctx.lineWidth = 1.2;
      } else {
        ctx.strokeStyle = "#10784355";
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Draw nodes
    graphNodes.forEach(node => {
      const isHovered = node === hoveredNode;
      const isHub = node.isHub;

      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.radius + 6, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(16, 120, 67, 0.25)";
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
      ctx.fillStyle = isHub ? "#107843" : (isDark ? (isHovered ? "#1b4d32" : "#24352b") : (isHovered ? "#bce2cb" : "#e6f4ea"));
      ctx.fill();
      ctx.lineWidth = isHub ? 3 : (isHovered ? 2.5 : 1.5);
      ctx.strokeStyle = isHub ? "#0c5d33" : (isHovered ? "#107843" : (isDark ? "#354e3f" : "#bce2cb"));
      ctx.stroke();

      ctx.font = isHub ? "bold 11px system-ui, -apple-system, sans-serif" : "10px system-ui, -apple-system, sans-serif";
      ctx.fillStyle = isHub ? "#ffffff" : (isDark ? "#e1e7e4" : "#132a1e");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      if (isHub) {
        ctx.fillText(node.label, node.x, node.y);
      } else {
        ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
        ctx.fillText(String(node.id + 1), node.x, node.y);
        ctx.font = "10px system-ui, -apple-system, sans-serif";
        ctx.fillStyle = isDark ? "#a7b7ae" : "#4a5d51";
        ctx.fillText(node.label, node.x, node.y + node.radius + 12);
      }
    });
  }

  function setupGraphInteractivity(canvas) {
    let isDown = false;

    function getNodeAt(x, y) {
      for (let i = graphNodes.length - 1; i >= 0; i--) {
        const n = graphNodes[i];
        if (Math.hypot(n.x - x, n.y - y) <= n.radius + 6) return n;
      }
      return null;
    }

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      return {
        x: (clientX - rect.left) * (graphSize(canvas).width / rect.width),
        y: (clientY - rect.top) * (graphSize(canvas).height / rect.height)
      };
    }

    canvas.addEventListener("pointerdown", (e) => {
      const pos = getPos(e);
      draggedNode = getNodeAt(pos.x, pos.y);
      isDown = true;
      canvas.setPointerCapture(e.pointerId);
      if (draggedNode) {
        startGraphSimulation();
      }
    });

    canvas.addEventListener("pointermove", (e) => {
      const pos = getPos(e);
      if (isDown && draggedNode) {
        draggedNode.x = pos.x;
        draggedNode.y = pos.y;
        drawGraph(canvas);
      } else if (!isDown && $("graph") && !$("graph").hidden) {
        const n = getNodeAt(pos.x, pos.y);
        if (n !== hoveredNode) {
          hoveredNode = n;
          drawGraph(canvas);
          const tooltip = $("graphTooltip");
          if (tooltip) {
            if (n && !n.isHub) {
              tooltip.style.display = "block";
              tooltip.innerHTML = `<strong>#${n.id + 1}: ${escapeHtml(n.fullQuestion)}</strong><br/><span style="opacity: 0.85;">💡 ${escapeHtml(n.fullAnswer)}</span><br/><small style="color: var(--mint); opacity: 0.9;">Kliknij dwukrotnie, aby przejść do tej fiszki</small>`;
            } else if (n && n.isHub) {
              tooltip.style.display = "block";
              tooltip.innerHTML = `<strong>${escapeHtml(n.label)}</strong> • Główny węzeł talii (${deck.length} powiązanych fiszek)`;
            } else {
              tooltip.style.display = "none";
            }
          }
        }
      }
    });

    canvas.addEventListener("pointerup", () => {
      isDown = false;
      draggedNode = null;
    });

    canvas.addEventListener("pointercancel", () => { isDown = false; draggedNode = null; });
    canvas.addEventListener("dblclick", (e) => {
      const pos = getPos(e);
      const n = getNodeAt(pos.x, pos.y);
      if (n && !n.isHub && typeof n.id === "number") {
        cardIndex = n.id;
        revealed = false;
        selectMode("cards");
        renderCard();
      }
    });

    const resetBtn = $("resetGraphBtn");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        initConceptGraph();
      });
    }

    window.addEventListener("resize", () => {
      if ($("graph") && !$("graph").hidden) {
        initConceptGraph();
      }
    });
  }

  function renderConceptGraph() {
    initConceptGraph();
    const list = $("graphAccessibleList");
    list.innerHTML = '<details><summary>' + (currentLang === 'en' ? 'Browse concepts and answers (word overlap links)' : 'Przeglądaj pojęcia i odpowiedzi (powiązania wspólnych słów)') + '</summary><ul>' + deck.map((card, index) => '<li><button type="button" data-card="' + index + '">' + escapeHtml(card.question) + '</button><p>' + escapeHtml(card.answer) + '</p></li>').join('') + '</ul></details>';
    list.querySelectorAll('[data-card]').forEach(button => button.addEventListener('click', () => { cardIndex = Number(button.dataset.card); revealed = false; selectMode('cards'); $("flash").focus(); }));
  }

  // Socratic AI Tutor Drawer
  function initSocraticTutor() {
    const socraticBtn = $("socraticBtn");
    const drawer = $("socraticDrawer");
    const closeBtn = $("socraticCloseBtn");
    const responseBox = $("socraticResponse");

    if (socraticBtn && drawer) {
      socraticBtn.addEventListener("click", () => {
        const isHidden = drawer.style.display === "none";
        drawer.style.display = isHidden ? "block" : "none";
        socraticBtn.setAttribute("aria-expanded", String(isHidden));
      });
    }

    if (closeBtn && drawer) {
      closeBtn.addEventListener("click", () => {
        drawer.style.display = "none";
        if (socraticBtn) socraticBtn.setAttribute("aria-expanded", "false");
      });
    }

    let tutorRequest = 0;
    async function askSocraticTutor(promptType, customQuestion = "") {
      const requestId = ++tutorRequest;
      const card = deck[cardIndex];
      if (!card || !responseBox) return;

      responseBox.style.display = "block";
      responseBox.innerHTML = `<span style="color: var(--muted); font-size: 12px;">⏳ Analiza semantyczna modelu kognitywnego (Claude 3.5 Sonnet)...</span>`;

      const q = card.question;
      const a = card.answer;
      let content = "";

      // Attempt live Claude or Gemini generation
      try {
        const customKey = aiKeys.get();
        const activeKey = customKey;
        const activeModel = preferences.getItem("tulis_ai_model") || "claude-3-5-sonnet-20241022";
        if (!activeKey) throw new Error("API key required");

        let aiPrompt = "";
        if (customQuestion) {
          aiPrompt = currentLang === "en"
            ? `You are the Socratic AI Tutor of Tulis Learn. The student is reviewing this flashcard: Question: "${q}", Answer: "${a}". The student asked: "${customQuestion}". Answer concisely (2-4 sentences) using Socratic guidance and relatable analogies so they grasp the first principles.`
            : `Jesteś inteligentnym sokratejskim korepetytorem AI w Tulis Learn. Uczeń powtarza fiszkę: Pytanie: "${q}", Odpowiedź: "${a}". Uczeń zadał pytanie: "${customQuestion}". Odpowiedz zwięźle i precyzyjnie (2-4 zdania), używając metody sokratejskiej i analogii, aby sam zrozumiał sedno.`;
        } else if (promptType === "feynman") {
          aiPrompt = currentLang === "en"
            ? `Explain this concept to a 5-year-old using a vivid everyday analogy: Question: "${q}", Answer: "${a}". Max 3 sentences.`
            : `Wyjaśnij to pojęcie jak 5-letniemu dziecku, używając prostej analogii z życia codziennego (Technika Feynmana): Pytanie: "${q}", Odpowiedź: "${a}". Maksymalnie 3 zdania.`;
        } else if (promptType === "mnemonic") {
          aiPrompt = currentLang === "en"
            ? `Create a memorable mnemonic hook and rhyme for: Question: "${q}", Answer: "${a}".`
            : `Stwórz chwytliwą mnemotechnikę i kotwicę pamięciową dla: Pytanie: "${q}", Odpowiedź: "${a}".`;
        } else if (promptType === "socratic") {
          aiPrompt = currentLang === "en"
            ? `Formulate two thought-provoking Socratic questions that challenge assumptions about: "${q}" -> "${a}".`
            : `Zadaj dwa głębokie pytania sokratejskie naprowadzające na zrozumienie: "${q}" -> "${a}".`;
        } else if (promptType === "example") {
          aiPrompt = currentLang === "en"
            ? `Provide one concrete, real-world industry or scientific application of: "${q}" -> "${a}".`
            : `Podaj jeden konkretny, praktyczny przykład z przemysłu lub nauki obrazujący: "${q}" -> "${a}".`;
        }

        let response;
        if (activeModel.startsWith("claude")) {
          response = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": activeKey,
              "anthropic-version": "2023-06-01",
              "anthropic-dangerous-direct-browser-access": "true"
            },
            body: JSON.stringify({
              model: activeModel,
              max_tokens: 600,
              temperature: Number(preferences.getItem("tulis_ai_temperature") || 0.2),
              messages: [{ role: "user", content: aiPrompt }]
            }),
            signal: AbortSignal.timeout(10000)
          });
        } else {
          const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${activeModel}:generateContent`;
          response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-goog-api-key": activeKey },
            body: JSON.stringify({ contents: [{ parts: [{ text: aiPrompt }] }], generationConfig: { temperature: Number(preferences.getItem("tulis_ai_temperature") || 0.2) } }),
            signal: AbortSignal.timeout(10000)
          });
        }

        if (response.ok) {
          const data = await response.json();
          const generated = activeModel.startsWith("claude")
            ? data.content?.[0]?.text
            : data.candidates?.[0]?.content?.parts?.[0]?.text;
          if (generated && generated.trim().length > 10) {
            content = `💡 <strong>${customQuestion ? 'Odpowiedź Asystenta AI:' : ('Generacja AI (' + escapeHtml(activeModel) + '):')}</strong><br/>${escapeHtml(generated.trim()).replace(/\n/g, '<br/>')}`;
          }
        }
      } catch (e) {
        // Offer an explicitly local exercise when generation is unavailable.
      }

      if (!content) {
        content = currentLang === 'en'
          ? '<strong>Active recall exercise</strong><br/>Explain this concept in your own words: ' + escapeHtml(q) + '<br/>Give one example, then compare your explanation with the flashcard answer. Configure your own API key (Claude or Gemini) for generated guidance.'
          : '<strong>Ćwiczenie aktywnego przypominania</strong><br/>Wyjaśnij własnymi słowami: ' + escapeHtml(q) + '<br/>Podaj przykład i porównaj wyjaśnienie z odpowiedzią na fiszce. Skonfiguruj własny klucz API (Claude lub Gemini), aby uzyskać wskazówki AI.';
      }


      if (requestId !== tutorRequest || deck[cardIndex] !== card) return;
      responseBox.innerHTML = `
        <div style="font-size: 13px; line-height: 1.55; color: var(--ink);">
          ${content}
        </div>


      `;
      playSound("correct");
    }

    document.querySelectorAll(".socratic-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        askSocraticTutor(chip.dataset.prompt);
      });
    });

    const customInput = $("socraticCustomInput");
    const sendBtn = $("socraticSendBtn");
    if (sendBtn && customInput) {
      const handleCustomSend = () => {
        const text = customInput.value.trim();
        if (!text) return;
        customInput.value = "";
        askSocraticTutor("custom", text);
      };
      sendBtn.addEventListener("click", handleCustomSend);
      customInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleCustomSend();
        }
      });
    }
  }

  // Printable Flashcard Sheet Generator
  function initPrintDeck() {
    const printBtn = $("printDeckBtn");
    const triggerBtn = $("triggerPrintBtn");
    const container = $("printSheetContainer");
    const countEl = $("printCardsCount");

    function populatePrintSheet() {
      if (!container) return;
      if (countEl) countEl.textContent = String(deck.length);
      container.innerHTML = deck.map((c, i) => `
        <div class="print-card-box">
          <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--muted); margin-bottom: 8px; font-weight: 700;">
            <span>TULIS LEARN • FISZKA #${i + 1}</span>
            <span>✂️ ZAGNIJ / ROZETNIJ</span>
          </div>
          <div class="print-card-q">${escapeHtml(c.question)}</div>
          <div class="print-card-a">💡 <strong>Odp:</strong> ${escapeHtml(c.answer)}</div>
        </div>
      `).join("");
    }

    if (printBtn) {
      printBtn.addEventListener("click", () => {
        populatePrintSheet();
      });
    }

    if (triggerBtn) {
      triggerBtn.addEventListener("click", () => {
        populatePrintSheet();
        window.print();
      });
    }
  }

  function updateFsrsModalMetrics() {
    try {
      const metrics = reviewStore().metrics(deck);
      $("fsrsMetricStability").textContent = metrics.stability === null ? '—' : metrics.stability.toFixed(1) + (currentLang === 'en' ? ' days' : ' dni');
      $("fsrsMetricDifficulty").textContent = metrics.difficulty === null ? '—' : metrics.difficulty.toFixed(1) + ' / 10';
      $("fsrsMetricRetention").textContent = metrics.retrievability === null ? '—' : (metrics.retrievability * 100).toFixed(1) + '%';
      if ($("masteryRate")) $("masteryRate").textContent = $("fsrsMetricRetention").textContent;
    } catch { /* No invented metrics when persistence is unavailable. */ }
  }

  // Audio Text-To-Speech (TTS)
  const ttsBtn = $("ttsBtn");
  if (ttsBtn) {
    ttsBtn.addEventListener("click", () => {
      const card = deck[cardIndex];
      if (!card || !window.speechSynthesis) return;
      const textToSpeak = revealed ? card.answer : card.question;
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(textToSpeak);
      utterance.lang = currentLang === "en" ? "en-US" : "pl-PL";
      utterance.rate = 1.0;
      window.speechSynthesis.speak(utterance);
    });
  }

  // Fisher–Yates randomizes choices without mutating the user's deck.
  function shuffle(items) {
    const result = [...items];
    for (let i = result.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }

  function showToast(text, type = "info", duration = 4000) {
    const container = $("toastContainer");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    let icon = "ℹ️";
    if (type === "success") icon = "✓";
    else if (type === "error") icon = "⚠️";

    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <div class="toast-body">${escapeHtml(String(text))}</div>
      <button class="toast-close" type="button" aria-label="Zamknij powiadomienie">✕</button>
    `;

    const closeBtn = toast.querySelector(".toast-close");
    const removeToast = () => {
      toast.classList.remove("is-visible");
      toast.classList.add("is-leaving");
      setTimeout(() => {
        if (toast.parentElement) toast.parentElement.removeChild(toast);
      }, 300);
    };

    if (closeBtn) closeBtn.addEventListener("click", removeToast);
    container.appendChild(toast);

    requestAnimationFrame(() => {
      toast.classList.add("is-visible");
    });

    if (duration > 0) {
      setTimeout(removeToast, duration);
    }
  }

  function showMessage(text, error = false) {
    if ($("message")) {
      $("message").textContent = text;
      $("message").classList.toggle("error", error);
    }
    showToast(text, error ? "error" : "success");
  }

  function renderCard() {
    const card = deck[cardIndex];
    if (!card) return;
    try {
      const preview = reviewStore().preview(card);
      document.querySelectorAll('.srs-btn').forEach(btn => {
        const due = preview[TulisReviews.grades[btn.dataset.srs]].card.due;
        const minutes = Math.max(1, Math.round((due - Date.now()) / 60000));
        const interval = minutes < 60 ? minutes + ' min' : minutes < 1440 ? Math.round(minutes / 60) + ' h' : Math.round(minutes / 1440) + (currentLang === 'en' ? ' d' : ' dni');
        const labels = currentLang === 'en' ? { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' } : { again: 'Jeszcze raz', hard: 'Trudne', good: 'Dobre', easy: 'Łatwe' };
        btn.textContent = labels[btn.dataset.srs] + ' (+' + interval + ')';
        btn.disabled = ratingPending;
      });
    } catch { /* A failed write is surfaced by the rating handler. */ }
    const t = TRANSLATIONS[currentLang];
    $("cardText").textContent = revealed ? card.answer : card.question;
    $("cardTag").textContent = revealed ? t.card_answer_tag : t.card_question_tag;
    $("cardHint").textContent = revealed ? t.card_hint_back : t.card_hint_flip;
    $("flash").classList.toggle("is-revealed", revealed);
    $("flash").setAttribute("aria-pressed", String(revealed));

    const counterText = currentLang === "en"
      ? `Card ${cardIndex + 1} of ${deck.length}`
      : `Fiszka ${cardIndex + 1} z ${deck.length}`;
    $("counter").textContent = counterText;
    $("prev").disabled = cardIndex === 0;
    $("next").disabled = cardIndex === deck.length - 1;
    $("cardProgress").style.width = `${((cardIndex + 1) / deck.length) * 100}%`;

    // Show SRS Panel only when answer is flipped/revealed
    const srsPanel = $("srsPanel");
    if (srsPanel) {
      srsPanel.style.display = revealed ? "block" : "none";
    }
  }

  function selectMode(mode) {
    if (mode === "quiz" && new Set(deck.map((card) => card.answer)).size < 2) {
      showMessage(
        currentLang === "en"
          ? "Quiz requires at least two distinct answers. Add more lines and recompile."
          : "Quiz wymaga co najmniej dwóch różnych odpowiedzi. Dodaj je do notatek i wygeneruj zestaw.",
        true,
      );
      return false;
    }
    if (mode === "match" && deck.length < 3) {
      showMessage(
        currentLang === "en"
          ? "Match game requires at least 3 cards in the deck."
          : "Tryb dopasowywania wymaga co najmniej 3 fiszek w talii.",
        true,
      );
      return false;
    }
    if (mode === "type" && deck.length === 0) {
      showMessage(currentLang === "en" ? "Deck is empty." : "Talia jest pusta.", true);
      return false;
    }

    if (matchGame?.timerInterval) clearInterval(matchGame.timerInterval);
    currentMode = mode;
    const cardsSelected = mode === "cards";
    const quizSelected = mode === "quiz";
    const matchSelected = mode === "match";
    const typeSelected = mode === "type";
    const graphSelected = mode === "graph";

    $("cards").hidden = !cardsSelected;
    $("quiz").hidden = !quizSelected;
    $("match").hidden = !matchSelected;
    if ($("typeRecall")) $("typeRecall").hidden = !typeSelected;
    if ($("graph")) $("graph").hidden = !graphSelected;

    for (const [id, selected] of [
      ["cardMode", cardsSelected],
      ["quizMode", quizSelected],
      ["matchMode", matchSelected],
      ["typeMode", typeSelected],
      ["graphMode", graphSelected],
    ]) {
      const el = $(id);
      if (el) {
        el.setAttribute("aria-selected", String(selected));
        el.tabIndex = selected ? 0 : -1;
      }
    }

    if (cardsSelected) renderCard();
    else if (quizSelected && !quiz) startQuiz();
    else if (matchSelected) startMatchGame();
    else if (typeSelected) startTypeMode();
    else if (graphSelected) renderConceptGraph();

    return true;
  }

  // Type-In Active Recall Mode
  let typeIndex = 0;
  let typeCorrectCount = 0;
  let typeAnswerChecked = false;

  function startTypeMode() {
    typeIndex = 0;
    typeCorrectCount = 0;
    typeAnswerChecked = false;
    renderTypeCard();
  }

  function renderTypeCard() {
    if (!deck.length) return;
    const card = deck[typeIndex];
    if (!card) return;

    if ($("typeQuestion")) $("typeQuestion").textContent = card.question;
    if ($("typeCounter")) $("typeCounter").textContent = `${String(typeIndex + 1).padStart(2, "0")} / ${String(deck.length).padStart(2, "0")}`;
    if ($("typeInput")) {
      $("typeInput").value = "";
      $("typeInput").disabled = false;
      setTimeout(() => $("typeInput").focus(), 50);
    }
    const fb = $("typeFeedback");
    if (fb) {
      fb.style.display = "none";
      fb.className = "type-feedback";
      fb.innerHTML = "";
    }
    typeAnswerChecked = false;
    if ($("typeCheckBtn")) $("typeCheckBtn").textContent = currentLang === "en" ? "Check Answer (Enter)" : "Sprawdź odpowiedź (Enter)";
  }

  function checkTypeAnswer(skipped = false) {
    if (typeAnswerChecked) {
      if (typeIndex < deck.length - 1) {
        typeIndex++;
        renderTypeCard();
      } else {
        finishTypeMode();
      }
      return;
    }

    const card = deck[typeIndex];
    if (!card) return;

    const userVal = ($("typeInput") ? $("typeInput").value : "").trim();
    if (!userVal) {
      showMessage(currentLang === "en" ? "Please type your answer first." : "Wpisz swoją odpowiedź przed sprawdzeniem.", true);
      return;
    }

    const fb = $("typeFeedback");
    const cleanUser = userVal.toLowerCase().replace(/[.,!?;:()]/g, "").trim();
    const cleanExp = card.answer.toLowerCase().replace(/[.,!?;:()]/g, "").trim();

    const isExact = !skipped && cleanUser === cleanExp;
    const userWords = new Set(cleanUser.split(/\s+/));
    const expectedWords = new Set(cleanExp.split(/\s+/));
    const overlap = [...userWords].filter(word => expectedWords.has(word)).length;
    const isClose = !skipped && !isExact && cleanUser.length >= 8 && overlap / Math.max(userWords.size, expectedWords.size) >= 0.75;

    typeAnswerChecked = true;
    if ($("typeInput")) $("typeInput").disabled = true;

    if (isExact) {
      typeCorrectCount++;
      playSound("correct");
      if (fb) {
        fb.style.display = "block";
        fb.className = "type-feedback feedback-exact";
        fb.innerHTML = `<strong>🌟 ${currentLang === "en" ? "Flawless! Exact match!" : "Bezbłędnie! Dokładne dopasowanie!"}</strong><div style="margin-top: 6px; font-weight: 600;">✓ ${escapeHtml(card.answer)}</div><div class="feedback-sub" style="font-size: 11px; margin-top: 4px; color: #166534;">${currentLang === "en" ? "Answer comparison only; rate the flashcard to schedule a review." : "Ocena odpowiedzi; oceń fiszkę, aby zaplanować powtórkę."}</div>`;
      }
    } else if (isClose) {
      typeCorrectCount += 0.5;
      playSound("correct");
      if (fb) {
        fb.style.display = "block";
        fb.className = "type-feedback feedback-close";
        fb.innerHTML = `<strong>🟡 ${currentLang === "en" ? "Very close! Check nuances:" : "Bardzo blisko! Zwróć uwagę na niuanse:"}</strong><div style="margin-top: 6px;">Twoja: <span class="type-diff-user">${escapeHtml(userVal)}</span> ➔ Wzorcowa: <span class="type-diff-expected">${escapeHtml(card.answer)}</span></div>`;
      }
    } else {
      playSound("wrong");
      if (fb) {
        fb.style.display = "block";
        fb.className = "type-feedback feedback-wrong";
        fb.innerHTML = `<strong>❌ ${currentLang === "en" ? "Needs review:" : "Do powtórzenia:"}</strong><div style="margin-top: 6px;">Twoja odpowiedź: <span class="type-diff-user">${escapeHtml(userVal)}</span><br/>Wzorcowa odpowiedź: <span class="type-diff-expected">${escapeHtml(card.answer)}</span></div><div class="feedback-sub" style="font-size: 11px; margin-top: 4px; color: #7f1d1d;">${currentLang === "en" ? "Review this concept again." : "Powtórz to pojęcie."}</div>`;
      }
    }

    if ($("typeCheckBtn")) $("typeCheckBtn").textContent = (typeIndex < deck.length - 1)
      ? (currentLang === "en" ? "Next Card ➔" : "Następna fiszka ➔")
      : (currentLang === "en" ? "Finish Session ✓" : "Zakończ sesję ✓");
  }

  function finishTypeMode() {
    playSound("win");
    launchConfetti();
    const scoreText = `${Math.round(typeCorrectCount)}/${deck.length}`;
    logStudySession("Wpisywanie", scoreText);
    showMessage(
      currentLang === "en"
        ? `🎉 Great job! Type-in session completed (${scoreText} correct). Progress recorded!`
        : `🎉 Świetna sesja! Ukończono tryb wpisywania (${scoreText} poprawnych). Wynik zapisany w FSRS!`
    );
    if ($("typeCheckBtn")) $("typeCheckBtn").textContent = currentLang === "en" ? "Restart Session" : "Powtórz sesję";
    typeAnswerChecked = false;
    startTypeMode();
  }

  function buildDeck() {
    const input = $("notes").value;
    const parsed = [];
    const invalid = [];
    if (input.length > limits.characters) {
      showMessage(
        currentLang === "en"
          ? `Please shorten notes to ${limits.characters.toLocaleString("en-US")} characters.`
          : `Skróć notatki do ${limits.characters.toLocaleString("pl-PL")} znaków. Poprzedni zestaw pozostaje dostępny.`,
        true,
      );
      return false;
    }
    input.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const separator = line.indexOf("|");
      const question = separator < 0 ? "" : line.slice(0, separator).trim();
      const answer = separator < 0 ? "" : line.slice(separator + 1).trim();
      if (!question || !answer) invalid.push(index + 1);
      else parsed.push({ question, answer });
    });
    if (invalid.length || !parsed.length) {
      const detail = invalid.length
        ? (currentLang === "en"
            ? `Check lines: ${invalid.slice(0, 6).join(", ")}${invalid.length > 6 ? "…" : ""}.`
            : `Sprawdź wiersze: ${invalid.slice(0, 6).join(", ")}${invalid.length > 6 ? "…" : ""}.`)
        : (currentLang === "en" ? "Enter at least one question-answer pair or run AI extraction." : "Wpisz przynajmniej jedną parę lub kliknij ekstrakcję AI.");
      showMessage(
        currentLang === "en"
          ? `${detail} Use format: question | answer.`
          : `${detail} Użyj formatu: pytanie | odpowiedź.`,
        true,
      );
      return false;
    }
    if (parsed.length > limits.cards) {
      showMessage(
        currentLang === "en"
          ? `Deck can have max ${limits.cards} cards. Remove ${parsed.length - limits.cards} lines.`
          : `Zestaw może mieć maksymalnie ${limits.cards} fiszek. Usuń ${parsed.length - limits.cards} wierszy i spróbuj ponownie.`,
        true,
      );
      return false;
    }
    deck = parsed;
    cardIndex = 0;
    revealed = false;
    quiz = null;
    $("notes").setAttribute("aria-invalid", "false");
    selectMode("cards");
    showMessage(
      currentLang === "en"
        ? `Ready! Loaded ${deck.length} flashcards. Ready for review, quiz or match game.`
        : `Gotowe! Załadowano ${deck.length} fiszek. Gotowe do powtórki, quizu lub gry w dopasowywanie.`,
    );
    return true;
  }

  // Quiz Engine
  function startQuiz() {
    quiz = { questions: shuffle(deck), index: 0, correct: 0, answered: false };
    $("quizRound").hidden = false;
    $("quizResult").hidden = true;
    renderQuestion();
  }

  function renderQuestion() {
    quiz.answered = false;
    const card = quiz.questions[quiz.index];
    $("question").textContent = card.question;
    $("quizCounter").textContent = currentLang === "en"
      ? `Question ${quiz.index + 1} of ${deck.length}`
      : `Pytanie ${quiz.index + 1} z ${deck.length}`;
    $("score").textContent = `${TRANSLATIONS[currentLang].quiz_score}${quiz.correct}`;
    $("feedback").textContent = "";
    $("feedback").classList.remove("error");
    $("nextQuestion").disabled = true;
    $("nextQuestionLabel").textContent =
      quiz.index === deck.length - 1
        ? TRANSLATIONS[currentLang].quiz_finish
        : TRANSLATIONS[currentLang].quiz_next;
    const alternatives = shuffle(
      [...new Set(deck.map((item) => item.answer))].filter(
        (answer) => answer !== card.answer,
      ),
    ).slice(0, 3);
    const choices = shuffle([card.answer, ...alternatives]);
    $("options").replaceChildren();
    choices.forEach((answer, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "quiz-option";
      const letter = document.createElement("span");
      letter.className = "option-letter";
      letter.textContent = String.fromCharCode(65 + index);
      letter.setAttribute("aria-hidden", "true");
      const label = document.createElement("span");
      label.textContent = answer;
      button.append(letter, label);
      button.addEventListener("click", () =>
        answerQuestion(answer, card, button),
      );
      $("options").append(button);
    });
  }

  function answerQuestion(answer, card, chosenButton) {
    if (quiz.answered) return;
    quiz.answered = true;
    const right = answer === card.answer;
    if (right) {
      quiz.correct++;
      playSound("correct");
    } else {
      playSound("wrong");
    }
    for (const button of $("options").children) {
      const isCorrect = button.children[1].textContent === card.answer;
      button.disabled = true;
      button.classList.toggle("correct", isCorrect);
      button.classList.toggle("incorrect", button === chosenButton && !right);
      if (isCorrect || (button === chosenButton && !right)) {
        const status = document.createElement("span");
        status.className = "option-state";
        status.textContent = isCorrect ? "✓" : "×";
        status.setAttribute(
          "aria-label",
          isCorrect ? "Correct" : "Incorrect",
        );
        button.append(status);
      }
    }
    $("feedback").textContent = right
      ? (currentLang === "en" ? "Great answer! Spot on." : "Dobra odpowiedź! Tak trzymaj.")
      : (currentLang === "en" ? `Learning opportunity! Correct answer: ${card.answer}` : `Jeszcze jedna okazja do nauki. Poprawna odpowiedź: ${card.answer}`);
    $("feedback").classList.toggle("error", !right);
    $("score").textContent = `${TRANSLATIONS[currentLang].quiz_score}${quiz.correct}`;
    $("nextQuestion").disabled = false;
    $("nextQuestion").focus({ preventScroll: true });
  }

  // Interactive Match Game (Memory Speed Pairing)
  function startMatchGame() {
    if (matchGame?.timerInterval) clearInterval(matchGame.timerInterval);
    const pairCount = Math.min(4, deck.length);
    const sampleCards = shuffle(deck).slice(0, pairCount);
    const tiles = [];

    sampleCards.forEach((c, idx) => {
      tiles.push({ id: idx, type: "q", text: c.question });
      tiles.push({ id: idx, type: "a", text: c.answer });
    });

    const shuffledTiles = shuffle(tiles);
    const grid = $("matchGrid");
    grid.innerHTML = "";
    $("matchWin").style.display = "none";
    grid.style.display = "grid";

    matchGame = {
      selected: null,
      matchedPairs: 0,
      totalPairs: pairCount,
      startTime: Date.now(),
      timerInterval: null
    };

    $("matchScore").textContent = "0";
    $("matchTotal").textContent = String(pairCount);

    clearInterval(matchGame.timerInterval);
    matchGame.timerInterval = setInterval(() => {
      if (!matchGame) return;
      const elapsed = ((Date.now() - matchGame.startTime) / 1000).toFixed(1);
      $("matchTimer").textContent = elapsed;
    }, 100);

    shuffledTiles.forEach((tile) => {
      const tileEl = document.createElement("button");
      tileEl.type = "button";
      tileEl.setAttribute("aria-pressed", "false");
      tileEl.className = "match-card";
      tileEl.textContent = tile.text;
      tileEl.addEventListener("click", () => handleTileClick(tile, tileEl));
      grid.appendChild(tileEl);
    });
  }

  function handleTileClick(tile, tileEl) {
    if (!matchGame || matchGame.locked || tileEl.classList.contains("matched") || tileEl.classList.contains("selected")) return;

    if (!matchGame.selected) {
      matchGame.selected = { tile, el: tileEl };
      tileEl.classList.add("selected");
      tileEl.setAttribute("aria-pressed", "true");
    } else {
      const prev = matchGame.selected;
      if (prev.tile.type !== tile.type && prev.tile.id === tile.id) {
        // MATCH!
        playSound("correct");
        tileEl.classList.add("matched");
        tileEl.disabled = true;
        prev.el.disabled = true;
        tileEl.setAttribute("aria-pressed", "true");
        prev.el.classList.remove("selected");
        prev.el.classList.add("matched");
        matchGame.selected = null;
        matchGame.matchedPairs++;
        $("matchScore").textContent = String(matchGame.matchedPairs);

        if (matchGame.matchedPairs === matchGame.totalPairs) {
          clearInterval(matchGame.timerInterval);
          logStudySession("Dopasowywanie", "Ukończono");
          const finalTime = ((Date.now() - matchGame.startTime) / 1000).toFixed(1);
          playSound("win");
          launchConfetti();
          const completedGame = matchGame;
          setTimeout(() => {
            if (matchGame !== completedGame) return;
            $("matchGrid").style.display = "none";
            $("matchWin").style.display = "block";
            $("matchWinText").textContent = currentLang === "en"
              ? `Completed in ${finalTime} seconds! High score saved to your profile.`
              : `Czas ukończenia: ${finalTime} sekundy! Twój wynik został zapisany.`;
          }, 350);
        }
      } else {
        const activeGame = matchGame;
        activeGame.locked = true;
        // WRONG PAIR
        playSound("wrong");
        tileEl.classList.add("wrong");
        prev.el.classList.add("wrong");
        setTimeout(() => {
          tileEl.classList.remove("wrong", "selected");
          prev.el.classList.remove("wrong", "selected");
          tileEl.setAttribute("aria-pressed", "false");
          prev.el.setAttribute("aria-pressed", "false");
          activeGame.selected = null;
          activeGame.locked = false;
        }, 400);
      }
    }
  }

  const restartMatchBtn = $("restartMatch");
  if (restartMatchBtn) {
    restartMatchBtn.addEventListener("click", startMatchGame);
  }

  // Deck Library & Storage Management
  const deckSelector = $("deckSelector");
  if (deckSelector) {
    deckSelector.addEventListener("change", (e) => {
      const val = e.target.value;
      if (val.startsWith("db_")) {
        const id = parseInt(val.replace("db_", ""), 10);
        const found = userDecks.find(d => d.id === id);
        if (found) {
          $("notes").value = found.content;
          buildDeck();
          return;
        }
      }
      const dict = currentLang === "en" ? PRESETS_EN : PRESETS;
      if (val === "custom") {
        const savedCustom = preferences.getItem("tulis_custom_deck");
        if (savedCustom) {
          $("notes").value = savedCustom;
        }
      } else if (dict[val]) {
        $("notes").value = dict[val];
      }
      buildDeck();
    });
  }

  const saveDeckBtn = $("saveDeckBtn");
  /** Accessible, cancellable replacement for browser prompt/confirm dialogs. */
  function requestDeckAction(title, initialValue, description = '') {
    const dialog = $('deckActionDialog');
    if (dialog.open) return Promise.resolve(null);
    const input = $('deckActionInput');
    const editing = initialValue !== null;
    $('deckActionTitle').textContent = title;
    $('deckActionDescription').textContent = description;
    $('deckActionField').hidden = !editing;
    input.disabled = !editing;
    input.value = initialValue || '';
    $('deckActionConfirm').textContent = currentLang === 'en' ? (editing ? 'Save' : 'Delete') : (editing ? 'Zapisz' : 'Usuń');
    $('deckActionCancel').textContent = currentLang === 'en' ? 'Cancel' : 'Anuluj';
    dialog.returnValue = '';
    return new Promise(resolve => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm' ? (editing ? input.value.trim() : true) : null), { once: true });
      dialog.showModal();
      if (editing) { input.focus(); input.select(); }
    });
  }
  if (saveDeckBtn) saveDeckBtn.addEventListener('click', async () => {
    if (saveDeckBtn.disabled || !buildDeck()) return;
    const content = $("notes").value;
    const current = userDecks.find(item => 'db_' + item.id === deckSelector?.value);
    saveDeckBtn.disabled = true;
    try {
      const title = current?.title || await requestDeckAction(currentLang === 'en' ? 'Deck title' : 'Nazwa talii', currentLang === 'en' ? 'My deck' : 'Moja talia');
      if (!title?.trim()) return;
      const result = await apiRequest(current ? '/api/decks/' + current.id : '/api/decks', current ? 'PUT' : 'POST', { title: title.trim(), category: current?.category || 'Własne', content, card_count: deck.length });
      if (!result.success) return;
      preferences.setItem('tulis_custom_deck', content);
      await loadUserDecks();
      deckSelector.value = 'db_' + result.deck.id;
      showMessage(currentLang === 'en' ? 'Deck saved.' : 'Talia zapisana.');
    } finally { saveDeckBtn.disabled = false; }
  });

  function downloadExportFile(filename, content, mime) {
    const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    if ($("exportModal") && $("exportModal").open) $("exportModal").close();
    showToast(
      currentLang === "en"
        ? `📥 Exported ${filename} successfully!`
        : `📥 Pomyślnie wyeksportowano plik ${filename}!`,
      "success"
    );
  }

  const exportFormatAnkiBtn = $("exportFormatAnkiBtn");
  if (exportFormatAnkiBtn) {
    exportFormatAnkiBtn.addEventListener("click", () => {
      const lines = deck.map(c => `${c.question.replace(/\t/g, ' ')}\t${c.answer.replace(/\t/g, ' ')}`).join("\n");
      downloadExportFile("tulis-learn-anki.txt", lines, "text/tab-separated-values");
    });
  }

  const exportFormatJsonBtn = $("exportFormatJsonBtn");
  if (exportFormatJsonBtn) {
    exportFormatJsonBtn.addEventListener("click", () => {
      const payload = {
        platform: "Tulis Learn",
        version: "2.0",
        export_date: new Date().toISOString(),
        deck_title: $("deckSelector") ? $("deckSelector").options[$("deckSelector").selectedIndex].text : "Talia",
        total_cards: deck.length,
        cards: deck
      };
      downloadExportFile("tulis-learn-deck.json", JSON.stringify(payload, null, 2), "application/json");
    });
  }

  const exportFormatCsvBtn = $("exportFormatCsvBtn");
  if (exportFormatCsvBtn) {
    exportFormatCsvBtn.addEventListener("click", () => {
      const header = '"Question","Answer"\n';
      // Quoting alone does not stop spreadsheet formula execution.
      const cell = value => `"${(/^[\s]*[=+@-]/.test(value) ? "'" + value : value).replace(/"/g, '""')}"`;
      const rows = deck.map(c => [c.question, c.answer].map(cell).join(',')).join("\n");
      downloadExportFile("tulis-learn-deck.csv", header + rows, "text/csv");
    });
  }

  const importFileBtn = $("importFileBtn");
  const fileInput = $("fileInput");
  if (importFileBtn && fileInput) {
    importFileBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 100000) { showMessage('Plik przekracza 100 KB.', true); fileInput.value = ''; return; }
      const reader = new FileReader();
      reader.onerror = () => { showMessage('Nie można odczytać pliku.', true); fileInput.value = ''; };
      reader.onload = (event) => {
        const previous = $("notes").value;
        try {
          let text = event.target.result.replace(/^\uFEFF/, '');
          if (file.name.toLowerCase().endsWith('.csv')) {
            const rows = text.trim().split(/\r?\n/).map(line => {
              const match = line.match(/^"((?:[^"]|"")*)","((?:[^"]|"")*)"$/);
              if (!match) throw new Error('CSV: oczekiwano dwóch kolumn w cudzysłowach.');
              return match.slice(1).map(value => value.replace(/""/g, '"'));
            });
            if (rows[0]?.[0] === 'Question' && rows[0]?.[1] === 'Answer') rows.shift();
            text = rows.map(row => row.join(' | ')).join('\n');
          }
          $("notes").value = text;
          if (!buildDeck()) $("notes").value = previous;
        } catch (error) { $("notes").value = previous; showMessage(error.message, true); }
        finally { fileInput.value = ''; }
      };
      reader.readAsText(file);
    });
  }

  // Live AI Flashcard Extraction Engine (Powered by Anthropic Claude 3.5 Sonnet)

  async function performAiExtraction() {
    if (isExtracting) return;
    isExtracting = true;
    const btn = $("extractAiBtn");
    const btnText = $("extractAiBtnText");
    const originalText = btnText.textContent;
    btn.disabled = true;
    btn.classList.add("loading");
    btnText.textContent = currentLang === "en" ? "⏳ AI is processing text..." : "⏳ AI analizuje notatki...";
    showMessage(
      currentLang === "en"
        ? "Contacting cognitive engine: performing semantic parsing and generating active-recall flashcards..."
        : "Łączenie z silnikiem AI: semantyczna analiza treści i generowanie fiszek w czasie rzeczywistym..."
    );

    let rawInput = $("notes").value.trim();
    if (!rawInput) {
      const presetKey = deckSelector ? deckSelector.value : "bio";
      if (presetKey.startsWith("db_")) {
        const dbId = parseInt(presetKey.replace("db_", ""), 10);
        const dbDeck = userDecks.find(d => d.id === dbId);
        if (dbDeck && dbDeck.content) rawInput = dbDeck.content;
      }
      if (!rawInput) {
        const dict = currentLang === "en" ? PRESETS_EN : PRESETS;
        rawInput = dict[presetKey] || dict.bio;
      }
      $("notes").value = rawInput;
    }

    try {
      const submittedNotes = $("notes").value;
      const prompt = currentLang === "en"
        ? `You are the educational AI engine of Tulis Learn. Transform the source material below into 4 to 8 high-quality, concise active-recall flashcards.\nSTRICT RULES:\n- Each line MUST follow exactly this format: Question | Answer\n- Do NOT include any introductory or concluding text.\n- Do NOT use bullet points, numbering, or markdown bolding.\n\nSource material:\n${rawInput.slice(0, 4000)}`
        : `Jesteś silnikiem edukacyjnym aplikacji Tulis Learn. Przekształć poniższe materiały w 4 do 8 zwięzłych, wysokiej jakości fiszek do aktywnego przypominania.\nŚCISŁE ZASADY:\n- Każda linijka MUSI mieć dokładnie format: Pytanie | Odpowiedź\n- NIE dodawaj wstępu, komentarzy ani podsumowań.\n- NIE używaj punktorów, numeracji ani pogrubień markdown.\n\nMateriały źródłowe:\n${rawInput.slice(0, 4000)}`;

      const activeKey = aiKeys.get();
      if (!activeKey) throw new Error('Local extraction');
      const activeModel = preferences.getItem('tulis_ai_model') || 'claude-3-5-sonnet-20241022';
      let response;
      if (activeModel.startsWith('claude')) {
        response = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          signal: AbortSignal.timeout(15000),
          headers: {
            "Content-Type": "application/json",
            "x-api-key": activeKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true"
          },
          body: JSON.stringify({
            model: activeModel,
            max_tokens: 1500,
            messages: [{ role: "user", content: prompt }]
          })
        });
      } else {
        const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + activeModel + ':generateContent';
        response = await fetch(endpoint, {
          method: "POST",
          signal: AbortSignal.timeout(12000),
          headers: { "Content-Type": "application/json", "x-goog-api-key": activeKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2 }
          })
        });
      }

      if (!response.ok) {
        throw new Error(`API error HTTP ${response.status}`);
      }

      const data = await response.json();
      const outputText = activeModel.startsWith('claude')
        ? (data.content?.[0]?.text || "")
        : (data.candidates?.[0]?.content?.parts?.[0]?.text || "");

      if ($("notes").value !== submittedNotes) throw new Error("Notes changed during generation");
      // Parse and clean generated flashcards
      const cleanedLines = outputText
        .split(/\r?\n/)
        .map((line) => line.replace(/^[-*•\d.]+\s*/, "").trim())
        .filter((line) => line.includes("|") && line.indexOf("|") > 0 && line.indexOf("|") < line.length - 1);

      if (cleanedLines.length >= 2) {
        $("notes").value = cleanedLines.join("\n");
        if (!buildDeck()) return;
        showMessage(
          currentLang === "en"
            ? `✨ Success! AI generated ${deck.length} flashcards in real-time. Ready for active recall and FSRS review!`
            : `✨ Sukces! Silnik AI wygenerował ${deck.length} fiszek w locie z Twojego tekstu. Gotowe do powtórek FSRS!`
        );
      } else {
        throw new Error("Could not parse flashcards from model output");
      }
    } catch (err) {
      if ($("notes").value.trim() !== rawInput) { showMessage(currentLang === "en" ? "Notes changed; discarded the earlier result." : "Notatki zmieniono; odrzucono wcześniejszy wynik.", true); return; }
      // Smart Semantic Fallback: Extract definitions directly from user text if available
      const lines = rawInput.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const extracted = [];

      for (const line of lines) {
        if (line.includes("|") && line.indexOf("|") > 0) {
          extracted.push(line);
          continue;
        }
        const matchColon = line.match(/^([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźżA-Za-z\s\-_0-9()]{2,60}):\s+(.+)$/);
        const matchPl = line.match(/^([A-ZĄĆĘŁŃÓŚŹŻa-ząćęłńóśźż\s\-_0-9()]{2,60})\s+(to|oznacza|jest to|jest|stanowi)\s+(.+)$/i);
        const matchEn = line.match(/^([A-Za-z\s\-_0-9()]{2,60})\s+(is|means|refers to|represents)\s+(.+)$/i);

        if (matchColon) {
          extracted.push(`${matchColon[1].trim()} | ${matchColon[2].trim()}`);
        } else if (matchPl) {
          extracted.push(`Co to jest ${matchPl[1].trim()}? | ${matchPl[3].trim()}`);
        } else if (matchEn) {
          extracted.push(`What is ${matchEn[1].trim()}? | ${matchEn[3].trim()}`);
        }
      }

      if (extracted.length >= 1) {
        $("notes").value = extracted.join("\n");
        if (!buildDeck()) return;
        showMessage(
          currentLang === "en"
            ? `✨ Local parser extracted ${deck.length} flashcards directly from your text.`
            : `✨ Lokalny parser wyodrębnił ${deck.length} fiszek bezpośrednio z Twojego tekstu.`
        );
      } else {
        showMessage(currentLang === 'en' ? 'Could not extract pairs. Your notes are unchanged. Use question | answer or configure an Anthropic Claude key.' : 'Nie znaleziono par. Notatki zachowano. Użyj formatu pytanie | odpowiedź lub skonfiguruj klucz Claude API.', true);
      }


    } finally {
      btn.disabled = false;
      btn.classList.remove("loading");
      btnText.textContent = originalText;
      isExtracting = false;
    }
  }

  const simBtn = $("extractAiBtn");
  if (simBtn) {
    simBtn.addEventListener("click", performAiExtraction);
  }

  // Persist one FSRS result per rating; pending transitions cannot skip cards.
  document.querySelectorAll('.srs-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (ratingPending || currentMode !== 'cards' || !revealed || !deck[cardIndex]) return;
      const activeDeck = deck;
      const activeIndex = cardIndex;
      try {
        const nextState = reviewStore().rate(deck[cardIndex], btn.dataset.srs);
        ratingPending = true;
        document.querySelectorAll('.srs-btn').forEach(button => { button.disabled = true; });
        $("srsBadge").textContent = (currentLang === 'en' ? 'Next review: ' : 'Powtórka: ') + nextState.due.toLocaleString(currentLang === 'en' ? 'en-GB' : 'pl-PL');
        updateFsrsModalMetrics();
        playSound('correct');
        setTimeout(() => {
          ratingPending = false;
          $("srsBadge").textContent = '';
          if (deck !== activeDeck || cardIndex !== activeIndex || currentMode !== 'cards') return;
          revealed = false;
          if (cardIndex < deck.length - 1) cardIndex++;
          else { logStudySession('Fiszki FSRS', 'Ukończono'); showMessage(currentLang === 'en' ? 'Review complete. FSRS schedule saved on this device.' : 'Powtórka ukończona. Harmonogram FSRS zapisany na tym urządzeniu.'); }
          renderCard();
        }, reducedMotion.matches ? 0 : 420);
      } catch (error) { showMessage(error.message || 'Nie zapisano powtórki.', true); }
    });
  });

  $("dueReviewBtn").addEventListener('click', () => {
    if (!buildDeck()) return;
    try {
      const due = deck.filter(card => reviewStore().isDue(card));
      if (!due.length) { showMessage(currentLang === 'en' ? 'All cards are scheduled for later.' : 'Wszystkie fiszki zaplanowano na później.'); return; }
      deck = due; cardIndex = 0; revealed = false; quiz = null;
      selectMode('cards');
      showMessage(currentLang === 'en' ? 'Due now: ' + due.length + ' cards.' : 'Do powtórki teraz: ' + due.length + ' fiszek.');
    } catch (error) { showMessage(error.message, true); }
  });
  // Language buttons
  $("langPl").addEventListener("click", () => setLanguage("pl"));
  $("langEn").addEventListener("click", () => setLanguage("en"));

  $("create").addEventListener("click", () => {
    if (!buildDeck()) {
      $("notes").setAttribute("aria-invalid", "true");
      $("notes").focus({ preventScroll: true });
    }
  });

  $("notes").addEventListener("input", () => {
    $("notes").setAttribute("aria-invalid", "false");
    showMessage(
      currentLang === "en"
        ? "New edits detected. Click 'Compile Flashcards' to refresh."
        : "Masz nowe zmiany. Kliknij „Kompiluj fiszki”, aby użyć ich w powtórce.",
    );
  });

  $("loadExample").addEventListener("click", () => {
    const dict = currentLang === "en" ? PRESETS_EN : PRESETS;
    $("notes").value = dict.bio;
    buildDeck();
  });

  $("flash").addEventListener("click", () => {
    revealed = !revealed;
    playSound("flip");
    renderCard();
  });

  for (const [id, delta] of [
    ["prev", -1],
    ["next", 1],
  ]) {
    $(id).addEventListener("click", () => {
      cardIndex = Math.max(0, Math.min(deck.length - 1, cardIndex + delta));
      revealed = false;
      renderCard();
    });
  }

  $("cardMode").addEventListener("click", () => selectMode("cards"));
  $("quizMode").addEventListener("click", () => selectMode("quiz"));
  const matchModeBtn = $("matchMode");
  if (matchModeBtn) {
    matchModeBtn.addEventListener("click", () => selectMode("match"));
  }
  const typeModeBtn = $("typeMode");
  if (typeModeBtn) {
    typeModeBtn.addEventListener("click", () => selectMode("type"));
  }
  const graphModeBtn = $("graphMode");
  if (graphModeBtn) {
    graphModeBtn.addEventListener("click", () => selectMode("graph"));
  }

  const typeForm = $("typeForm");
  if (typeForm) {
    typeForm.addEventListener("submit", (e) => {
      e.preventDefault();
      checkTypeAnswer();
    });
  }
  const typeSkipBtn = $("typeSkipBtn");
  if (typeSkipBtn) {
    typeSkipBtn.addEventListener("click", () => {
      if ($("typeInput")) $("typeInput").value = currentLang === "en" ? "Skipped" : "Pominięto";
      checkTypeAnswer(true);
    });
  }

  for (const id of ["cardMode", "quizMode", "matchMode", "typeMode", "graphMode"]) {
    const el = $(id);
    if (!el) continue;
    el.addEventListener("keydown", (event) => {
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const modes = ["cards", "quiz", "match", "type", "graph"];
      let cur = ["cardMode", "quizMode", "matchMode", "typeMode", "graphMode"].indexOf(id);
      if (event.key === "ArrowRight") cur = (cur + 1) % modes.length;
      else if (event.key === "ArrowLeft") cur = (cur - 1 + modes.length) % modes.length;
      else if (event.key === "Home") cur = 0;
      else if (event.key === "End") cur = modes.length - 1;
      if (selectMode(modes[cur])) $(["cardMode", "quizMode", "matchMode", "typeMode", "graphMode"][cur]).focus();
    });
  }

  const shuffleBtn = $("shuffleBtn");
  if (shuffleBtn) {
    shuffleBtn.addEventListener("click", () => {
      if (deck.length <= 1) return;
      deck = shuffle(deck);
      cardIndex = 0;
      revealed = false;
      renderCard();
      showMessage(
        currentLang === "en"
          ? "🔀 Deck randomized! Ready for fresh active recall."
          : "🔀 Przetasowano kolejność fiszek! Gotowe do powtórki."
      );
    });
  }

  $("nextQuestion").addEventListener("click", () => {
    if (!quiz || !quiz.answered) return;
    if (quiz.index < deck.length - 1) {
      quiz.index++;
      renderQuestion();
      $("question").focus({ preventScroll: true });
    } else {
      $("quizRound").hidden = true;
      $("quizResult").hidden = false;
      $("resultValue").textContent = `${quiz.correct} / ${deck.length}`;
      const percent = Math.round((quiz.correct / deck.length) * 100);
      quiz.answered = false;
      logStudySession("Quiz", `${quiz.correct}/${deck.length} (${percent}%)`);
      updateDashboardStats();
      playSound("complete");
      launchConfetti();
      $("resultText").textContent = currentLang === "en"
        ? `${percent}% accuracy. ${percent === 100 ? "Flawless score! Review again in a few days." : "Review the flashcards to solidify challenging concepts."}`
        : `${percent}% poprawnych odpowiedzi. ${percent === 100 ? "Świetna robota! Wróć do zestawu za jakiś czas." : "Wróć do fiszek i powtórz pojęcia, które sprawiły trudność."}`;
      $("quizResult").focus({ preventScroll: true });
    }
  });

  $("restartQuiz").addEventListener("click", () => {
    startQuiz();
    $("question").focus({ preventScroll: true });
  });

  // Billing Toggle (Monthly / Annual)
  const billMonthly = $("billMonthly");
  const billYearly = $("billYearly");
  const proPriceVal = $("proPriceVal");
  const teamPriceVal = $("teamPriceVal");
  if (billMonthly && billYearly) {
    billMonthly.addEventListener("click", () => {
      billMonthly.classList.add("active");
      billYearly.classList.remove("active");
      if (proPriceVal) proPriceVal.textContent = "19";
      if (teamPriceVal) teamPriceVal.textContent = "49";
    });
    billYearly.addEventListener("click", () => {
      billYearly.classList.add("active");
      billMonthly.classList.remove("active");
      if (proPriceVal) proPriceVal.textContent = "15";
      if (teamPriceVal) teamPriceVal.textContent = "39";
    });
  }

  // FAQ Accordion
  document.querySelectorAll(".faq-question").forEach((btn, index) => {
    const answer = btn.closest('.faq-item').querySelector('.faq-answer');
    if (answer) { answer.id = 'faq-answer-' + index; btn.setAttribute('aria-controls', answer.id); answer.hidden = !btn.closest('.faq-item').classList.contains('open'); }
    btn.setAttribute('aria-expanded', String(!answer?.hidden));
    btn.addEventListener("click", () => {
      const item = btn.closest(".faq-item");
      const wasOpen = item.classList.contains("open");
      document.querySelectorAll(".faq-item").forEach((it) => it.classList.remove("open"));
      if (!wasOpen) item.classList.add("open");
      document.querySelectorAll('.faq-item').forEach(entry => {
        const expanded = entry.classList.contains('open');
        entry.querySelector('.faq-question').setAttribute('aria-expanded', String(expanded));
        const answer = entry.querySelector('.faq-answer'); if (answer) answer.hidden = !expanded;
      });
    });
  });

  // === AUTHENTICATION & SQLITE DATABASE MANAGEMENT SYSTEM ===
  let currentUser = null;
  let userDecks = [];
  let authToken = preferences.getItem("tulis_auth_token") || "";

  function getInitials(name) {
    if (!name) return "TT";
    const parts = name.trim().split(" ");
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  // Decide storage mode once. Server failures never create a second local database.
  let apiMode = preferences.getItem('tulis_api_mode') || '';
  const localApi = TulisLocalApi.create({ storage: durableStorage, crypto: window.crypto, locks: navigator.locks,
    presets: Object.entries(PRESETS).map(([key, content]) => ({ title: { bio: '🌿 Biologia & Medycyna', cs: '⚡ Informatyka & AI', law: '⚖️ Prawo cywilne & Rzymskie' }[key], content }))
  });
  let modePromise;
  async function determineApiMode() {
    if (apiMode === 'local') {
      $("storageMode").textContent = currentLang === 'en' ? 'Local · data on this device' : 'Lokalnie · dane na tym urządzeniu';
      return apiMode;
    }
    try {
      const response = await fetch(new URL('api/health', document.baseURI), { signal: AbortSignal.timeout(5000), cache: 'no-store' });
      if (response.ok && response.headers.get('content-type')?.includes('application/json')) {
        const data = await response.json();
        if (data.status === 'operational') apiMode = 'server';
      } else if ([404, 405].includes(response.status) || (response.ok && response.headers.get('content-type')?.includes('text/html'))) apiMode = 'local';
    } catch { /* Only an already selected local mode may work without a server. */ }
    if (!apiMode) return 'unavailable';
    preferences.setItem('tulis_api_mode', apiMode);
    const badge = $("storageMode");
    if (badge) badge.textContent = apiMode === 'local' ? (currentLang === 'en' ? 'Local · data on this device' : 'Lokalnie · dane na tym urządzeniu') : 'SQLite · API';
    return apiMode;
  }
  async function apiRequest(endpoint, method = 'GET', body = null) {
    modePromise ||= determineApiMode();
    const mode = await modePromise;
    let data;
    if (mode === 'local') data = await localFallbackApi(endpoint, method, body);
    else {
      try {
        const response = await fetch(new URL(endpoint.replace(/^\//, ''), document.baseURI), {
          method, headers: { 'Content-Type': 'application/json', ...(authToken ? { Authorization: 'Bearer ' + authToken } : {}) },
          body: body === null ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(10000), cache: 'no-store'
        });
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Invalid API response');
        data = await response.json();
        data.status = response.status;
      } catch {
        data = { success: false, status: 503, error: currentLang === 'en' ? 'Server unavailable. Your changes have not been saved. Export your notes and retry.' : 'Serwer niedostępny. Zmiany nie zostały zapisane. Wyeksportuj notatki i spróbuj ponownie.' };
      }
    }
    if (data.status === 401 && !['/api/auth/login', '/api/auth/register'].includes(endpoint)) {
      authToken = ''; preferences.removeItem('tulis_auth_token'); updateAuthUI(null);
    }
    if (!data.success && method !== 'GET') showMessage(data.error, true);
    return data;
  }
  function localFallbackApi(endpoint, method, body) {
    return localApi.request(endpoint, method, body, authToken);
  }

  function updateAuthUI(user) {
    const accountChanged = currentUser?.id !== user?.id;
    currentUser = user;
    if (accountChanged) { userDecks = []; updateDeckSelectorOptions(); renderMgmtDecks(); }
    const isLogged = Boolean(user);
    const navGuest = $("navGuestGroup");
    const navUser = $("navUserGroup");

    if (navGuest) navGuest.style.display = isLogged ? "none" : "flex";
    if (navUser) navUser.style.display = isLogged ? "flex" : "none";

    const userName = user ? user.name : (currentLang === "en" ? "Guest" : "Gość");
    const userInitials = user ? getInitials(userName) : "👤";
    const userRole = (user && user.role) ? user.role.toUpperCase() : "FREE";
    const streak = user?.streak ?? 0;
    const retention = user?.retention || "—";

    if ($("navUserName")) $("navUserName").textContent = userName;
    if ($("navUserBadge")) $("navUserBadge").textContent = userRole;
    if ($("navUserAvatar")) $("navUserAvatar").textContent = userInitials;

    if ($("dashUserName")) $("dashUserName").textContent = userName;
    if ($("dashUserAvatar")) $("dashUserAvatar").textContent = userInitials;
    if ($("dashUserBadge")) $("dashUserBadge").textContent = userRole;

    if ($("mgmtUserName")) $("mgmtUserName").textContent = userName;
    if ($("mgmtUserEmail")) $("mgmtUserEmail").textContent = user ? user.email : (currentLang === "en" ? "Local guest session" : "Lokalna sesja gościa");
    if ($("mgmtAvatar")) $("mgmtAvatar").textContent = userInitials;
    if ($("mgmtUserBadge")) $("mgmtUserBadge").textContent = userRole;
    if ($("mgmtStreak")) $("mgmtStreak").textContent = `${streak} dni`;
    if ($("mgmtRetention")) $("mgmtRetention").textContent = retention;
    if ($("mgmtPlan")) $("mgmtPlan").textContent = user ? `Student ${userRole}` : (currentLang === "en" ? "Guest (Free)" : "Gość (Darmowy)");

    if ($("streakCount")) $("streakCount").textContent = String(streak);
    if ($("masteryRate")) $("masteryRate").textContent = retention;
    updateFsrsModalMetrics();
  }

  async function checkInitialAuth() {
    if (authToken) {
      const res = await apiRequest("/api/auth/me");
      if (res && res.success && res.user) {
        updateAuthUI(res.user);
      } else {
        updateAuthUI(null);
      }
    } else {
      updateAuthUI(null);
    }
    await loadUserDecks();
    updateFsrsModalMetrics();
  }

  // Load and sync decks from SQLite database
  async function loadUserDecks() {
    const res = await apiRequest("/api/decks");
    if (res && res.success && Array.isArray(res.decks)) {
      userDecks = res.decks;
      updateDeckSelectorOptions();
      if ($("mgmtDecksCount")) $("mgmtDecksCount").textContent = String(userDecks.length);
      if ($("deckCount")) $("deckCount").textContent = String(userDecks.length);
      renderMgmtDecks();
      updateFsrsModalMetrics();
    }
  }

  function updateDeckSelectorOptions() {
    const sel = $("deckSelector");
    if (!sel) return;
    const curVal = sel.value;
    sel.innerHTML = userDecks.map(d => `
      <option value="db_${d.id}">${escapeHtml(d.title)}</option>
    `).join("") + `<option value="custom">📝 Własny edytor (roboczy)</option>`;

    if ([...sel.options].some(o => o.value === curVal)) {
      sel.value = curVal;
    } else if (sel.options.length > 0) {
      sel.selectedIndex = 0;
    }
  }

  // Render decks in Management Modal
  function renderMgmtDecks() {
    const list = $("mgmtDecksList");
    if (!list) return;

    const searchInput = $("mgmtDeckSearchInput");
    const query = searchInput ? searchInput.value.toLowerCase().trim() : "";

    const filtered = query
      ? userDecks.filter(d => (d.title && d.title.toLowerCase().includes(query)) || (d.category && d.category.toLowerCase().includes(query)))
      : userDecks;

    if (filtered.length === 0) {
      const msg = query
        ? (currentLang === "en" ? "No decks found matching your search." : "Brak talii pasujących do wyszukiwania.")
        : (currentLang === "en" ? "No decks in database. Click '+ New Deck' to add one!" : "Brak talii w bazie. Kliknij „+ Nowa talia”, aby dodać pierwszą!");
      list.innerHTML = `<div style="text-align: center; color: var(--muted); padding: 24px;">${msg}</div>`;
      return;
    }

    list.innerHTML = filtered.map(deckItem => `
      <div class="mgmt-deck-row">
        <div class="mgmt-deck-info">
          <div class="mgmt-deck-title">${escapeHtml(deckItem.title)}</div>
          <div class="mgmt-deck-meta">
            <span>🏷️ ${escapeHtml(deckItem.category || 'Ogólne')}</span>
            <span>🃏 ${deckItem.card_count || 0} fiszek</span>
            <span>🕒 ${new Date(deckItem.updated_at || Date.now()).toLocaleDateString('pl-PL')}</span>
          </div>
        </div>
        <div class="mgmt-deck-actions">
          <button type="button" class="btn btn-sm btn-light mgmt-study-btn" data-id="${deckItem.id}" title="Załaduj talię do nauki">📖 Ucz się</button>
          <button type="button" class="btn btn-sm btn-light mgmt-edit-btn" data-id="${deckItem.id}" aria-label="${currentLang === 'en' ? 'Rename deck' : 'Zmień nazwę talii'}: ${escapeHtml(deckItem.title)}" title="Zmień nazwę">✏️</button>
          <button type="button" class="btn btn-sm btn-outline mgmt-del-btn" data-id="${deckItem.id}" aria-label="${currentLang === 'en' ? 'Delete deck' : 'Usuń talię'}: ${escapeHtml(deckItem.title)}" title="Usuń talię" style="color: #dc2626; border-color: #fca5a5;">🗑️</button>
        </div>
      </div>
    `).join("");

    list.querySelectorAll(".mgmt-study-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const id = parseInt(btn.dataset.id, 10);
        const found = userDecks.find(d => d.id === id);
        if (found) {
          $("notes").value = found.content;
          buildDeck();
          if ($("deckSelector")) $("deckSelector").value = `db_${found.id}`;
          if ($("managementModal")) $("managementModal").close();
          selectMode("cards");
          showMessage(`📖 Załadowano talię: „${found.title}” z bazy danych!`);
        }
      });
    });

    list.querySelectorAll(".mgmt-edit-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.id, 10);
        const found = userDecks.find(d => d.id === id);
        if (!found) return;
        const newTitle = await requestDeckAction(currentLang === 'en' ? 'Rename deck' : 'Zmień nazwę talii', found.title);
        if (newTitle && newTitle.trim()) {
          const res = await apiRequest(`/api/decks/${id}`, "PUT", {
            title: newTitle.trim(),
            content: found.content,
            card_count: found.card_count
          });
          if (res && res.success) {
            found.title = newTitle.trim();
            loadUserDecks();
            showMessage("✓ Nazwa talii zaktualizowana w bazie danych!");
          }
        }
      });
    });

    list.querySelectorAll(".mgmt-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = parseInt(btn.dataset.id, 10);
        const found = userDecks.find(d => d.id === id);
        if (!found) return;
        if (await requestDeckAction(currentLang === 'en' ? 'Delete deck?' : 'Usunąć talię?', null, currentLang === 'en' ? `Delete “${found.title}”? Export a backup first if you want to keep it.` : `Usunąć „${found.title}”? Najpierw wyeksportuj kopię, jeśli chcesz ją zachować.`)) {
          const res = await apiRequest(`/api/decks/${id}`, "DELETE");
          if (res && res.success) {
            userDecks = userDecks.filter(d => d.id !== id);
            loadUserDecks();
            showMessage("🗑️ Talia została usunięta z bazy danych.");
          }
        }
      });
    });
  }

  // Render History in Management Modal
  async function renderMgmtHistory() {
    const list = $("mgmtHistoryList");
    if (!list) return;
    list.innerHTML = `<div style="text-align: center; color: var(--muted); padding: 16px;">Ładowanie historii z bazy...</div>`;
    const res = await apiRequest("/api/study/history");
    const logs = (res && res.success && Array.isArray(res.logs)) ? res.logs : [];

    if (logs.length === 0) {
      list.innerHTML = `<div style="text-align: center; color: var(--muted); padding: 24px;">Brak zarejestrowanych sesji. Ukończ quiz lub powtórkę fiszek!</div>`;
      return;
    }

    list.innerHTML = logs.map(l => `
      <div class="mgmt-log-row">
        <div>
          <strong>${escapeHtml(l.deck_title || 'Talia')}</strong>
          <span style="color: var(--muted); margin-left: 8px;">• ${escapeHtml(l.mode || 'Fiszki')}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="font-weight: 700; color: var(--green);">${escapeHtml(l.score || '✓')}</span>
          <span style="color: var(--muted); font-size: 11px;">${new Date(l.created_at || Date.now()).toLocaleDateString('pl-PL')}</span>
        </div>
      </div>
    `).join("");
  }

  // Log study session to SQLite DB
  async function logStudySession(mode, score) {
    const sel = $("deckSelector");
    const title = (sel && sel.selectedIndex >= 0 && sel.options[sel.selectedIndex])
      ? sel.options[sel.selectedIndex].text.replace(/^[^\w\s]+/, "").trim()
      : "Talia";
    await apiRequest("/api/study/log", "POST", {
      deck_title: title,
      mode,
      score
    });
    const res = await apiRequest("/api/auth/me");
    if (res.success) updateAuthUI(res.user);
  }

  // Setup Management Modal
  function setupManagementTabs() {
    const tabs = [
      { btn: $("mgmtTabDecks"), panel: $("mgmtDecksPanel"), onSelect: renderMgmtDecks },
      { btn: $("mgmtTabHistory"), panel: $("mgmtHistoryPanel"), onSelect: renderMgmtHistory },
      { btn: $("mgmtTabProfile"), panel: $("mgmtProfilePanel"), onSelect: renderMgmtHeatmap },
      { btn: $("mgmtTabBackup"), panel: $("mgmtBackupPanel") }
    ];

    tabs.forEach(({ btn, panel, onSelect }) => {
      if (!btn || !panel) return;
      panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', btn.id);
      btn.setAttribute('aria-controls', panel.id); btn.tabIndex = panel.hidden ? -1 : 0;
      btn.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const current = tabs.findIndex(tab => tab.btn === btn);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[next].btn.click(); tabs[next].btn.focus();
      });
      btn.addEventListener("click", () => {
        tabs.forEach(t => {
          if (t.btn) {
            t.btn.classList.toggle("active", t.btn === btn);
            t.btn.setAttribute("aria-selected", String(t.btn === btn));
            t.btn.tabIndex = t.btn === btn ? 0 : -1;
          }
          if (t.panel) t.panel.hidden = (t.panel !== panel);
        });
        if (onSelect) onSelect();
      });
    });

    const searchInput = $("mgmtDeckSearchInput");
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        renderMgmtDecks();
      });
    }

    const newDeckBtn = $("mgmtNewDeckBtn");
    const newDeckModal = $("newDeckModal");
    const newDeckForm = $("newDeckForm");
    if (newDeckBtn && newDeckModal) {
      newDeckBtn.addEventListener("click", () => {
        newDeckModal.showModal();
      });
    }

    if (newDeckForm) {
      newDeckForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const title = $("newDeckTitleInput").value.trim();
        const category = $("newDeckCategoryInput").value.trim() || "Ogólne";
        const content = $("newDeckContentInput").value.trim();
        if (!title || !content) { showMessage(currentLang === "en" ? "Enter a title and question | answer pairs." : "Podaj nazwę i pary pytanie | odpowiedź.", true); return; }
        if (newDeckForm.dataset.busy) return;
        newDeckForm.dataset.busy = "true";

        const defaultContent = content;
        const cardCount = defaultContent.split("\n").filter(l => l.includes("|")).length || 3;

        const res = await apiRequest("/api/decks", "POST", {
          title,
          category,
          content: defaultContent,
          card_count: cardCount
        });

        delete newDeckForm.dataset.busy;
        if (res && res.success) {
          if (newDeckModal) newDeckModal.close();
          $("newDeckTitleInput").value = "";
          $("newDeckContentInput").value = "";
          await loadUserDecks();
          showMessage(`✓ Talia „${title}” została utworzona i zapisana w bazie danych!`);
        }
      });
    }

    const dlBackupBtn = $("mgmtDownloadBackupBtn");
    if (dlBackupBtn) {
      dlBackupBtn.addEventListener("click", async () => {
        const res = await apiRequest("/api/backup");
        if (res && res.success) {
          try { res.backup.scheduler = reviewStore().snapshot(); } catch (error) { showMessage(error.message, true); return; }
          const jsonStr = JSON.stringify(res.backup, null, 2);
          const blob = new Blob([jsonStr], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `tulis-learn-backup-${new Date().toISOString().slice(0, 10)}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showMessage("📥 Kopia zapasowa bazy danych została pomyślnie pobrana!");
        }
      });
    }

    const importBackupBtn = $("mgmtImportBackupBtn");
    const backupFileInput = $("mgmtBackupFileInput");
    if (importBackupBtn && backupFileInput) {
      importBackupBtn.addEventListener("click", () => backupFileInput.click());
      backupFileInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        if (file.size > 2 * 1024 * 1024) { showMessage('Plik przekracza 2 MB.', true); backupFileInput.value = ''; return; }
        const reader = new FileReader();
        reader.onerror = () => { showMessage('Nie można odczytać pliku.', true); backupFileInput.value = ''; };
        reader.onload = async (evt) => {
          try {
            const data = JSON.parse(evt.target.result);
            TulisContract.backup(data);
            if (data.scheduler) TulisReviews.validateSnapshot(data.scheduler);
            const result = await apiRequest('/api/backup', 'POST', data);
            if (!result.success) throw new Error(result.error);
            if (data.scheduler) {
              try { reviewStore().restore(data.scheduler); }
              catch { showMessage(currentLang === 'en' ? 'Decks imported, but FSRS storage failed. Keep your backup and retry.' : 'Talie zaimportowano, ale zapis FSRS nie powiódł się. Zachowaj kopię i spróbuj ponownie.', true); await loadUserDecks(); return; }
            }
            await loadUserDecks();
            showMessage(currentLang === 'en' ? 'Backup imported: ' + result.imported + ' decks.' : 'Zaimportowano kopię: ' + result.imported + ' talii.');


          } catch (err) {
            showMessage(err instanceof SyntaxError
              ? (currentLang === 'en' ? 'This JSON file is damaged. No data was imported.' : 'Plik JSON jest uszkodzony. Nie zaimportowano danych.')
              : (err.message || "Niepoprawny format pliku kopii zapasowej JSON."), true);
          } finally {
            backupFileInput.value = "";
          }
        };
        reader.readAsText(file);
      });
    }
  }

  // Setup Auth Modal & Forms
  function setupAuthForms() {
    const tabLogin = $("authTabLogin");
    const tabRegister = $("authTabRegister");
    const loginForm = $("loginForm");
    const registerForm = $("registerForm");
    const feedback = $("authFeedback");
    const authDialog = $("authDialog");

    function setAuthTab(isLogin) {
      if (tabLogin) tabLogin.classList.toggle("active", isLogin);
      if (tabRegister) tabRegister.classList.toggle("active", !isLogin);
      for (const [tab, selected] of [[tabLogin, isLogin], [tabRegister, !isLogin]]) {
        if (!tab) continue;
        tab.setAttribute('aria-selected', String(selected));
        tab.tabIndex = selected ? 0 : -1;
      }
      if (loginForm) loginForm.style.display = isLogin ? "block" : "none";
      if (registerForm) registerForm.style.display = isLogin ? "none" : "block";
      if ($("authSubtitle")) {
        $("authSubtitle").textContent = isLogin
          ? TRANSLATIONS[currentLang].auth_sub
          : (currentLang === "en" ? "Create an account in the selected storage mode. Local accounts stay on this device." : "Załóż konto w wybranym trybie zapisu. Konta lokalne działają na tym urządzeniu.");
      }
      if (feedback) feedback.style.display = "none";
    }

    if (tabLogin) tabLogin.addEventListener("click", () => setAuthTab(true));
    if (tabRegister) tabRegister.addEventListener("click", () => setAuthTab(false));
    [tabLogin, tabRegister].forEach(tab => tab?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const login = event.key === 'Home' || (event.key !== 'End' && tab === tabRegister);
      setAuthTab(login);
      (login ? tabLogin : tabRegister).focus();
    }));

    if (loginForm) {
      loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const email = $("loginEmail").value.trim();
        const password = $("loginPass").value;
        if (!email || !password) return;

        if (loginForm.dataset.busy) return;
        loginForm.dataset.busy = "true";
        const res = await apiRequest("/api/auth/login", "POST", { email, password });
        delete loginForm.dataset.busy;
        if (res && res.success) {
          preferences.removeItem("tulis_logged_out");
          authToken = res.token;
          preferences.setItem("tulis_auth_token", authToken);
          updateAuthUI(res.user);
          await loadUserDecks();
          if (authDialog) authDialog.close();
          showMessage(currentLang === "en" ? `✓ Welcome back, ${res.user.name}!` : `✓ Witaj ponownie, ${res.user.name}!`);
        } else {
          if (feedback) {
            feedback.style.display = "block";
            feedback.textContent = (res && res.error) ? res.error : "Nieprawidłowy e-mail lub hasło.";
          }
        }
      });
    }

    if (registerForm) {
      registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = $("regName").value.trim();
        const email = $("regEmail").value.trim();
        const password = $("regPass").value;
        if (!name || !email || !password) return;

        if (registerForm.dataset.busy) return;
        registerForm.dataset.busy = "true";
        const res = await apiRequest("/api/auth/register", "POST", { name, email, password });
        delete registerForm.dataset.busy;
        if (res && res.success) {
          preferences.removeItem("tulis_logged_out");
          authToken = res.token;
          preferences.setItem("tulis_auth_token", authToken);
          updateAuthUI(res.user);
          await loadUserDecks();
          if (authDialog) authDialog.close();
          showMessage(currentLang === "en" ? `✓ Account created! Welcome, ${res.user.name}.` : `✓ Konto utworzone pomyślnie! Witaj, ${res.user.name}.`);
        } else {
          if (feedback) {
            feedback.style.display = "block";
            feedback.textContent = (res && res.error) ? res.error : "Wystąpił błąd podczas rejestracji.";
          }
        }
      });
    }

    const quickStartBtn = $("quickStartBtn");

    let quickStartPending = false;
    async function handleQuickStart() {
      if (quickStartPending) return;
      quickStartPending = true;
      if (quickStartBtn) quickStartBtn.disabled = true;
      let res;
      try {
        res = await apiRequest("/api/auth/quick-start", "POST");
      } finally {
        quickStartPending = false;
        if (quickStartBtn) quickStartBtn.disabled = false;
      }
      if (res && res.success) {
        preferences.removeItem("tulis_logged_out");
        authToken = res.token;
        preferences.setItem("tulis_auth_token", authToken);
        updateAuthUI(res.user);
        await loadUserDecks();
        if (authDialog) authDialog.close();
        showMessage(currentLang === "en" ? "Study workspace ready." : "Witaj w Tulis Learn! Warsztat nauki jest gotowy.");
      }
    }

    if (quickStartBtn) quickStartBtn.addEventListener("click", handleQuickStart);

    async function handleLogout() {
      await apiRequest("/api/auth/logout", "POST");
      authToken = "";
      preferences.removeItem("tulis_auth_token");
      preferences.setItem("tulis_logged_out", "true");
      updateAuthUI(null);
      if ($("managementModal")) $("managementModal").close();
      showMessage(currentLang === "en" ? "Logged out successfully." : "Wylogowano pomyślnie.");
    }

    if ($("navLogoutBtn")) $("navLogoutBtn").addEventListener("click", handleLogout);
    if ($("mgmtLogoutBtn")) $("mgmtLogoutBtn").addEventListener("click", handleLogout);
  }

  function closeMenu() {
    $("navLinks").classList.remove("open");
    $("menuToggle").setAttribute("aria-expanded", "false");
    $("menuToggle").setAttribute("aria-label", currentLang === "en" ? "Open menu" : "Otwórz menu");
  }

  $("menuToggle").addEventListener("click", () => {
    const open = $("navLinks").classList.toggle("open");
    $("menuToggle").setAttribute("aria-expanded", String(open));
    $("menuToggle").setAttribute(
      "aria-label",
      open ? (currentLang === "en" ? "Close menu" : "Zamknij menu") : (currentLang === "en" ? "Open menu" : "Otwórz menu"),
    );
  });

  $("navLinks")
    .querySelectorAll("a")
    .forEach((link) => link.addEventListener("click", closeMenu));

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $("navLinks").classList.contains("open")) {
      closeMenu();
      $("menuToggle").focus();
    }
  });

  // Native dialogs handle focus containment, Escape and focus restoration.
  document.querySelectorAll("[data-open]").forEach((button) => {
    if (button.getAttribute('role') === 'button') button.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); button.click(); }
    });
    button.addEventListener("click", () => {
      closeMenu();
      const dlg = $(button.dataset.open);
      if (dlg) {
        dlg.showModal();
        document.body.classList.add("modal-open");
      }
    });
  });

  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.querySelectorAll("[data-close]").forEach(button => button.addEventListener("click", () => dialog.close()));
    dialog.addEventListener("click", (event) => {
      const bounds = dialog.getBoundingClientRect();
      if (
        event.target === dialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      ) {
        dialog.close();
      }
    });
    dialog.addEventListener("close", () => {
      document.body.classList.toggle(
        "modal-open",
        Boolean(document.querySelector("dialog[open]")),
      );
    });
  });

  // Contact Modal Submission Handler
  const sendContactBtn = $("sendContactBtn");
  if (sendContactBtn) {
    $("contactForm").addEventListener('submit', event => { event.preventDefault(); sendContactBtn.click(); });
    sendContactBtn.addEventListener("click", () => {
      const email = $("contactEmail") ? $("contactEmail").value.trim() : "";
      const msg = $("contactMsg") ? $("contactMsg").value.trim() : "";
      const feedback = $("contactFeedback");
      if (!email || !msg) {
        showMessage(
          currentLang === "en"
            ? "Please provide an email address and message."
            : "Wpisz adres e-mail oraz treść wiadomości.",
          true
        );
        return;
      }
      const mailto = 'mailto:' + contact + '?subject=' + encodeURIComponent('Tulis Learn — ' + email) + '&body=' + encodeURIComponent(msg);
      window.location.href = mailto;
      if (feedback) { feedback.style.display = 'block'; feedback.textContent = currentLang === 'en' ? 'Complete sending in your email app.' : 'Dokończ wysyłanie w aplikacji pocztowej.'; }
    });
  }


  async function renderMgmtHeatmap() {
    const grid = $("mgmtHeatmap");
    if (!grid) return;
    const result = await apiRequest('/api/backup');
    grid.replaceChildren();
    for (let i = 13; i >= 0; i--) {
      const date = new Date(); date.setUTCDate(date.getUTCDate() - i);
      const iso = date.toISOString().slice(0, 10);
      const count = (result.backup?.logs || []).filter(log => new Date(log.created_at).toISOString().slice(0, 10) === iso).length;
      const cell = document.createElement('div'); cell.className = 'heatmap-cell';
      if (count) cell.classList.add('level-' + Math.min(3, count));
      cell.title = iso + ': ' + count + (currentLang === 'en' ? ' sessions' : ' sesji'); grid.appendChild(cell);
    }
  }

  function setupAiSettingsModal() {
    const modal = $("aiSettingsModal");
    const providerSel = $("aiProviderSelect");
    const customKeyInput = $("customApiKeyInput");
    const tempRange = $("aiTempRange");
    const tempVal = $("aiTempVal");
    const testBtn = $("testAiConnectionBtn");
    const saveBtn = $("saveAiSettingsBtn");
    const feedback = $("aiTestFeedback");

    if (customKeyInput) {
      customKeyInput.value = aiKeys.get() || "";
    }
    if (providerSel) {
      providerSel.value = preferences.getItem("tulis_ai_model") || "claude-3-5-sonnet-20241022";
    }
    if (tempRange && tempVal) {
      const savedTemp = preferences.getItem("tulis_ai_temperature") || "0.2";
      tempRange.value = savedTemp;
      tempVal.textContent = `${savedTemp} (${Number(savedTemp) <= 0.3 ? (currentLang === "en" ? "Strict" : "Ścisła") : (currentLang === "en" ? "Creative" : "Kreatywna")})`;
      tempRange.addEventListener("input", (e) => {
        tempVal.textContent = `${e.target.value} (${Number(e.target.value) <= 0.3 ? (currentLang === "en" ? "Strict" : "Ścisła") : (currentLang === "en" ? "Creative" : "Kreatywna")})`;
      });
    }

    if (testBtn) {
      testBtn.addEventListener("click", async () => {
        testBtn.disabled = true;
        testBtn.textContent = currentLang === "en" ? "Testing..." : "Testowanie...";
        if (feedback) {
          feedback.style.display = "block";
          feedback.style.background = "var(--surface)";
          feedback.style.border = "1px solid var(--line)";
          feedback.style.color = "var(--ink)";
          feedback.textContent = currentLang === "en" ? "Pinging model endpoint..." : "Wysyłanie zapytania testowego do silnika AI...";
        }

        const startT = performance.now();
        const customKey = customKeyInput ? customKeyInput.value.trim() : "";
        const activeKey = customKey;
        const selectedModel = providerSel ? providerSel.value : "claude-3-5-sonnet-20241022";

        try {
          if (!activeKey) throw new Error(currentLang === 'en' ? 'Enter your API key' : 'Wpisz własny klucz API');
          let res;
          if (selectedModel.startsWith("claude")) {
            res = await fetch("https://api.anthropic.com/v1/messages", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "x-api-key": activeKey,
                "anthropic-version": "2023-06-01",
                "anthropic-dangerous-direct-browser-access": "true"
              },
              body: JSON.stringify({
                model: selectedModel,
                max_tokens: 10,
                messages: [{ role: "user", content: "Reply OK." }]
              }),
              signal: AbortSignal.timeout(10000)
            });
          } else {
            const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/' + selectedModel + ':generateContent';
            res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': activeKey }, body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply OK.' }] }] }), signal: AbortSignal.timeout(10000) });
          }
          const dur = Math.round(performance.now() - startT);

          if (res.ok) {
            if (feedback) {
              feedback.style.background = "#dcfce7";
              feedback.style.border = "1px solid #86efac";
              feedback.style.color = "#15803d";
              feedback.textContent = currentLang === "en"
                ? `✓ Connection Verified! ${selectedModel.startsWith("claude") ? "Anthropic Claude" : "Google AI Studio"} (${selectedModel}) responded in ${dur}ms.`
                : `✓ Połączenie zweryfikowane! Silnik ${selectedModel.startsWith("claude") ? "Anthropic Claude" : "Google AI Studio"} (${selectedModel}) odpowiedział w ${dur}ms.`;
            }
            playSound("correct");
          } else {
            throw new Error(`HTTP ${res.status}`);
          }
        } catch (err) {
          if (feedback) {
            feedback.style.background = "#fee2e2";
            feedback.style.border = "1px solid #fca5a5";
            feedback.style.color = "#991b1b";
            feedback.textContent = currentLang === "en"
              ? `✗ Connection check: ${err.message}. Local parsing remains available.`
              : `✗ Status połączenia: ${err.message}. Lokalny parser pozostaje dostępny.`;
          }
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = currentLang === "en" ? "⚡ Test Connection" : "⚡ Przetestuj połączenie";
        }
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", () => {
        if (customKeyInput) {
          try { aiKeys.set(customKeyInput.value.trim()); } catch { showMessage(currentLang === "en" ? "Session storage unavailable. Key was not saved." : "Pamięć sesji niedostępna. Klucz nie został zapisany.", true); return; }
        }
        if (providerSel) {
          preferences.setItem("tulis_ai_model", providerSel.value);
        }
        if (tempRange) {
          preferences.setItem("tulis_ai_temperature", tempRange.value);
        }
        if (modal) modal.close();
        showMessage(currentLang === "en" ? "✓ AI settings saved successfully!" : "✓ Ustawienia silnika AI zostały pomyślnie zapisane!");
      });
    }
  }

  // Register PWA Service Worker
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(error => {
        console.warn('Offline cache registration failed:', error.message);
      });
    });
  }

  function initCookieConsent() {
    const banner = $("cookieBanner");
    const acceptAllBtn = $("cookieAcceptAllBtn");
    const necessaryBtn = $("cookieNecessaryBtn");
    const footerCookieBtn = $("footerCookieBtn");

    if (!banner) return;

    const savedConsent = preferences.getItem("tulis_cookie_consent");
    if (!savedConsent) {
      banner.hidden = false;
      setTimeout(() => banner.classList.add("is-visible"), 600);
    }

    const setConsent = (choice) => {
      preferences.setItem("tulis_cookie_consent", choice);
      banner.classList.remove("is-visible");
      setTimeout(() => {
        banner.hidden = true;
      }, 400);
      showToast(
        currentLang === "en"
          ? "✓ Privacy preferences saved."
          : "✓ Preferencje prywatności zostały zapisane.",
        "success"
      );
    };

    if (acceptAllBtn) {
      acceptAllBtn.addEventListener("click", () => setConsent("all"));
    }
    if (necessaryBtn) {
      necessaryBtn.addEventListener("click", () => setConsent("necessary"));
    }
    if (footerCookieBtn) {
      footerCookieBtn.addEventListener("click", () => {
        banner.hidden = false;
        banner.classList.add("is-visible");
      });
    }
  }

  function initKeyboardShortcuts() {
    const shortcutsModal = $("shortcutsModal");


    const toggleShortcutsModal = () => {
      if (!shortcutsModal) return;
      if (shortcutsModal.open) {
        shortcutsModal.close();
      } else {
        shortcutsModal.showModal();
      }
    };

    window.addEventListener("keydown", (e) => {
      const activeTag = document.activeElement ? document.activeElement.tagName : "";
      const isInput = activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT" || (document.activeElement && document.activeElement.isContentEditable);

      if (e.key === "?" && !isInput) {
        e.preventDefault();
        toggleShortcutsModal();
        return;
      }

      if (isInput) return;

      if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || document.querySelector('dialog[open]')) return;
      if (document.activeElement?.closest('button, a, [role="tab"], [role="button"]')) return;
      if (currentMode === 'cards') {
        if (e.code === 'Space') { e.preventDefault(); $("flash").click(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); if (!$("next").disabled) $("next").click(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); if (!$("prev").disabled) $("prev").click(); }
        if (revealed && ['1', '2', '3', '4'].includes(e.key)) document.querySelector('.srs-btn[data-srs="' + { 1: 'again', 2: 'hard', 3: 'good', 4: 'easy' }[e.key] + '"]')?.click();
      }


      if (e.key === "f" || e.key === "F") {
        if ($("cardMode")) $("cardMode").click();
      }
      if (e.key === "q" || e.key === "Q") {
        if ($("quizMode")) $("quizMode").click();
      }
      if (e.key === "m" || e.key === "M") {
        if ($("matchMode")) $("matchMode").click();
      }
      if (e.key === "t" || e.key === "T") {
        if ($("typeMode")) $("typeMode").click();
      }
      if (e.key === "g" || e.key === "G") {
        if ($("graphMode")) $("graphMode").click();
      }
      if (e.key === "s" || e.key === "S") {
        if ($("socraticBtn")) $("socraticBtn").click();
      }
    });
  }

  function initNewsletter() {
    const form = $("newsletterForm");
    const input = $("newsletterEmail");
    const submitBtn = $("newsletterSubmitBtn");
    const feedback = $("newsletterFeedback");

    if (!submitBtn || !input) return;

    const handleSubscribe = async () => {
      if (submitBtn.disabled) return;
      const email = input.value.trim();
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!email || !emailRegex.test(email)) {
        if (feedback) {
          feedback.textContent = currentLang === "en" ? "⚠️ Please enter a valid email address." : "⚠️ Podaj poprawny adres e-mail.";
          feedback.style.color = "#dc2626";
          feedback.style.display = "block";
        }
        showToast(currentLang === "en" ? "Please enter a valid email address." : "Podaj poprawny adres e-mail.", "error");
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = currentLang === "en" ? "Subscribing..." : "Zapisywanie...";

      try {
        const result = await apiRequest("/api/newsletter", "POST", { email });
        if (!result.success) throw new Error(result.error);
        input.value = "";
        if (feedback) {
          feedback.textContent = currentLang === "en"
            ? "✓ Thank you! You've been subscribed to our weekly digest."
            : "✓ Dziękujemy! Zostałeś pomyślnie zapisany do biuletynu.";
          feedback.style.color = "var(--green)";
          feedback.style.display = "block";
        }
        showToast(
          currentLang === "en"
            ? "🎉 Welcome to the Cognitive Newsletter!"
            : "🎉 Witamy w Biuletynie Kognitywnym Tulis Learn!",
          "success"
        );
        launchConfetti();
      } catch (err) {
        if (feedback) {
          feedback.textContent = err.message;
          feedback.style.color = 'var(--ink)';
          feedback.style.display = 'block';
        }


      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = TRANSLATIONS[currentLang].newsletter_btn_sub || "Zapisz się bezpłatnie";
      }
    };

    submitBtn.addEventListener("click", handleSubscribe);
    if (form) form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleSubscribe();
    });
  }

  function updateDashboardStats() {
    if ($("streakCount")) $("streakCount").textContent = String(currentUser?.streak ?? 0);
    if ($("deckCount")) $("deckCount").textContent = String(userDecks.length);
    updateFsrsModalMetrics();
  }

  // Initial setup
  new ResizeObserver(entries => {
    document.documentElement.style.scrollPaddingTop = entries[0].target.getBoundingClientRect().height + 16 + 'px';
  }).observe(document.querySelector('.nav-wrap'));
  setLanguage(currentLang);
  buildDeck();
  updateDashboardStats();
  initCookieConsent();
  initKeyboardShortcuts();
  initNewsletter();
  initSocraticTutor();
  initPrintDeck();
  setupAuthForms();
  setupManagementTabs();
  setupAiSettingsModal();
  checkInitialAuth().catch(error => showMessage(error.message, true));
})();
