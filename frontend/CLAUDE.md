# CLAUDE.md — ReactProjectSample (FixMyCity Frontend)

Guidance for AI agents working in this repo. Read before making changes.

## What this is
React 19 + TypeScript + Vite 8 SPA for FixMyCity. UI is **MUI 9 + custom CSS**; state is **Redux + redux-saga**. Talks to the [NodeProjectSample](https://github.com/debmalyo-hub07/NodeProjectSample.git) backend (`:3000`) via a Vite dev proxy. Fork of `debmalyo-hub07/ReactProjectSample`; changes here become PRs to the original.

## Golden rules
1. **UI/UX is frozen for now.** Current phase = docs + verification + presentation polish. Do **not** change component logic, redux/saga wiring, handler names, or data-flow. Feature/logic work happens later, section by section, on request.
2. **Do not rename** components, props, actions, or files.
3. **Backend field names are a contract.** Bind complaints by string `id` (not `_id`); status via `statusMap[id].workstatus`; images at `/photo/<photoUrl>`. Preserve `issuetype`, `locationUrl`, `aadhar`, `workstatus` casing. The backend expects `Authorization: <id>:<role>` and multipart file field `photo`.
4. **`shape.borderRadius` stays `4`** in `main.tsx`. Components use numeric radii like `borderRadius: 3` (= 3 × 4 = 12px); changing the base silently rescales every radius. Use explicit px for new radii.

## Run & verify
```bash
npm install
npm run dev        # → http://localhost:5173 (backend must run on :3000)
```
Before claiming done, always:
```bash
node node_modules/typescript/bin/tsc -b      # 0 errors
node node_modules/vite/bin/vite.js build     # exit 0
```
There is no unit-test suite. Verify visually / via build. `noUnusedLocals` and `noUnusedParameters` are **off**, so stray imports won't fail the build — still keep clean.

## Layout
- `src/main.tsx` — root render + the single source-of-truth MUI theme (palette, typography = Plus Jakarta Sans, component defaults). Custom `'2xl'` breakpoint is type-augmented here.
- `src/App.tsx` — role/view state machine (`citizen | admin | superadmin`, else `TabGroup`) + layout shell. `view` persisted in `sessionStorage`. **Don't touch the state machine.**
- `src/apis/` — `api.constants.ts` (paths, `BASE_URL=""`), `axios.baseClient.ts` (`withCredentials`), `functions.ts` (call wrappers, attach auth header).
- `src/actions/` + `src/reducers/` + `src/store/store.ts` — Redux + saga. Use `useAppDispatch` (typed).
- `src/components/layout/` — the screens (see README).
- `src/components/SelectionField/` — `StateSelect.tsx` + `SelectCity/<State>.tsx`. **Gotcha:** the city dropdown is disabled until a state is chosen; `StateSelect`'s `renderInput` must pass `{...params}` plainly to its `TextField` — wrapping the input via `slotProps` breaks Autocomplete's ref/handlers and freezes selection.

## Design tokens
Teal authority `#0f766e` + interactive `#14b8a6`, slate ink `#0f172a/#475569/#64748b`, status colors (pending orange `#f97316→#ea580c`, progress blue/amber `#3b82f6/#eab308`, completed green `#22c55e→#15803d`). Glass panels, gradient chips. Auth screens styled in `components/layout/Registration.css`; everything else via MUI `sx` + theme. Fonts are loaded in `index.html` (they were previously declared but never loaded).

## Commit etiquette
Small, scoped, reviewable commits for the upstream PR. Don't reformat untouched files. Keep the diff minimal.
