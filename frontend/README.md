# FixMyCity 🏙️ — Frontend (ReactProjectSample)

The React + TypeScript SPA for **FixMyCity**, a civic grievance-redressal platform. Citizens register and track complaints; admins update work status; a super admin views usage analytics and manages accounts.

This repo pairs with the [NodeProjectSample](https://github.com/debmalyo-hub07/NodeProjectSample.git) backend, whose JSON API it consumes. Fork of [`debmalyo-hub07/ReactProjectSample`](https://github.com/debmalyo-hub07/ReactProjectSample.git).

---

## 🛠️ Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | React 19 + TypeScript |
| Build | Vite 8 |
| UI | MUI 9 (`@mui/material`, `@mui/lab`, `@mui/icons-material`) + custom CSS |
| State | Redux + redux-saga |
| HTTP | Axios (`src/apis/axios.baseClient.ts`) |
| Fonts | Plus Jakarta Sans / Inter / JetBrains Mono (loaded in `index.html`) |

> **Node.js ≥ 20.19 (or 22.12+)** is required by Vite 8. Older versions boot with a warning but may misbehave.

---

## ⚙️ Setup

```bash
git clone https://github.com/debmalyo-hub07/ReactProjectSample.git
cd ReactProjectSample
npm install
npm run dev        # Vite dev server → http://localhost:5173
```

The backend must be running on `http://localhost:3000`. Vite proxies `/auth`, `/user`, `/admin`, `/superadmin`, `/photo`, `/uploads` to it (see `vite.config.ts`), so no CORS/base-URL config is needed in dev — `BASE_URL` is intentionally `""`.

### Scripts
| Command | Does |
|---------|------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | ESLint |

---

## 🧭 Architecture

```
index.html                 # Fonts, favicon, root
src/
  main.tsx                 # Root render + MUI theme (palette/typography/component defaults)
  index.css                # Global reset + base tokens
  App.tsx                  # Role/view router (citizen | admin | superadmin) + layout shell
  apis/
    api.constants.ts       # BASE_URL + endpoint paths
    axios.baseClient.ts    # Axios instance (withCredentials)
    functions.ts           # Typed API call wrappers
  actions/                 # Redux slices + sagas (auth, admin, citizen)
  reducers/                # Root reducer + per-domain reducers
  store/store.ts           # Store + typed hooks (useAppDispatch)
  components/
    layout/                # Screens: Login, Registration, TabGroup, userHome, adminHome,
                           #   complaintRegister, complaintDetails, updateStatus, useage,
                           #   Profile, ResponsiveAppBar, complaintMap
    SelectionField/        # StateSelect + SelectCity/<State>.tsx (per-state city pickers)
  assets/                  # Logo.jpg, background1.jpg, etc.
```

### Roles → views (`App.tsx`)
- **Not logged in** → `TabGroup` (Register / Login).
- **citizen** → `UserHome` (My Complaints Tracker) → `ComplaintRegister`.
- **admin** → `AdminHome` (Operations Control + map + status update).
- **superadmin** → `AdminHome` + `Useage` (analytics, user management).

The logged-in user object lives in `state.auth.user`; role is read as `user.user.role`. Auth is sent to the backend as an `Authorization: <id>:<role>` header (see `apis/functions.ts`).

### Backend field binding (do not paraphrase)
Complaints key on the **string `id`** (fallback `_id`). Status via `statusMap[id].workstatus`. Images at `/photo/<photoUrl>`. Status text is matched loosely (`includes('progress')`, `includes('complete')`) → Pending / Work on Progress / Completed. Keep these exact when editing.

---

## 🎨 Design system
Government-affiliated civic look: deep teal `#0f766e` (authority) + bright teal `#14b8a6` (interactive) + slate ink, frosted-glass panels, gradient status chips (orange = pending, blue/amber = in progress, green = completed). Tokens live in the MUI theme (`main.tsx`) and `components/layout/Registration.css`. **`shape.borderRadius` is intentionally left at MUI's default `4`** — existing components use numeric radii (`borderRadius: 3` = 12px) that depend on it.

---

## 📌 Future work
- Section-by-section logic/feature build-out (UI/UX is currently stable and should be preserved).
- Code-splitting (main bundle > 500 kB).
- Password strength/visibility, richer form validation.

See [CLAUDE.md](./CLAUDE.md) for agent/workflow conventions.

## 👤 Author
**Debarun Roy**
