const fs = require("fs");
const path = require("path");
const http = require("http");

console.log("=== TULIS LEARN COMPREHENSIVE TEST SUITE ===");
let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    failed++;
  }
}

const htmlPath = path.join(__dirname, "index.html");
const jsPath = path.join(__dirname, "app.js");

const html = fs.readFileSync(htmlPath, "utf-8");
const js = fs.readFileSync(jsPath, "utf-8");

// 1. Verify all icons defined in <defs>
const iconDefs = [...html.matchAll(/id="(i-[a-z0-9-]+)"/g)].map(m => m[1]);
const iconUses = [...html.matchAll(/href="#(i-[a-z0-9-]+)"/g)].map(m => m[1]);
const missingIcons = iconUses.filter(id => !iconDefs.includes(id));
assert(missingIcons.length === 0, `All SVG icon <use> references resolve (${iconDefs.length} defined, 0 missing)`);

// 2. Extract DOM IDs from HTML
const htmlIds = new Set([...html.matchAll(/id="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]));

// 3. Extract $(id) calls from app.js
const jsDollarIds = [...js.matchAll(/\$\("([a-zA-Z0-9_-]+)"\)/g)].map(m => m[1]);
const missingJsIds = [...new Set(jsDollarIds)].filter(id => !htmlIds.has(id));
assert(missingJsIds.length === 0, `All $(id) DOM queries in app.js exist in index.html (checked ${new Set(jsDollarIds).size} unique IDs, missing: ${missingJsIds.join(", ") || "none"})`);

// 4. Extract data-i18n attributes from index.html
const htmlI18nKeys = [...new Set([...html.matchAll(/data-i18n="([a-zA-Z0-9_-]+)"/g)].map(m => m[1]))];

// Extract TRANSLATIONS from app.js
const plMatch = js.match(/pl:\s*\{([\s\S]*?)\},\s*en:\s*\{/);
const enMatch = js.match(/en:\s*\{([\s\S]*?)\}\s*\};/);

assert(Boolean(plMatch && enMatch), "Extracted TRANSLATIONS.pl and TRANSLATIONS.en dictionaries from app.js");

const plKeys = new Set([...(plMatch[1].matchAll(/^\s+([a-zA-Z0-9_-]+)\s*:\s*["`]/gm))].map(m => m[1]));
const enKeys = new Set([...(enMatch[1].matchAll(/^\s+([a-zA-Z0-9_-]+)\s*:\s*["`]/gm))].map(m => m[1]));

const missingInPl = htmlI18nKeys.filter(k => !plKeys.has(k));
const missingInEn = htmlI18nKeys.filter(k => !enKeys.has(k));

assert(missingInPl.length === 0, `All ${htmlI18nKeys.length} HTML data-i18n attributes exist in TRANSLATIONS.pl (missing: ${missingInPl.join(", ") || "none"})`);
assert(missingInEn.length === 0, `All ${htmlI18nKeys.length} HTML data-i18n attributes exist in TRANSLATIONS.en (missing: ${missingInEn.join(", ") || "none"})`);

const plOnly = [...plKeys].filter(k => !enKeys.has(k));
const enOnly = [...enKeys].filter(k => !plKeys.has(k));
assert(plOnly.length === 0 && enOnly.length === 0, `Symmetrical i18n keys between PL and EN (${plKeys.size} PL keys, ${enKeys.size} EN keys, diff: ${[...plOnly, ...enOnly].join(", ") || "0"})`);

// 5. Internal href="#..." validity
const internalHrefs = [...html.matchAll(/href="#([a-zA-Z0-9_-]+)"/g)]
  .map(m => m[1])
  .filter(id => !id.startsWith("i-")); // ignore SVG symbols
const brokenHrefs = internalHrefs.filter(id => !htmlIds.has(id));
assert(brokenHrefs.length === 0, `All local href links point to existing section/modal IDs (broken: ${brokenHrefs.join(", ") || "none"})`);

// 6. Zero prohibited draft/placeholder tokens in user-visible HTML
const draftTokens = ["TODO", "LOREM IPSUM", "WERSJA ROBOCZA", "WERSJA TESTOWA", "DRAFT MODE", "UNDER CONSTRUCTION"];
const upperHtml = html.toUpperCase();
const foundTokens = draftTokens.filter(t => upperHtml.includes(t));
assert(foundTokens.length === 0, `Clean production copy without prototype/draft tokens (found: ${foundTokens.join(", ") || "none"})`);

// 7. Verify local dev server HTTP 200 response & Security Headers
const req = http.get("http://localhost:3000/", (res) => {
  let body = "";
  res.on("data", chunk => body += chunk);
  res.on("end", () => {
    assert(res.statusCode === 200, `Local dev server returns HTTP 200 OK (got ${res.statusCode})`);
    assert(res.headers["content-type"].includes("text/html"), `Content-Type header is text/html (got ${res.headers["content-type"]})`);
    assert(res.headers["x-content-type-options"] === "nosniff", "Security header X-Content-Type-Options: nosniff present");
    assert(res.headers["x-frame-options"] === "SAMEORIGIN", "Security header X-Frame-Options: SAMEORIGIN present");
    assert(body.includes("Tulis Learn"), "Response contains valid platform branding");
    assert(body.includes("graphCanvas"), "Response includes Concept Graph canvas");
    assert(body.includes("socraticDrawer"), "Response includes Socratic Tutor drawer");
    assert(body.includes("fsrsAnalyticsModal"), "Response includes FSRS Memory Analytics modal");
    assert(body.includes("printModal"), "Response includes Printable Flashcard modal");
    assert(body.includes("managementModal"), "Response includes Management Dashboard modal");
    assert(body.includes("typeRecall"), "Response includes Type-In Active Recall panel");
    assert(body.includes("aiSettingsModal"), "Response includes AI Model Configuration modal");
    assert(body.includes("toastContainer"), "Response includes Toast Notification stack container");
    assert(body.includes("cookieBanner"), "Response includes RODO/GDPR Cookie consent banner");
    assert(body.includes("shortcutsModal"), "Response includes Keyboard Shortcuts cheatsheet modal");
    assert(body.includes("exportModal"), "Response includes Multi-Format Export modal");
    assert(body.includes("newsletterCard"), "Response includes Newsletter subscription card");
    assert(body.includes("mgmtDeckSearchInput"), "Response includes Deck live search input");

    // 8. Run Security, Resilience and API Tests
    runExtendedTests();
  });
});

function httpGet(path) {
  return new Promise((resolve) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
    }).on("error", (err) => resolve({ status: 500, error: err }));
  });
}

function httpPost(path, body = {}, headers = {}) {
  return new Promise((resolve) => {
    const payload = typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(`http://localhost:3000${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers
      }
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => resolve({ status: res.statusCode, data, headers: res.headers }));
    });
    req.on("error", (err) => resolve({ status: 500, error: err }));
    req.write(payload);
    req.end();
  });
}

async function runExtendedTests() {
  // Test Security: Block sensitive files
  const dbRes = await httpGet("/tulis.db");
  assert(dbRes.status === 403, `Direct access to SQLite database file /tulis.db blocked (403 Forbidden)`);

  const serverRes = await httpGet("/server.js");
  assert(serverRes.status === 403, `Direct access to server script /server.js blocked (403 Forbidden)`);

  const dbCodeRes = await httpGet("/db.js");
  assert(dbCodeRes.status === 403, `Direct access to database logic /db.js blocked (403 Forbidden)`);

  // Test Security: Malformed URI handling
  const malformedRes = await httpGet("/%E0%A4%A");
  assert(malformedRes.status === 400, `Malformed URI /%E0%A4%A handled gracefully with 400 Bad Request`);

  // Test Security: Invalid JSON POST
  const badJsonRes = await httpPost("/api/auth/login", "{invalid_json:");
  assert(badJsonRes.status === 400, `Malformed JSON payload rejected safely with 400 Bad Request`);

  // Test PWA Service Worker serving
  const swRes = await httpGet("/sw.js");
  assert(swRes.status === 200 && swRes.headers["service-worker-allowed"] === "/", "PWA Service Worker /sw.js served with Service-Worker-Allowed: /");

  // Test /api/stats
  const statsRes = await httpGet("/api/stats");
  const statsData = JSON.parse(statsRes.data || "{}");
  assert(statsRes.status === 200 && statsData.success && statsData.stats.userCount >= 1, `API /api/stats returns SQLite platform stats (users: ${statsData.stats.userCount})`);

  // Test /api/auth/demo
  const authRes = await httpPost("/api/auth/demo");
  const authData = JSON.parse(authRes.data || "{}");
  assert(authRes.status === 200 && authData.success && authData.token, `API /api/auth/demo returns session token and user (${authData.user.name})`);

  // Test /api/decks with Bearer token
  const token = authData.token;
  const decksRes = await new Promise((resolve) => {
    http.get("http://localhost:3000/api/decks", { headers: { "Authorization": `Bearer ${token}` } }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(d || "{}") }));
    });
  });
  assert(decksRes.status === 200 && decksRes.data.success && decksRes.data.decks.length >= 3, `API /api/decks returns user decks from SQLite (${decksRes.data.decks.length} decks)`);

  // Test /api/backup export
  const backupRes = await new Promise((resolve) => {
    http.get("http://localhost:3000/api/backup", { headers: { "Authorization": `Bearer ${token}` } }, (res) => {
      let d = "";
      res.on("data", c => d += c);
      res.on("end", () => resolve({ status: res.statusCode, data: JSON.parse(d || "{}") }));
    });
  });
  assert(backupRes.status === 200 && backupRes.data.success && backupRes.data.backup.decks.length >= 3, `API /api/backup exports SQLite database as JSON`);

  // Test /api/backup import (POST)
  const importRes = await httpPost("/api/backup", {
    decks: [
      { title: "Talia Testowa Import", category: "Test", content: "Pytanie 1 | Odpowiedź 1", card_count: 1 }
    ]
  }, { "Authorization": `Bearer ${token}` });
  const importData = JSON.parse(importRes.data || "{}");
  assert(importRes.status === 200 && importData.success && importData.imported >= 1, "API POST /api/backup imports backup decks directly into SQLite");

  // Test /api/study/log
  const logRes = await httpPost("/api/study/log", {
    deck_title: "Test Talia",
    mode: "Wpisywanie",
    score: "100%"
  }, { "Authorization": `Bearer ${token}` });
  const logData = JSON.parse(logRes.data || "{}");
  assert(logRes.status === 200 && logData.success, `API /api/study/log saves session and updates user streak`);

  // Test /api/health
  const healthRes = await httpGet("/api/health");
  const healthData = JSON.parse(healthRes.data || "{}");
  assert(healthRes.status === 200 && healthData.status === "operational", "API /api/health returns operational status (200 OK)");

  // Test /api/newsletter
  const newsValidRes = await httpPost("/api/newsletter", { email: "tester@tulislearn.com" });
  const newsValidData = JSON.parse(newsValidRes.data || "{}");
  assert(newsValidRes.status === 200 && newsValidData.success, "API POST /api/newsletter registers email subscriber (200 OK)");

  const newsInvalidRes = await httpPost("/api/newsletter", { email: "invalid-email" });
  assert(newsInvalidRes.status === 400, "API POST /api/newsletter rejects invalid email format (400 Bad Request)");

  console.log(`\nTEST SUITE SUMMARY: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

req.on("error", (err) => {
  console.error(`  ✗ Dev server request error: ${err.message}`);
  failed++;
  console.log(`\nTEST SUITE SUMMARY: ${passed} passed, ${failed} failed`);
  process.exit(1);
});
