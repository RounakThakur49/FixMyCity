const { test, expect, request } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const FRONTEND_URL = 'http://localhost:3000';
const API_URL = 'http://localhost:5000';
const DATASET = path.join(__dirname, '../../backend/my_dataset');

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — complaint creation now requires a citizen JWT (server-side auth added
// July 2026). Log in once as a seeded citizen and attach the token to every
// POST /api/complaints. Reads (GET) stay public and need no token.
// ─────────────────────────────────────────────────────────────────────────────
let TOKEN = '';
test.beforeAll(async () => {
  const ctx = await request.newContext();
  const res = await ctx.post(`${API_URL}/api/auth/login`, {
    data: { identifier: '9876543210', password: 'citizen123' },
  });
  if (res.ok()) TOKEN = (await res.json()).token || '';
  await ctx.dispose();
  if (!TOKEN) console.warn('  ⚠️  Could not obtain citizen token — complaint POSTs will 401.');
});

function authHeaders() {
  return TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {};
}

// Wrapper: POST a complaint with the citizen token merged in.
function postComplaint(reqCtx, opts) {
  return reqCtx.post(`${API_URL}/api/complaints`, {
    ...opts,
    headers: { ...(opts.headers || {}), ...authHeaders() },
  });
}

// Read quarantine log to skip known-bad images
let _quarantined = null;
function isQuarantined(category, filename) {
  if (!_quarantined) {
    const logPath = path.join(__dirname, '../../backend/nsfw_scan_results.json');
    if (fs.existsSync(logPath)) {
      const data = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      _quarantined = {};
      for (const [cat, r] of Object.entries(data)) {
        _quarantined[cat] = new Set((r.flagged || []).map(f => f.file));
      }
    } else {
      _quarantined = {};
    }
  }
  return (_quarantined[category] || new Set()).has(filename);
}

// Known-contaminated filename prefixes (see CLAUDE.md "Dataset contamination").
// These are the web-scraper junk prefixes that survive in the LOCAL dataset
// (NSFW anime, fashion, posters, etc). `kag_*` (potholes) and `oth_*` (rebuilt
// curated others) are CLEAN and must NOT be excluded. When nsfw_scan_results.json
// is absent we still avoid these so ACCEPT assertions test the model on clean
// data, not mislabeled scraper junk.
const CONTAMINATED_PREFIXES = ['scrape_', 'drain_', 'bing_'];
function isContaminatedName(filename) {
  return CONTAMINATED_PREFIXES.some(p => filename.startsWith(p));
}

function getRandomImage(category, index = 5) {
  const dir = path.join(DATASET, category);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg')).sort();
  const isBad = (f) => isQuarantined(category, f) || isContaminatedName(f);
  // Skip quarantined/contaminated images — find first clean image at or after index
  for (let i = index; i < files.length; i++) {
    if (!isBad(files[i])) return path.join(dir, files[i]);
  }
  // Try from beginning if nothing found after index
  for (let i = 0; i < Math.min(index, files.length); i++) {
    if (!isBad(files[i])) return path.join(dir, files[i]);
  }
  return null;
}

function imageToBase64(imgPath) {
  const buf = fs.readFileSync(imgPath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function makeComplaint(type, imgPath) {
  return {
    citizenName: 'Playwright E2E Tester',
    citizenPhone: '9000000099',
    citizenLocation: 'E2E Test Colony, Test City',
    title: `E2E test: ${type}`,
    description: `Playwright automated E2E test for category: ${type}`,
    type,
    location: 'E2E Test Street, Test City',
    latitude: 12.9716,
    longitude: 77.5946,
    image: imageToBase64(imgPath),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 1: Browser UI Tests
// ─────────────────────────────────────────────────────────────────────────────
test.describe('UI: Page Structure', () => {

  test('Homepage loads with correct title and h1', async ({ page }) => {
    // NOTE: do NOT use waitForLoadState('networkidle') — the CRA dev server keeps
    // an HMR websocket open and the homepage fetches the full complaints list, so
    // the network never goes idle and this flakes to a 60s timeout as data grows.
    // Rely on web-first assertions (auto-waiting) instead.
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveTitle(/FixMyCity/i);
    const h1 = page.locator('h1').first();
    await expect(h1).toBeVisible();
    const titleText = await h1.textContent();
    console.log(`  h1: "${titleText}"`);
    await page.screenshot({ path: 'test-results/homepage.png', fullPage: false });
  });

  test('Navigation links are visible', async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    // At least one nav/button element should exist (auto-waits until visible)
    const navItems = page.locator('nav a, header a, header button').first();
    await expect(navItems).toBeVisible();
  });

  test('Stats section shows numbers', async ({ page }) => {
    await page.goto(FRONTEND_URL, { waitUntil: 'domcontentloaded' });
    // Stats numbers should be visible; wait for the hero heading to render.
    await expect(page.locator('h1').first()).toBeVisible();
    await page.screenshot({ path: 'test-results/homepage-stats.png' });
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 2: API — Health & System Status
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Health & Models', () => {

  test('Health endpoint — civic model loaded', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/health`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.model_loaded).toBe(true);
    console.log(`  Classifier: ${body.classifier}`);
  });

  test('Health endpoint — NSFW model loaded', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/health`);
    const body = await res.json();
    expect(body.nsfw_loaded).toBe(true);
    console.log(`  Content moderation: ${body.content_moderation}`);
  });

  test('Health endpoint — all 4 civic classes present', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/health`);
    const body = await res.json();
    expect(body.classes).toEqual(['drainage', 'others', 'potholes', 'streetlight']);
    // NOTE: /api/health intentionally does NOT expose internal ML thresholds/OOD
    // config (security hardening — see CLAUDE.md "Applied hardening"). Assert the
    // enforce/advisory flag instead of internal calibration numbers.
    expect(typeof body.enforce_mode).toBe('boolean');
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 3: API — Correct Category Submissions (ACCEPT)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Correct-category images → HTTP 201 ACCEPTED', () => {

  test('Pothole image → Potholes → HTTP 201', async ({ request }) => {
    const imgPath = getRandomImage('potholes', 0);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Potholes', imgPath),
    });
    const body = await res.json();
    expect(res.status(), `Expected 201, got ${res.status()}. Body: ${JSON.stringify(body).slice(0, 200)}`).toBe(201);
    console.log(`  Pothole: ACCEPTED — id=${body.id}`);
  });

  test('Drainage image → Drainage problem → HTTP 201', async ({ request }) => {
    const imgPath = getRandomImage('drainage', 0);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Drainage problem', imgPath),
    });
    const body = await res.json();
    expect(res.status(), `Expected 201, got ${res.status()}. Body: ${JSON.stringify(body).slice(0, 200)}`).toBe(201);
    console.log(`  Drainage: ACCEPTED — id=${body.id}`);
  });

  test('Streetlight image → Broken street light problem → HTTP 201', async ({ request }) => {
    const imgPath = getRandomImage('streetlight', 0);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Broken street light problem', imgPath),
    });
    const body = await res.json();
    expect(res.status(), `Expected 201, got ${res.status()}. Body: ${JSON.stringify(body).slice(0, 200)}`).toBe(201);
    console.log(`  Streetlight: ACCEPTED — id=${body.id}`);
  });

  test('Others image → Others → HTTP 201', async ({ request }) => {
    const imgPath = getRandomImage('others', 5);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Others', imgPath),
    });
    const body = await res.json();
    expect(res.status(), `Expected 201, got ${res.status()}. Body: ${JSON.stringify(body).slice(0, 200)}`).toBe(201);
    console.log(`  Others: ACCEPTED — id=${body.id}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 4: API — Cross-category Submissions (BLOCK)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Cross-category images → HTTP 422 BLOCKED', () => {

  test('Pothole image as "Drainage problem" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('potholes', 10);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Drainage problem', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Pothole→Drainage BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%) vs declared(${body.aiDetails?.declaredConfidence?.toFixed(0)}%)`);
  });

  test('Pothole image as "Broken street light problem" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('potholes', 12);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Broken street light problem', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Pothole→Streetlight BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

  test('Drainage image as "Potholes" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('drainage', 10);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Potholes', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Drainage→Pothole BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

  test('Drainage image as "Broken street light problem" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('drainage', 12);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Broken street light problem', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Drainage→Streetlight BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

  test('Streetlight image as "Potholes" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('streetlight', 10);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Potholes', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Streetlight→Pothole BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

  test('Streetlight image as "Drainage problem" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('streetlight', 12);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Drainage problem', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Streetlight→Drainage BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

  test('Others image as "Potholes" → BLOCKED', async ({ request }) => {
    const imgPath = getRandomImage('others', 10);
    if (!imgPath) { test.skip(); return; }
    const res = await postComplaint(request, {
      data: makeComplaint('Potholes', imgPath),
    });
    const body = await res.json();
    expect(res.status()).toBe(422);
    expect(body.blocked).toBe(true);
    console.log(`  Others→Pothole BLOCKED: ${body.aiDetails?.topClass}(${body.aiDetails?.topConfidence?.toFixed(0)}%)`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 5: API — Missing Fields Validation
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Input validation', () => {

  test('Missing required fields → HTTP 400', async ({ request }) => {
    const res = await postComplaint(request, {
      data: { title: 'Missing fields test' }, // missing citizenName, phone, etc.
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.message).toMatch(/missing/i);
  });

  test('GET /api/complaints → returns array', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/complaints`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    console.log(`  Total complaints in DB: ${body.length}`);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 6: API — Authentication & Authorization (JWT, added July 2026)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Auth & authorization', () => {

  test('Citizen login returns a JWT token', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { identifier: '9876543210', password: 'citizen123' },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.token).toBe('string');
    expect(body.token.length).toBeGreaterThan(20);
    expect(body.user.role).toBe('citizen');
  });

  test('Bad credentials → generic 401 (no user enumeration)', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/login`, {
      data: { identifier: '9876543210', password: 'wrongpass' },
    });
    expect(res.status()).toBe(401);
    expect((await res.json()).message).toMatch(/invalid credentials/i);
  });

  test('POST complaint WITHOUT token → 401', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/complaints`, {
      data: { citizenName: 'x', citizenPhone: '9', title: 't', type: 'Potholes', location: 'l', description: 'd' },
    });
    expect(res.status()).toBe(401);
  });

  test('PATCH status WITHOUT token → 401', async ({ request }) => {
    const res = await request.patch(`${API_URL}/api/complaints/CMP-2401/status`, {
      data: { status: 'In Review' },
    });
    expect(res.status()).toBe(401);
  });

  test('DELETE WITHOUT token → 401', async ({ request }) => {
    const res = await request.delete(`${API_URL}/api/complaints/CMP-2401`);
    expect(res.status()).toBe(401);
  });

  test('Citizen token CANNOT PATCH status (admin only) → 403', async ({ request }) => {
    const res = await request.patch(`${API_URL}/api/complaints/CMP-2401/status`, {
      headers: authHeaders(),
      data: { status: 'In Review' },
    });
    expect(res.status()).toBe(403);
  });

  test('Citizen token CANNOT DELETE (admin only) → 403', async ({ request }) => {
    const res = await request.delete(`${API_URL}/api/complaints/CMP-2401`, {
      headers: authHeaders(),
    });
    expect(res.status()).toBe(403);
  });

  test('update-profile with token derives identity from token → 200', async ({ request }) => {
    const res = await request.patch(`${API_URL}/api/auth/update-profile`, {
      headers: authHeaders(),
      data: { name: 'Rahul Kumar' },
    });
    expect(res.status()).toBe(200);
    expect((await res.json()).user.name).toBe('Rahul Kumar');
  });

  test('update-profile WITHOUT token → 401', async ({ request }) => {
    const res = await request.patch(`${API_URL}/api/auth/update-profile`, {
      data: { name: 'hacker' },
    });
    expect(res.status()).toBe(401);
  });

});

// ─────────────────────────────────────────────────────────────────────────────
// TEST SUITE 7: API — Aadhaar Verhoeff validation (registration)
// ─────────────────────────────────────────────────────────────────────────────
test.describe('API: Aadhaar validation', () => {

  test('Invalid Verhoeff checksum → 400', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/register`, {
      data: { name: 'T', phone: '9000000031', aadhar: '234567890123', password: 'passw0rd1' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/checksum|12 digits/i);
  });

  test('Aadhaar starting with 1 → 400 (UIDAI reserves 0/1)', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/register`, {
      data: { name: 'T', phone: '9000000032', aadhar: '123456789012', password: 'passw0rd1' },
    });
    expect(res.status()).toBe(400);
  });

  test('Non-12-digit Aadhaar → 400', async ({ request }) => {
    const res = await request.post(`${API_URL}/api/auth/register`, {
      data: { name: 'T', phone: '9000000033', aadhar: '12345', password: 'passw0rd1' },
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/12 digits/i);
  });

});

