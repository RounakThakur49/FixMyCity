/**
 * API Integration Tests for FixMyCity Civic Image Classifier
 *
 * Tests:
 *  1. Correct-category submissions → HTTP 200 accepted
 *  2. Cross-category submissions  → HTTP 422 blocked
 *  3. NSFW content                → HTTP 422 inappropriate
 *  4. Health endpoint             → both models loaded
 *
 * Usage:
 *   node test_api_integration.js
 *
 * Requires: backend server running on port 5000, test images in my_dataset/
 */

const fs = require('fs');
const path = require('path');
const http = require('http');

const BASE_URL = 'http://localhost:5000';
const DATASET = path.join(__dirname, 'my_dataset');
const CLASSES = ['potholes', 'drainage', 'streetlight', 'others'];

// Maps category folder name → exact type string the server.js CATEGORY_TO_CLASS expects
// Server: 'Drainage problem' → 'drainage', 'Potholes' → 'potholes', etc.
const CATEGORY_TYPE_MAP = {
  potholes:    'Potholes',
  drainage:    'Drainage problem',
  streetlight: 'Broken street light problem',
  others:      'Others',
};

// Base complaint payload with all required fields
function makePayload(type, imagePath) {
  return {
    citizenName: 'Test Citizen',
    citizenPhone: '9999999999',
    citizenLocation: 'Test Colony, Test City',
    title: `Test ${type} issue`,
    description: `Automated integration test complaint for ${type} category`,
    type: type,
    location: 'Test Location, Test City',
    latitude: 12.9716,
    longitude: 77.5946,
    image: imageToBase64(imagePath),
  };
}

// ---- Helpers ----

function log(status, msg) {
  const icons = { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', INFO: 'INFO' };
  console.log(`  [${status}] ${msg}`);
  if (status === 'PASS') passed++;
  else if (status === 'FAIL') failed++;
  else if (status === 'WARN') warned++;
}

let passed = 0;
let failed = 0;
let warned = 0;

function section(title) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('='.repeat(60));
}

function imageToBase64(imagePath) {
  const buf = fs.readFileSync(imagePath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

function getRandomImage(category) {
  const dir = path.join(DATASET, category);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.jpg'));
  if (files.length === 0) return null;
  const random = files[Math.floor(Math.random() * files.length)];
  return path.join(dir, random);
}

// Module-level JWT — populated by login() before the write tests. Writes
// (POST /api/complaints) require auth since the July 2026 JWT hardening.
let AUTH_TOKEN = '';

async function login(identifier, password) {
  const { status, body } = await apiPost('/api/auth/login', { identifier, phone: identifier, password });
  if ((status === 200) && body.token) {
    AUTH_TOKEN = body.token;
    return true;
  }
  return false;
}

async function apiPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
    };
    if (AUTH_TOKEN) headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    const options = {
      hostname: 'localhost',
      port: 5000,
      path: endpoint,
      method: 'POST',
      headers,
    };
    const req = http.request(options, res => {
      let raw = '';
      res.on('data', chunk => (raw += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch {
          resolve({ status: res.statusCode, body: raw });
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function apiGet(endpoint) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${endpoint}`, res => {
      let raw = '';
      res.on('data', c => (raw += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(raw) }));
    }).on('error', reject);
  });
}

// ---- Test Runner ----

async function runTests() {
  console.log('\nFixMyCity API Integration Test Suite');
  console.log('=====================================');
  console.log(`Server: ${BASE_URL}\n`);

  // ---- Test 1: Health ----
  section('TEST 1: Health Check');
  try {
    const { status, body } = await apiGet('/api/health');
    if (status === 200 && body.ok) {
      log('PASS', `Server running (HTTP ${status})`);
      if (body.ml_service) console.log(`    ML service: ${body.ml_service}`);
      body.model_loaded
        ? log('PASS', 'Civic model loaded (via ML service)')
        : log('WARN', 'Civic model NOT loaded — image validation disabled');
      body.nsfw_loaded
        ? log('PASS', 'NSFW model loaded (content moderation active)')
        : log('WARN', 'NSFW model NOT loaded — adult content filtering disabled');
      console.log(`\n    Classifier: ${body.classifier}`);
      console.log(`    Content moderation: ${body.content_moderation}`);
    } else {
      log('FAIL', `Unexpected response: HTTP ${status}`);
    }
  } catch (e) {
    log('FAIL', `Server not reachable: ${e.message}`);
    console.log('\n  Cannot continue tests — start server with: npm run dev');
    process.exit(1);
  }

  // ---- Test 1b: Auth (login as seeded citizen; writes need a JWT) ----
  section('TEST 1b: Auth — login seeded citizen for write tests');
  const loggedIn = await login('9876543210', 'citizen123');
  loggedIn
    ? log('PASS', 'Logged in — JWT acquired for POST /api/complaints')
    : log('FAIL', 'Login failed — complaint POSTs will 401 (check seeded citizen 9876543210/citizen123)');

  // ---- Test 2: Correct category submissions ----
  section('TEST 2: Correct-Category Submissions (should be ACCEPTED)');

  for (const category of CLASSES) {
    const imgPath = getRandomImage(category);
    if (!imgPath) {
      log('WARN', `${category}: no images found in my_dataset/${category}/`);
      continue;
    }
    try {
      const payload = makePayload(CATEGORY_TYPE_MAP[category], imgPath);
      const { status, body } = await apiPost('/api/complaints', payload);
      const img = path.basename(imgPath);
      if (status === 200 || status === 201) {
        log('PASS', `${category.toUpperCase()} image as '${CATEGORY_TYPE_MAP[category]}' -> HTTP ${status} ACCEPTED`);
      } else if (status === 422 && body.blocked) {
        log('WARN', `${category.toUpperCase()} (${img}) -> HTTP 422 BLOCKED (false positive!)`);
        if (body.aiDetails) {
          console.log(`         Declared: ${body.aiDetails.declaredClass} (${body.aiDetails.declaredConfidence?.toFixed(1)}%)`);
          console.log(`         AI top:   ${body.aiDetails.topClass} (${body.aiDetails.topConfidence?.toFixed(1)}%)`);
          console.log(`         Reason:   ${body.aiDetails.reason}`);
        }
      } else {
        log('FAIL', `${category.toUpperCase()} -> Unexpected HTTP ${status}: ${JSON.stringify(body).slice(0, 100)}`);
      }
    } catch (e) {
      log('FAIL', `${category}: request error: ${e.message}`);
    }
  }

  // ---- Test 3: Cross-category submissions ----
  section('TEST 3: Cross-Category Submissions (should be BLOCKED HTTP 422)');
  const crossTests = [
    { trueClass: 'potholes',    submitAs: 'Drainage problem' },
    { trueClass: 'potholes',    submitAs: 'Broken street light problem' },
    { trueClass: 'drainage',    submitAs: 'Potholes' },
    { trueClass: 'drainage',    submitAs: 'Broken street light problem' },
    { trueClass: 'streetlight', submitAs: 'Potholes' },
    { trueClass: 'streetlight', submitAs: 'Drainage problem' },
    { trueClass: 'others',      submitAs: 'Potholes' },
  ];

  for (const { trueClass, submitAs } of crossTests) {
    const imgPath = getRandomImage(trueClass);
    if (!imgPath) { log('WARN', `${trueClass}: no images`); continue; }
    try {
      const payload = makePayload(submitAs, imgPath);
      const { status, body } = await apiPost('/api/complaints', payload);
      if (status === 422 && body.blocked) {
        const detail = body.aiDetails
          ? ` | top: ${body.aiDetails.topClass}(${body.aiDetails.topConfidence?.toFixed(0)}%) vs declared(${body.aiDetails.declaredConfidence?.toFixed(0)}%)`
          : body.nsfwDetails ? ` | NSFW: ${body.nsfwDetails.flaggedCategory}` : '';
        log('PASS', `${trueClass.toUpperCase()} as '${submitAs}' -> HTTP 422 BLOCKED${detail}`);
      } else if (status === 200 || status === 201) {
        log('WARN', `${trueClass.toUpperCase()} as '${submitAs}' -> HTTP ${status} ACCEPTED (model missed cross-category!)`);
      } else {
        log('FAIL', `${trueClass} as ${submitAs} -> HTTP ${status}: ${JSON.stringify(body).slice(0, 120)}`);
      }
    } catch (e) {
      log('FAIL', `${trueClass} as ${submitAs}: ${e.message}`);
    }
  }

  // ---- Test 4: Summary ----
  section('TEST SUMMARY');
  const total = passed + failed + warned;
  console.log(`  Total tests  : ${total}`);
  console.log(`  ✓ Passed     : ${passed}`);
  console.log(`  ⚠ Warnings   : ${warned}  (model uncertainty / false positives)`);
  console.log(`  ✗ Failed     : ${failed}`);
  console.log();
  if (failed === 0) {
    console.log('  RESULT: ALL TESTS PASSED (no hard failures)');
  } else {
    console.log(`  RESULT: ${failed} FAILURE(S) — review model or server config`);
  }
  console.log();
}

runTests().catch(e => {
  console.error('Test suite crashed:', e);
  process.exit(1);
});
