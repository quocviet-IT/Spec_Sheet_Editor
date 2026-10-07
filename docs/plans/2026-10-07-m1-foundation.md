# M1 Foundation Implementation Plan

> Work through the tasks in order. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployable Next.js 16 app with the full database schema (tables, functions, triggers, RLS, storage bucket), Google sign-in with domain/suspension checks, a bilingual (VI/EN) shell, an access guard for Staff and Admin areas, and CI.

**Architecture:** Next.js App Router; Supabase Auth (Google) via `@supabase/ssr` cookies, refreshed in `src/proxy.ts`. All authorisation lives in the database (`is_allowed_user()`, `is_admin()`, RLS); the app asks the database (`my_access_status()`, `profiles`) and turns the answer into allow / redirect / 404 with one pure function (`decideAccess`). Migrations are plain SQL applied by a small postgres.js runner over the Supabase session pooler; SQL tests run inside transactions that are always rolled back.

**Tech Stack:** Next.js 16.3.3, React 19.2.8, TypeScript 5, Tailwind CSS 4, Zod 4, @supabase/ssr 0.12, @supabase/supabase-js 2.112, postgres 3.4 (scripts/tests), Vitest 4, tsx, dotenv.

**Spec:** [`docs/design/spec-sheet-editor-design.md`](../design/spec-sheet-editor-design.md) — chapters 2.4–2.5, 3, 5.4, 6 and Appendix A. Roadmap: [`2026-10-07-spec-sheet-editor-roadmap.md`](2026-10-07-spec-sheet-editor-roadmap.md).

## Global Constraints

- Repo is **public**: never commit `.env.local`, real sheets, SO/MO numbers or keys. Stage files one by one.
- File names, commit messages and documents are in English. The only Vietnamese text in the repository is interface copy: the dictionary `src/messages/vi.ts` and the language's own name ("Tiếng Việt") on the VI/EN switch.
- Bilingual VI/EN, default `vi`; every user-facing string comes from `src/messages/vi.ts` + `src/messages/en.ts`; `en` is typed against `vi`, so a missing key fails `npm run typecheck`.
- Module-level constant tables must not hold translated strings (they are evaluated once); pass `t` or build them in a function.
- Code, identifiers and comments in English.
- Default permitted domain `ctyhp.vn`. Supabase region Singapore, Vercel `sin1`.
- postgres.js connections: `max: 1`, `prepare: false` (Supabase pooler has 15 session slots).
- SQL tests touch the configured database only inside transactions that end in `ROLLBACK`.
- Deviation from design Appendix A, deliberate: adds `my_access_status()` (the app needs to tell "suspended" from "not permitted"), the `spec-sheets` bucket insert, and the login error for a non-permitted account does not echo the email (no personal data in URLs).

## File structure

| File | Responsibility |
|---|---|
| `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.mts`, `vercel.json`, `.env.example` | Toolchain |
| `src/app/globals.css` | Design tokens (light/dark) wired into Tailwind 4 |
| `src/lib/env.ts` | Validated server environment |
| `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts` | Supabase clients (user session; secret key, server-only) |
| `src/proxy.ts` | Session refresh + `x-pathname` header for every request |
| `src/messages/*` | Locale parsing, VI/EN dictionaries, server/client accessors, switch action |
| `src/auth/redirect.ts` | `safeNext()` — open-redirect-safe post-login path |
| `src/auth/access.ts` | `decideAccess()` — pure allow/login/404 decision |
| `src/auth/session.ts` | `loadAccess()`, `requireUser()`, `requireAdmin()` |
| `src/auth/actions.ts` | `signInWithGoogle()`, `signOut()` server actions |
| `src/app/login/page.tsx`, `src/app/auth/callback/route.ts` | Sign-in screen and OAuth callback |
| `src/app/(app)/layout.tsx`, `src/app/(app)/sheets/page.tsx`, `src/app/(app)/admin/layout.tsx`, `src/app/(app)/admin/page.tsx` | Guarded shell, Staff and Admin landing pages |
| `src/ui/app-header.tsx`, `src/ui/language-switch.tsx` | Header bar and VI/EN switch |
| `supabase/migrations/0001_init.sql` | Whole schema |
| `scripts/migrate.mts` | Applies pending migrations |
| `tests/unit/*.test.ts` | Pure-function tests |
| `tests/sql/harness.ts`, `tests/sql/*.test.ts` | Database tests (skipped without `DATABASE_URL`) |
| `.github/workflows/ci.yml`, `README.md` | CI and setup guide |

---

### Task 1: Toolchain scaffold

**Files:**
- Create: `package.json`, `tsconfig.json`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `vitest.config.mts`, `vercel.json`, `.env.example`, `tests/setup.ts`, `src/app/globals.css`, `src/app/layout.tsx` (temporary), `src/app/page.tsx`
- Modify: `.gitignore`

**Interfaces:**
- Produces: npm scripts `dev`, `build`, `start`, `lint`, `typecheck`, `test`, `db:migrate`; Tailwind colour utilities `paper`, `surface`, `sunk`, `ink`, `ink-2`, `ink-3`, `line`, `accent`, `accent-ink`, `accent-soft`, `mark`, `edit`, `danger`, `danger-soft`, `warn-soft`; font utilities `font-sans`, `font-mono`; path alias `@/` → `src/`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "spec-sheet-editor",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:migrate": "tsx scripts/migrate.mts"
  },
  "dependencies": {
    "@supabase/ssr": "^0.12.5",
    "@supabase/supabase-js": "^2.112.4",
    "next": "16.3.3",
    "react": "19.2.8",
    "react-dom": "19.2.8",
    "server-only": "^0.0.1",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "^4",
    "@types/node": "^22",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "dotenv": "^17.4.2",
    "eslint": "^9",
    "eslint-config-next": "16.3.3",
    "postgres": "^3.4.9",
    "tailwindcss": "^4",
    "tsx": "^4.23.12",
    "typescript": "^5",
    "vitest": "^4.1.11"
  }
}
```

- [ ] **Step 2: Write the config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", "**/*.mts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts"],
  "exclude": ["node_modules", "research"]
}
```

`next.config.ts`:
```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {};

export default nextConfig;
```

`postcss.config.mjs`:
```js
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
```

`eslint.config.mjs`:
```js
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "research/**", "docs/**"]),
]);
```

`vitest.config.mts`:
```ts
import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // SQL tests reach the Supabase pooler in Singapore; the first connection can be slow.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
      // "server-only" throws outside a React Server Component; tests import server modules directly.
      "server-only": path.resolve(root, "node_modules/server-only/empty.js"),
    },
  },
});
```

`vercel.json`:
```json
{ "regions": ["sin1"] }
```

`.env.example`:
```bash
# Copy to .env.local and fill in. Never commit .env.local.
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxx
SUPABASE_SECRET_KEY=sb_secret_xxxxx
# Session pooler (port 5432). Used only by scripts/migrate.mts and tests/sql.
DATABASE_URL=postgresql://postgres.xxxxx:PASSWORD@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres
```

`tests/setup.ts`:
```ts
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });
```

Append to `.gitignore`:
```gitignore
next-env.d.ts
*.tsbuildinfo
coverage/
playwright-report/
test-results/
```

- [ ] **Step 3: Write the design tokens and a temporary page**

`src/app/globals.css`:
```css
@import "tailwindcss";

/* Light palette first; the dark block only redefines the same tokens. The spec sheet itself is paper
   and stays white in both themes, so sheet colours are not tokens here. */
:root {
  --paper: #f5f7f5;
  --surface: #ffffff;
  --sunk: #edf1ee;
  --ink: #16201b;
  --ink-2: #47534d;
  --ink-3: #66726c;
  --line: #d5ddd8;
  --accent: #1d6b4b;
  --accent-ink: #ffffff;
  --accent-soft: #e1efe7;
  --mark: #1f55d6;
  --edit: #a84e08;
  --danger: #b42318;
  --danger-soft: #fdecea;
  --warn-soft: #fff4d6;
  color-scheme: light;
}

@media (prefers-color-scheme: dark) {
  :root {
    --paper: #0f1412;
    --surface: #161d1a;
    --sunk: #1c2521;
    --ink: #e3ebe6;
    --ink-2: #a8b4ae;
    --ink-3: #8b978f;
    --line: #2a3530;
    --accent: #62c194;
    --accent-ink: #0a1510;
    --accent-soft: #16291f;
    --mark: #86a8ff;
    --edit: #f4a35c;
    --danger: #ff8d80;
    --danger-soft: #3a1714;
    --warn-soft: #2d240c;
    color-scheme: dark;
  }
}

@theme inline {
  --color-paper: var(--paper);
  --color-surface: var(--surface);
  --color-sunk: var(--sunk);
  --color-ink: var(--ink);
  --color-ink-2: var(--ink-2);
  --color-ink-3: var(--ink-3);
  --color-line: var(--line);
  --color-accent: var(--accent);
  --color-accent-ink: var(--accent-ink);
  --color-accent-soft: var(--accent-soft);
  --color-mark: var(--mark);
  --color-edit: var(--edit);
  --color-danger: var(--danger);
  --color-danger-soft: var(--danger-soft);
  --color-warn-soft: var(--warn-soft);
  --font-sans: var(--font-be-vietnam), system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: var(--font-plex-mono), ui-monospace, "Cascadia Mono", Consolas, monospace;
}

body {
  background: var(--paper);
  color: var(--ink);
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

`src/app/layout.tsx` (replaced in Task 7):
```tsx
import "./globals.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>{children}</body>
    </html>
  );
}
```

`src/app/page.tsx`:
```tsx
import { redirect } from "next/navigation";

export default function Home() {
  redirect("/sheets");
}
```

- [ ] **Step 4: Install and verify the toolchain**

Run: `npm install`
Expected: completes; `package-lock.json` created.

Run: `npm run lint && npm run typecheck && npm run build`
Expected: all three succeed (build lists routes `/` and `/_not-found`).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json tsconfig.json next.config.ts postcss.config.mjs eslint.config.mjs vitest.config.mts vercel.json .env.example .gitignore tests/setup.ts src/app/globals.css src/app/layout.tsx src/app/page.tsx
git commit -m "chore: Next.js 16 scaffold with Tailwind 4 tokens and Vitest"
```

---

### Task 2: Validated environment

**Files:**
- Create: `src/lib/env.ts`
- Test: `tests/unit/env.test.ts`

**Interfaces:**
- Produces: `type Env = { NEXT_PUBLIC_SUPABASE_URL: string; NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: string; SUPABASE_SECRET_KEY: string }`; `parseEnv(raw: Record<string, string | undefined>): Env` (throws `Error` naming every bad key); `getEnv(): Env` (cached).

- [ ] **Step 1: Write the failing test**

`tests/unit/env.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseEnv } from "@/lib/env";

const good = {
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_x",
  SUPABASE_SECRET_KEY: "sb_secret_x",
};

describe("parseEnv", () => {
  it("accepts a complete environment", () => {
    expect(parseEnv(good)).toEqual(good);
  });

  it("names every missing key", () => {
    expect(() => parseEnv({ NEXT_PUBLIC_SUPABASE_URL: good.NEXT_PUBLIC_SUPABASE_URL })).toThrow(
      /NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.*SUPABASE_SECRET_KEY/,
    );
  });

  it("rejects a URL that is not a URL", () => {
    expect(() => parseEnv({ ...good, NEXT_PUBLIC_SUPABASE_URL: "abc.supabase" })).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: FAIL — cannot resolve `@/lib/env`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/env.ts`:
```ts
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  SUPABASE_SECRET_KEY: z.string().min(1),
});

export type Env = z.infer<typeof schema>;

/** Pure: used by tests and by getEnv. Throws one error that names every bad key. */
export function parseEnv(raw: Record<string, string | undefined>): Env {
  const result = schema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment — ${detail}`);
  }
  return result.data;
}

let cached: Env | null = null;

/** Server-side environment, validated once per process. */
export function getEnv(): Env {
  cached ??= parseEnv(process.env);
  return cached;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/unit/env.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/env.ts tests/unit/env.test.ts
git commit -m "feat(env): validate Supabase environment with one error naming every bad key"
```

---

### Task 3: Bilingual messages (VI/EN)

**Files:**
- Create: `src/messages/locale.ts`, `src/messages/vi.ts`, `src/messages/en.ts`, `src/messages/index.ts`, `src/messages/server.ts`, `src/messages/client.tsx`, `src/messages/actions.ts`
- Test: `tests/unit/locale.test.ts`, `tests/unit/messages.test.ts`

**Interfaces:**
- Produces: `type Locale = "vi" | "en"`; `LOCALES`, `DEFAULT_LOCALE = "vi"`, `LOCALE_COOKIE = "locale"`, `LOCALE_COOKIE_MAX_AGE`, `parseLocale(raw: unknown): Locale`, `LOCALE_LABEL`, `LOCALE_SHORT`; `type Messages` (loosened `typeof vi`); `getDictionary(locale: Locale): Messages`; server: `getLocale(): Promise<Locale>`, `getMessages(): Promise<Messages>`; client: `<LocaleProvider locale>`, `useLocale(): Locale`, `useMessages(): Messages`; server action `setLocale(form: FormData): Promise<void>` reading field `locale`.
- Message keys used later in M1: `app.name`, `app.tagline`, `common.signOut`, `common.language`, `common.admin`, `common.sheets`, `login.title`, `login.lead`, `login.google`, `login.errors.notPermitted|suspended|google`, `sheets.title`, `sheets.empty`, `admin.title`, `admin.lead`, `admin.areas.users|access|audit|cleanup`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/locale.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, parseLocale } from "@/messages/locale";

describe("parseLocale", () => {
  it("keeps a supported locale", () => {
    expect(parseLocale("en")).toBe("en");
    expect(parseLocale("vi")).toBe("vi");
  });

  it("falls back to Vietnamese for anything else", () => {
    expect(DEFAULT_LOCALE).toBe("vi");
    for (const raw of ["fr", "", undefined, null, 1, "EN"]) expect(parseLocale(raw)).toBe("vi");
  });
});
```

`tests/unit/messages.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { en, vi } from "@/messages";

function paths(obj: unknown, prefix = ""): string[] {
  if (typeof obj === "string") return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) => paths(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(obj: unknown): string[] {
  if (typeof obj === "string") return [obj];
  return Object.values(obj as Record<string, unknown>).flatMap(leaves);
}

describe("message dictionaries", () => {
  it("have exactly the same keys", () => {
    expect(paths(en).sort()).toEqual(paths(vi).sort());
  });

  it("have no empty strings", () => {
    for (const s of [...leaves(vi), ...leaves(en)]) expect(s.trim()).not.toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/locale.test.ts tests/unit/messages.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/messages/locale.ts`:
```ts
/** Interface language. Pure: no cookies, no React, usable on server, client and in tests. */
export const LOCALES = ["vi", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "vi";

/** Cookie holding a staff member's choice on their own machine. */
export const LOCALE_COOKIE = "locale";

/** One year: switching language is a one-off choice, not per session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Untrusted input (cookie, form field) to a locale. Never throws. */
export function parseLocale(raw: unknown): Locale {
  return LOCALES.includes(raw as Locale) ? (raw as Locale) : DEFAULT_LOCALE;
}

export const LOCALE_LABEL: Record<Locale, string> = { vi: "Tiếng Việt", en: "English" };
export const LOCALE_SHORT: Record<Locale, string> = { vi: "VI", en: "EN" };
```

`src/messages/vi.ts`:
```ts
export const vi = {
  app: {
    name: "Spec Sheet Editor",
    tagline: "Sửa số kích thước trên phiếu Product Specifications",
  },
  common: {
    signOut: "Đăng xuất",
    language: "Ngôn ngữ",
    admin: "Quản trị",
    sheets: "Phiếu",
  },
  login: {
    title: "Đăng nhập",
    lead: "Dùng tài khoản Google công ty.",
    google: "Đăng nhập bằng Google",
    errors: {
      notPermitted: "Tài khoản Google này không thuộc tên miền được phép. Hãy đăng nhập bằng email công ty.",
      suspended: "Tài khoản của bạn đã bị khoá. Liên hệ quản trị viên.",
      google: "Không đăng nhập được với Google. Thử lại.",
    },
  },
  sheets: {
    title: "Phiếu",
    empty: "Chưa có phiếu nào.",
  },
  admin: {
    title: "Quản trị",
    lead: "Chỉ quản trị viên thấy khu này.",
    areas: {
      users: "Người dùng",
      access: "Truy cập và cấu hình",
      audit: "Nhật ký hoạt động",
      cleanup: "Thùng rác và dọn dẹp",
    },
  },
} as const;
```

`src/messages/index.ts`:
```ts
import { vi } from "./vi";
import { en } from "./en";
import type { Locale } from "./locale";

/**
 * `vi` is declared `as const`, so `typeof vi` holds the literal Vietnamese strings. Loosen every leaf to
 * `string` but keep the key set: `en` must then have exactly the same keys or the build fails.
 */
type Loosen<T> = { [K in keyof T]: T[K] extends string ? string : Loosen<T[K]> };

export type Messages = Loosen<typeof vi>;

const DICTIONARIES: Record<Locale, Messages> = { vi, en };

export function getDictionary(locale: Locale): Messages {
  return DICTIONARIES[locale] ?? vi;
}

export { vi, en };
export type { Locale };
```

`src/messages/en.ts`:
```ts
import type { Messages } from "./index";

export const en: Messages = {
  app: {
    name: "Spec Sheet Editor",
    tagline: "Edit the dimension values on Product Specifications sheets",
  },
  common: {
    signOut: "Sign out",
    language: "Language",
    admin: "Admin",
    sheets: "Sheets",
  },
  login: {
    title: "Sign in",
    lead: "Use your company Google account.",
    google: "Sign in with Google",
    errors: {
      notPermitted: "This Google account is not in a permitted domain. Sign in with your company email.",
      suspended: "Your account has been suspended. Contact an administrator.",
      google: "Google sign-in did not complete. Try again.",
    },
  },
  sheets: {
    title: "Sheets",
    empty: "No sheets yet.",
  },
  admin: {
    title: "Admin",
    lead: "Only administrators can see this area.",
    areas: {
      users: "Users",
      access: "Access and settings",
      audit: "Audit log",
      cleanup: "Trash and clean-up",
    },
  },
};
```

`src/messages/server.ts`:
```ts
import "server-only";
import { cookies } from "next/headers";
import { getDictionary, type Messages } from "./index";
import { LOCALE_COOKIE, parseLocale, type Locale } from "./locale";

/** Locale of the current request. Next de-duplicates cookies() within a request, so call it anywhere. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  return parseLocale(store.get(LOCALE_COOKIE)?.value);
}

export async function getMessages(): Promise<Messages> {
  return getDictionary(await getLocale());
}
```

`src/messages/actions.ts`:
```ts
"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, parseLocale } from "./locale";

/**
 * Switch the interface language. Written on the server (not document.cookie) because server components
 * read the language from the request cookie; revalidate the whole layout because every page changes.
 */
export async function setLocale(form: FormData): Promise<void> {
  const locale = parseLocale(form.get("locale"));
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, { path: "/", maxAge: LOCALE_COOKIE_MAX_AGE, sameSite: "lax" });
  revalidatePath("/", "layout");
}
```

`src/messages/client.tsx`:
```tsx
"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { getDictionary, type Messages } from "./index";
import { DEFAULT_LOCALE, type Locale } from "./locale";

/** Only the locale code crosses to the browser; both dictionaries are already in the bundle. */
const LocaleContext = createContext<Locale>(DEFAULT_LOCALE);

export function LocaleProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(LocaleContext);
}

export function useMessages(): Messages {
  const locale = useContext(LocaleContext);
  return useMemo(() => getDictionary(locale), [locale]);
}
```

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run tests/unit/locale.test.ts tests/unit/messages.test.ts && npm run typecheck`
Expected: PASS (4 tests); typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/messages tests/unit/locale.test.ts tests/unit/messages.test.ts
git commit -m "feat(i18n): VI/EN dictionaries typed against each other, cookie locale, switch action"
```

---

### Task 4: Database schema and migration runner

**Files:**
- Create: `supabase/migrations/0001_init.sql`, `scripts/migrate.mts`

**Interfaces:**
- Produces (database): tables `profiles`, `allowed_domains`, `allowed_emails`, `app_settings`, `spec_sheets`, `audit_log`; functions `is_allowed_user()`, `is_admin()`, `my_access_status() → 'ok' | 'signed_out' | 'not_permitted' | 'suspended'`, `touch_profile()`, `log_client_event(text, uuid, jsonb)`, `set_user_role(uuid, text)`, `set_user_status(uuid, text)`, `add_allowed(text, text, text)`, `remove_allowed(text, text)`, `set_setting(text, numeric)`, `save_sheet(uuid, int, text, jsonb, jsonb) → table(saved, new_version, is_deleted, by_name, saved_at)`, `purge_sheet(uuid)`, `log_maintenance(int, bigint)`; storage bucket `spec-sheets` (private, 50 MB cap, pdf/png/jpeg).
- Produces (script): `npm run db:migrate` applies `supabase/migrations/NNNN_*.sql` once each, recorded in `public.schema_migrations`.

- [ ] **Step 1: Write `supabase/migrations/0001_init.sql`**

```sql
-- 0001_init: Spec Sheet Editor schema (design v1.2, Appendix A, plus my_access_status and the bucket).

-- ===== Tables =====
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  full_name    text,
  avatar_url   text,
  role         text not null default 'user'   check (role in ('user', 'admin')),
  status       text not null default 'active' check (status in ('active', 'suspended')),
  suspended_at timestamptz,
  suspended_by uuid references public.profiles (id),
  last_seen_at timestamptz,
  updated_at   timestamptz not null default now()
);

create table public.allowed_domains (
  domain     text primary key check (domain = lower(domain) and domain !~ '\s' and domain like '%.%'),
  note       text,
  created_at timestamptz not null default now()
);
create table public.allowed_emails (
  email      text primary key check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+$'),
  note       text,
  created_by uuid references public.profiles (id),
  created_at timestamptz not null default now()
);
insert into public.allowed_domains (domain, note) values ('ctyhp.vn', 'default');

create table public.app_settings (
  key        text primary key
             check (key in ('max_file_mb', 'lowres_warn_px', 'aspect_tolerance_pct', 'signed_url_ttl_min')),
  value      numeric not null,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('max_file_mb', 20), ('lowres_warn_px', 2000), ('aspect_tolerance_pct', 2), ('signed_url_ttl_min', 10);

create table public.spec_sheets (
  id          uuid primary key,
  name        text not null check (length(btrim(name)) between 1 and 200),
  source_type text not null check (source_type in ('pdf', 'png', 'jpg')),
  source_path text not null,
  thumb_path  text not null,
  page_px_w   int  not null check (page_px_w > 0),
  page_px_h   int  not null check (page_px_h > 0),
  detections  jsonb not null default '[]' check (jsonb_typeof(detections) = 'array'),
  edits       jsonb not null default '[]' check (jsonb_typeof(edits) = 'array'),
  version     int  not null default 1,
  created_by  uuid not null references public.profiles (id),
  created_at  timestamptz not null default now(),
  updated_by  uuid not null references public.profiles (id),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz,
  deleted_by  uuid references public.profiles (id)
);
create index spec_sheets_live  on public.spec_sheets (updated_at desc) where deleted_at is null;
create index spec_sheets_trash on public.spec_sheets (deleted_at desc) where deleted_at is not null;

create table public.audit_log (
  id          bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  actor_id    uuid references public.profiles (id) on delete set null,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  detail      jsonb not null default '{}'
);
create index audit_log_time   on public.audit_log (occurred_at desc);
create index audit_log_actor  on public.audit_log (actor_id, occurred_at desc);
create index audit_log_target on public.audit_log (target_type, target_id);

-- ===== Access checks (BR-08) =====
create function public.is_allowed_user() returns boolean
language sql stable security definer set search_path = public as $$
  with me as (select lower(coalesce(auth.jwt() ->> 'email', '')) as email)
  select me.email ~ '^[^@\s]+@[^@\s]+$'
     and (exists (select 1 from allowed_domains d where d.domain = split_part(me.email, '@', 2))
          or exists (select 1 from allowed_emails e where e.email = me.email))
     and not exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended')
  from me
$$;

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_allowed_user()
     and exists (select 1 from profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active')
$$;

-- Lets the app tell "suspended" from "not permitted" without reading tables RLS hides from those users.
create function public.my_access_status() returns text
language sql stable security definer set search_path = public as $$
  select case
    when auth.uid() is null then 'signed_out'
    when exists (select 1 from profiles p where p.id = auth.uid() and p.status = 'suspended') then 'suspended'
    when not public.is_allowed_user() then 'not_permitted'
    else 'ok'
  end
$$;

-- ===== Audit log (BR-15) =====
create function public._audit(p_action text, p_target_type text, p_target_id text, p_detail jsonb)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (actor_id, actor_email, action, target_type, target_id, detail)
  values (auth.uid(), auth.jwt() ->> 'email', p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'))
$$;
revoke execute on function public._audit(text, text, text, jsonb) from public, anon, authenticated;

create function public.trg_audit_append_only() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_update   before update or delete on public.audit_log
  for each statement execute function public.trg_audit_append_only();
create trigger audit_no_truncate before truncate on public.audit_log
  for each statement execute function public.trg_audit_append_only();

create function public.log_client_event(p_action text, p_target_id uuid, p_detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  if p_action not in ('sheet.export_png', 'sheet.export_pdf') then raise exception 'action_not_allowed'; end if;
  perform _audit(p_action, 'sheet', p_target_id::text, p_detail);
end $$;

-- ===== Profiles =====
create function public.touch_profile() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_allowed_user() then raise exception 'forbidden'; end if;
  insert into profiles (id, email, full_name, avatar_url, last_seen_at)
  values (auth.uid(), lower(auth.jwt() ->> 'email'),
          auth.jwt() -> 'user_metadata' ->> 'full_name',
          auth.jwt() -> 'user_metadata' ->> 'avatar_url', now())
  on conflict (id) do update
     set email = excluded.email, full_name = excluded.full_name,
         avatar_url = excluded.avatar_url, last_seen_at = now(), updated_at = now();
  perform _audit('auth.login', 'user', auth.uid()::text, '{}');
end $$;

create function public.trg_profile_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(hashtext('admin_guard'));     -- two Admins cannot demote each other at once
  if old.role = 'admin' and old.status = 'active'
     and (new.role <> 'admin' or new.status <> 'active')
     and not exists (select 1 from profiles p
                      where p.id <> old.id and p.role = 'admin' and p.status = 'active') then
    raise exception 'last_admin' using hint = 'At least one active admin must remain.';
  end if;
  if new.role is distinct from old.role then
    perform _audit('user.role_change', 'user', new.id::text,
                   jsonb_build_object('email', new.email, 'from', old.role, 'to', new.role));
  end if;
  if new.status is distinct from old.status then
    perform _audit(case when new.status = 'suspended' then 'user.suspend' else 'user.unsuspend' end,
                   'user', new.id::text, jsonb_build_object('email', new.email));
  end if;
  return new;
end $$;
create trigger profile_guard before update on public.profiles
  for each row execute function public.trg_profile_guard();

create function public.set_user_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update profiles set role = p_role, updated_at = now() where id = p_user;
end $$;

create function public.set_user_status(p_user uuid, p_status text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_user = auth.uid() and p_status = 'suspended' then raise exception 'self_suspend'; end if;
  update profiles
     set status       = p_status,
         suspended_at = case when p_status = 'suspended' then now() end,
         suspended_by = case when p_status = 'suspended' then auth.uid() end,
         updated_at   = now()
   where id = p_user;
end $$;

-- ===== Access (BR-17) and settings =====
create function public.add_allowed(p_kind text, p_value text, p_note text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(p_value));
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'domain' then insert into allowed_domains (domain, note) values (v, p_note);
  else insert into allowed_emails (email, note, created_by) values (v, p_note, auth.uid()); end if;
  perform _audit('access.add', p_kind, v, jsonb_build_object('note', p_note));
end $$;

create function public.remove_allowed(p_kind text, p_value text) returns void
language plpgsql security definer set search_path = public as $$
declare v text := lower(btrim(p_value));
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_kind = 'domain' then delete from allowed_domains where domain = v;
  else delete from allowed_emails where email = v; end if;
  if not is_allowed_user() then raise exception 'self_lockout'; end if;   -- rolls back the whole call
  perform _audit('access.remove', p_kind, v, '{}');
end $$;

create function public.set_setting(p_key text, p_value numeric) returns void
language plpgsql security definer set search_path = public as $$
declare v_old numeric;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if not ((p_key = 'max_file_mb'          and p_value between 1 and 50)
       or (p_key = 'lowres_warn_px'       and p_value between 800 and 5000)
       or (p_key = 'aspect_tolerance_pct' and p_value between 0.5 and 5)
       or (p_key = 'signed_url_ttl_min'   and p_value between 1 and 60)) then
    raise exception 'out_of_range';
  end if;
  select value into v_old from app_settings where key = p_key for update;
  update app_settings set value = p_value, updated_by = auth.uid(), updated_at = now() where key = p_key;
  perform _audit('settings.update', 'setting', p_key, jsonb_build_object('from', v_old, 'to', p_value));
end $$;

-- ===== Sheets =====
create function public.trg_sheet_immutable() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.source_path <> old.source_path or new.thumb_path <> old.thumb_path
     or new.source_type <> old.source_type then
    raise exception 'immutable_column';
  end if;
  return new;
end $$;
create trigger sheet_immutable before update on public.spec_sheets
  for each row execute function public.trg_sheet_immutable();

create function public.trg_sheet_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _audit('sheet.upload', 'sheet', new.id::text, jsonb_build_object('name', new.name, 'type', new.source_type));
  elsif tg_op = 'DELETE' then
    perform _audit('sheet.purge', 'sheet', old.id::text, jsonb_build_object(
      'name', old.name, 'source_path', old.source_path, 'created_by', old.created_by, 'deleted_by', old.deleted_by));
  elsif old.deleted_at is null and new.deleted_at is not null then
    perform _audit('sheet.trash', 'sheet', new.id::text, jsonb_build_object('name', new.name));
  elsif old.deleted_at is not null and new.deleted_at is null then
    perform _audit('sheet.restore', 'sheet', new.id::text, jsonb_build_object('name', new.name));
  elsif new.version <> old.version then
    perform _audit(case when new.edits = old.edits and new.name = old.name then 'sheet.detect' else 'sheet.save' end,
                   'sheet', new.id::text, jsonb_build_object(
                     'version', new.version, 'edits', jsonb_array_length(new.edits),
                     'renamed', new.name is distinct from old.name));
  end if;
  return coalesce(new, old);
end $$;
create trigger sheet_audit after insert or update or delete on public.spec_sheets
  for each row execute function public.trg_sheet_audit();

-- BR-10: version check and save in one statement; runs as the caller, so RLS still applies
create function public.save_sheet(p_id uuid, p_version int, p_name text, p_detections jsonb, p_edits jsonb)
returns table (saved boolean, new_version int, is_deleted boolean, by_name text, saved_at timestamptz)
language plpgsql security invoker set search_path = public as $$
begin
  return query
    with u as (
      update spec_sheets s
         set name       = coalesce(p_name, s.name),
             detections = coalesce(p_detections, s.detections),
             edits      = coalesce(p_edits, s.edits),
             version    = s.version + 1,
             updated_by = auth.uid(),
             updated_at = now()
       where s.id = p_id and s.version = p_version and s.deleted_at is null
      returning s.version, s.updated_at
    )
    select true, u.version, false, null::text, u.updated_at from u;
  if not found then
    return query
      select false, s.version, s.deleted_at is not null, p.full_name, s.updated_at
        from spec_sheets s left join profiles p on p.id = s.updated_by
       where s.id = p_id;
  end if;
end $$;

create function public.purge_sheet(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  delete from spec_sheets where id = p_id and deleted_at is not null;   -- the trigger logs sheet.purge
  if not found then raise exception 'not_in_trash'; end if;
end $$;

create function public.log_maintenance(p_folders int, p_bytes bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  perform _audit('maintenance.orphan_cleanup', 'storage', 'spec-sheets',
                 jsonb_build_object('folders', p_folders, 'bytes', p_bytes));
end $$;

-- ===== RLS =====
alter table public.profiles        enable row level security;
alter table public.allowed_domains enable row level security;
alter table public.allowed_emails  enable row level security;
alter table public.app_settings    enable row level security;
alter table public.spec_sheets     enable row level security;
alter table public.audit_log       enable row level security;

create policy profiles_read on public.profiles        for select to authenticated using (public.is_allowed_user());
create policy domains_read  on public.allowed_domains for select to authenticated using (public.is_admin());
create policy emails_read   on public.allowed_emails  for select to authenticated using (public.is_admin());
create policy settings_read on public.app_settings    for select to authenticated using (public.is_allowed_user());
create policy audit_read    on public.audit_log       for select to authenticated using (public.is_admin());
-- profiles, allowed_*, app_settings, audit_log: no write policies; changed only through the functions above

create policy sheets_read   on public.spec_sheets for select to authenticated using (public.is_allowed_user());
create policy sheets_insert on public.spec_sheets for insert to authenticated
  with check (public.is_allowed_user() and created_by = auth.uid() and updated_by = auth.uid());
create policy sheets_update on public.spec_sheets for update to authenticated
  using (public.is_allowed_user()) with check (public.is_allowed_user() and updated_by = auth.uid());
-- no delete policy: permanent deletion only through purge_sheet()

-- ===== Storage =====
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('spec-sheets', 'spec-sheets', false, 52428800, array['application/pdf', 'image/png', 'image/jpeg']);

-- bucket spec-sheets only; read and add, never update or delete (BR-03)
create policy spec_files_read on storage.objects for select to authenticated
  using (bucket_id = 'spec-sheets' and public.is_allowed_user());
create policy spec_files_add  on storage.objects for insert to authenticated
  with check (bucket_id = 'spec-sheets' and public.is_allowed_user()
              and (storage.foldername(name))[1] ~ '^[0-9a-f-]{36}$');

-- First Admin: run once, after that person's first sign-in
--   update public.profiles set role = 'admin' where email = '<admin-email>';
```

- [ ] **Step 2: Write `scripts/migrate.mts`**

```ts
/**
 * Applies supabase/migrations/NNNN_*.sql that are not yet recorded in public.schema_migrations.
 * Each file runs in its own transaction together with its bookkeeping row: all or nothing.
 * Uses the session pooler from DATABASE_URL (.env.local); one connection only.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { config } from "dotenv";
import postgres from "postgres";

config({ path: ".env.local", quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Add it to .env.local (Supabase → Connect → Session pooler).");
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });
const dir = path.join(process.cwd(), "supabase", "migrations");

try {
  await sql`create table if not exists public.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  )`;
  await sql`alter table public.schema_migrations enable row level security`;

  const files = (await readdir(dir)).filter((f) => /^\d{4}_[a-z0-9_]+\.sql$/.test(f)).sort();
  const done = new Set(
    (await sql<{ version: string }[]>`select version from public.schema_migrations`).map((r) => r.version),
  );

  let applied = 0;
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    if (done.has(version)) continue;
    const body = await readFile(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(body);
      await tx`insert into public.schema_migrations (version) values (${version})`;
    });
    console.log(`applied ${version}`);
    applied += 1;
  }
  console.log(applied ? `${applied} migration(s) applied` : "database is up to date");
} finally {
  await sql.end();
}
```

- [ ] **Step 3: Apply the migration (needs `.env.local` from the roadmap prerequisites)**

Run: `npm run db:migrate`
Expected: `applied 0001_init` then `1 migration(s) applied`.

Run again: `npm run db:migrate`
Expected: `database is up to date`.

If `.env.local` is not ready yet: skip Steps 3 and continue; Task 5 tests will be skipped until it is, and this step is re-run before Task 5 Step 4.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0001_init.sql scripts/migrate.mts
git commit -m "feat(db): schema 0001 with RLS, audit triggers, admin functions and storage bucket; migration runner"
```

---

### Task 5: SQL test harness and database tests

**Files:**
- Create: `tests/sql/harness.ts`, `tests/sql/access.test.ts`, `tests/sql/admin.test.ts`, `tests/sql/audit.test.ts`, `tests/sql/sheets.test.ts`

**Interfaces:**
- Consumes: database objects from Task 4.
- Produces: `hasDb: boolean`; `type Tx`; `type TestUser = { id: string; email: string }`; `rollback(fn: (tx: Tx) => Promise<void>): Promise<void>`; `makeUser(tx, email: string, role?: "user" | "admin"): Promise<TestUser>`; `actAs(tx, user: { id: string; email: string }): Promise<void>`; `actAsOwner(tx): Promise<void>`; `expectError(tx, fn: (sp: Tx) => Promise<unknown>, message: string): Promise<void>`; `insertSheet(tx, owner: TestUser): Promise<string>`; `closeDb(): Promise<void>`.

- [ ] **Step 1: Write the harness**

`tests/sql/harness.ts`:
```ts
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { expect } from "vitest";

/** SQL tests run only when DATABASE_URL is configured (.env.local or a CI secret). */
export const hasDb = Boolean(process.env.DATABASE_URL);

const sql = hasDb ? postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, onnotice: () => {} }) : null;

export type Tx = postgres.TransactionSql;
export type TestUser = { id: string; email: string };

const ROLLBACK = new Error("rollback");

/** Runs fn in a transaction that is always rolled back: tests never leave data behind. */
export async function rollback(fn: (tx: Tx) => Promise<void>): Promise<void> {
  try {
    await sql!.begin(async (tx) => {
      await fn(tx);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
}

/** Creates an auth user and its profile as the table owner (bypassing RLS). */
export async function makeUser(tx: Tx, email: string, role: "user" | "admin" = "user"): Promise<TestUser> {
  const id = randomUUID();
  await tx`insert into auth.users (id, email, aud, role) values (${id}, ${email}, 'authenticated', 'authenticated')`;
  await tx`insert into public.profiles (id, email, full_name, role) values (${id}, ${email}, ${email.split("@")[0]}, ${role})`;
  return { id, email };
}

/** Switches the transaction to the `authenticated` role with this user's JWT claims. */
export async function actAs(tx: Tx, user: { id: string; email: string }): Promise<void> {
  await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user.id, email: user.email, role: "authenticated" })}, true)`;
  await tx`set local role authenticated`;
}

/** Back to the connection's own role (table owner), e.g. to arrange data. */
export async function actAsOwner(tx: Tx): Promise<void> {
  await tx`reset role`;
}

/** Runs fn inside a savepoint and asserts it fails with a message containing `message`. */
export async function expectError(tx: Tx, fn: (sp: Tx) => Promise<unknown>, message: string): Promise<void> {
  let error: unknown = null;
  try {
    await tx.savepoint(async (sp) => {
      await fn(sp);
    });
  } catch (e) {
    error = e;
  }
  expect(error, `expected an error containing "${message}"`).not.toBeNull();
  expect(String((error as Error).message)).toContain(message);
}

/** Inserts a sheet with the current role (use after actAs to exercise RLS). */
export async function insertSheet(tx: Tx, owner: TestUser): Promise<string> {
  const id = randomUUID();
  await tx`insert into public.spec_sheets (id, name, source_type, source_path, thumb_path, page_px_w, page_px_h, created_by, updated_by)
           values (${id}, 'Test sheet', 'png', ${`${id}/source.png`}, ${`${id}/thumb.jpg`}, 1135, 877, ${owner.id}, ${owner.id})`;
  return id;
}

/** A fresh address on the default permitted domain. */
export function staffEmail(): string {
  return `t-${randomUUID().slice(0, 8)}@ctyhp.vn`;
}

export async function closeDb(): Promise<void> {
  await sql?.end();
}
```

- [ ] **Step 2: Write the tests**

`tests/sql/access.test.ts` (TC-03, TC-04, TC-05, TC-57, TC-49, TC-50):
```ts
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail, type Tx } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("access rules (BR-08)", () => {
  async function allowed(tx: Tx, email: string) {
    await actAs(tx, { id: randomUUID(), email });
    const [row] = await tx<{ ok: boolean }[]>`select public.is_allowed_user() as ok`;
    await actAsOwner(tx);
    return row.ok;
  }

  it("TC-03 rejects look-alike domains", async () => {
    await rollback(async (tx) => {
      expect(await allowed(tx, "a@xctyhp.vn")).toBe(false);
      expect(await allowed(tx, "a@ctyhp.vn.evil.com")).toBe(false);
      expect(await allowed(tx, "a@b@ctyhp.vn")).toBe(false);
      expect(await allowed(tx, "a@ctyhp.vn")).toBe(true);
    });
  });

  it("TC-04 ignores letter case", async () => {
    await rollback(async (tx) => {
      expect(await allowed(tx, "A@CTYHP.VN")).toBe(true);
    });
  });

  it("TC-05 hides sheets from, and refuses inserts by, a non-permitted account", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      const outsider = await makeUser(tx, `x-${randomUUID().slice(0, 8)}@gmail.com`);
      await actAs(tx, staff);
      await insertSheet(tx, staff);
      await actAs(tx, outsider);
      const rows = await tx`select id from public.spec_sheets`;
      expect(rows.length).toBe(0);
      await expectError(tx, (sp) => insertSheet(sp, outsider), "row-level security");
    });
  });

  it("TC-57 Staff cannot promote themselves", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      const updated = await tx`update public.profiles set role = 'admin' where id = ${staff.id} returning id`;
      expect(updated.length).toBe(0);
      await actAsOwner(tx);
      const [p] = await tx<{ role: string }[]>`select role from public.profiles where id = ${staff.id}`;
      expect(p.role).toBe("user");
    });
  });

  it("my_access_status tells suspended from not permitted", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await tx`update public.profiles set status = 'suspended' where id = ${staff.id}`;
      await actAs(tx, staff);
      const [a] = await tx<{ s: string }[]>`select public.my_access_status() as s`;
      expect(a.s).toBe("suspended");
      await actAs(tx, { id: randomUUID(), email: "y@gmail.com" });
      const [b] = await tx<{ s: string }[]>`select public.my_access_status() as s`;
      expect(b.s).toBe("not_permitted");
    });
  });

  it("TC-49 / TC-50 storage: only read and insert policies, both gated by is_allowed_user()", async () => {
    await rollback(async (tx) => {
      const policies = await tx<{ cmd: string; qual: string | null; with_check: string | null }[]>`
        select cmd, qual, with_check from pg_policies
         where schemaname = 'storage' and tablename = 'objects'
           and coalesce(qual, '') || coalesce(with_check, '') like '%spec-sheets%'`;
      expect(policies.map((p) => p.cmd).sort()).toEqual(["INSERT", "SELECT"]);
      for (const p of policies) expect(`${p.qual ?? ""}${p.with_check ?? ""}`).toContain("is_allowed_user");
    });
  });
});
```

`tests/sql/admin.test.ts` (TC-56, TC-59, TC-61, TC-65, TC-73):
```ts
import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("admin functions", () => {
  it("TC-56 Staff cannot call admin functions", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await expectError(tx, (sp) => sp`select public.set_user_role(${staff.id}, 'admin')`, "forbidden");
      await expectError(tx, (sp) => sp`select public.set_setting('max_file_mb', 30)`, "forbidden");
      await expectError(tx, (sp) => sp`select public.purge_sheet(gen_random_uuid())`, "forbidden");
    });
  });

  it("TC-59 the last active Admin cannot be demoted", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      // Make the test independent of real Admins in this database (rolled back afterwards).
      await tx`update public.profiles set role = 'user' where role = 'admin' and id <> ${admin.id}`;
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_user_role(${admin.id}, 'user')`, "last_admin");
    });
  });

  it("an Admin can promote Staff, and the change is audited", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, admin);
      await tx`select public.set_user_role(${staff.id}, 'admin')`;
      await actAsOwner(tx);
      const [p] = await tx<{ role: string }[]>`select role from public.profiles where id = ${staff.id}`;
      expect(p.role).toBe("admin");
      const log = await tx`select 1 from public.audit_log where action = 'user.role_change' and target_id = ${staff.id}`;
      expect(log.length).toBe(1);
    });
  });

  it("TC-61 an Admin cannot suspend themselves", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.set_user_status(${admin.id}, 'suspended')`, "self_suspend");
    });
  });

  it("TC-65 removing the Admin's own domain is refused and nothing changes", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      await expectError(tx, (sp) => sp`select public.remove_allowed('domain', 'ctyhp.vn')`, "self_lockout");
      await actAsOwner(tx);
      const rows = await tx`select 1 from public.allowed_domains where domain = 'ctyhp.vn'`;
      expect(rows.length).toBe(1);
    });
  });

  it("TC-73 a sheet must be in the Trash before it can be purged", async () => {
    await rollback(async (tx) => {
      const admin = await makeUser(tx, staffEmail(), "admin");
      await actAs(tx, admin);
      const id = await insertSheet(tx, admin);
      await expectError(tx, (sp) => sp`select public.purge_sheet(${id})`, "not_in_trash");
    });
  });
});
```

`tests/sql/audit.test.ts` (TC-69, TC-70, TC-71):
```ts
import { afterAll, describe, expect, it } from "vitest";
import { actAs, closeDb, expectError, hasDb, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

describe.skipIf(!hasDb)("audit log (BR-15)", () => {
  it("TC-69 cannot be updated, deleted or truncated, even by the owner", async () => {
    await rollback(async (tx) => {
      await expectError(tx, (sp) => sp`update public.audit_log set action = 'x'`, "append-only");
      await expectError(tx, (sp) => sp`delete from public.audit_log`, "append-only");
      await expectError(tx, (sp) => sp`truncate public.audit_log`, "append-only");
    });
  });

  it("TC-70 clients cannot forge actions", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await expectError(
        tx,
        (sp) => sp`select public.log_client_event('user.role_change', gen_random_uuid(), '{}')`,
        "action_not_allowed",
      );
    });
  });

  it("TC-71 Staff read no audit rows", async () => {
    await rollback(async (tx) => {
      const staff = await makeUser(tx, staffEmail());
      await actAs(tx, staff);
      await tx`select public.touch_profile()`; // writes an auth.login row for this user
      const rows = await tx`select id from public.audit_log`;
      expect(rows.length).toBe(0);
    });
  });
});
```

`tests/sql/sheets.test.ts` (BR-10 and audit triggers):
```ts
import { afterAll, describe, expect, it } from "vitest";
import { actAs, actAsOwner, closeDb, expectError, hasDb, insertSheet, makeUser, rollback, staffEmail } from "./harness";

afterAll(closeDb);

type SaveRow = { saved: boolean; new_version: number; is_deleted: boolean; by_name: string | null };

describe.skipIf(!hasDb)("sheets", () => {
  it("save_sheet saves on a matching version and reports a conflict otherwise (BR-10)", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      const [first] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[{"x":1}]'::jsonb)`;
      expect(first).toMatchObject({ saved: true, new_version: 2 });
      const [stale] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[]'::jsonb)`;
      expect(stale).toMatchObject({ saved: false, new_version: 2, is_deleted: false });
      expect(stale.by_name).toBe(a.email.split("@")[0]);
    });
  });

  it("save_sheet reports a sheet moved to the Trash", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`update public.spec_sheets set deleted_at = now(), deleted_by = ${a.id}, updated_by = ${a.id} where id = ${id}`;
      const [row] = await tx<SaveRow[]>`select * from public.save_sheet(${id}, 1, null, null, '[]'::jsonb)`;
      expect(row).toMatchObject({ saved: false, is_deleted: true });
    });
  });

  it("immutable columns cannot change", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await expectError(
        tx,
        (sp) => sp`update public.spec_sheets set source_path = 'other/source.png', updated_by = ${a.id} where id = ${id}`,
        "immutable_column",
      );
    });
  });

  it("upload, save, trash and restore each write exactly one audit row with the actor", async () => {
    await rollback(async (tx) => {
      const a = await makeUser(tx, staffEmail());
      await actAs(tx, a);
      const id = await insertSheet(tx, a);
      await tx`select * from public.save_sheet(${id}, 1, null, null, '[{"x":1}]'::jsonb)`;
      await tx`update public.spec_sheets set deleted_at = now(), deleted_by = ${a.id}, updated_by = ${a.id} where id = ${id}`;
      await tx`update public.spec_sheets set deleted_at = null, deleted_by = null, updated_by = ${a.id} where id = ${id}`;
      await actAsOwner(tx);
      const rows = await tx<{ action: string; actor_id: string }[]>`
        select action, actor_id from public.audit_log where target_id = ${id} order by id`;
      expect(rows.map((r) => r.action)).toEqual(["sheet.upload", "sheet.save", "sheet.trash", "sheet.restore"]);
      for (const r of rows) expect(r.actor_id).toBe(a.id);
    });
  });
});
```

- [ ] **Step 3: Run without a database to confirm the skip path**

Run (PowerShell): `$env:DATABASE_URL=''; npx vitest run tests/sql`
Expected: all SQL suites reported as skipped, exit code 0. (If `.env.local` defines `DATABASE_URL`, temporarily rename it for this check.)

- [ ] **Step 4: Run against the dev database**

Run: `npm run db:migrate && npx vitest run tests/sql`
Expected: `database is up to date`, then PASS — 4 files, 19 tests. Paste the full Vitest summary into the task report; do not trim it.

- [ ] **Step 5: Commit**

```bash
git add tests/sql
git commit -m "test(db): rolled-back SQL tests for access, admin guards, audit log and save conflicts"
```

---

### Task 6: Post-login redirect and access decision (pure)

**Files:**
- Create: `src/auth/redirect.ts`, `src/auth/access.ts`
- Test: `tests/unit/redirect.test.ts`, `tests/unit/access.test.ts`

**Interfaces:**
- Produces: `safeNext(raw: string | null | undefined, fallback?: string): string`; types `Role = "user" | "admin"`, `Status = "active" | "suspended"`, `AccessStatus = "ok" | "signed_out" | "not_permitted" | "suspended"`, `Profile = { id: string; email: string; fullName: string | null; avatarUrl: string | null; role: Role; status: Status }`, `Need = "user" | "admin"`, `Decision = { kind: "allow"; profile: Profile } | { kind: "login"; error?: "not_permitted" | "suspended" } | { kind: "not_found" }`; `decideAccess(profile: Profile | null, status: AccessStatus, need: Need): Decision`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/redirect.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { safeNext } from "@/auth/redirect";

describe("safeNext", () => {
  it("keeps same-site paths", () => {
    expect(safeNext("/sheets/abc?x=1")).toBe("/sheets/abc?x=1");
    expect(safeNext("/admin")).toBe("/admin");
  });

  it("falls back for anything that could leave the site or loop", () => {
    for (const raw of [null, undefined, "", "https://evil.example", "//evil.example", "/\\evil.example", "sheets", "/login", "/login?next=/x", "/auth/callback"]) {
      expect(safeNext(raw)).toBe("/sheets");
    }
  });

  it("uses the given fallback", () => {
    expect(safeNext(null, "/admin")).toBe("/admin");
  });
});
```

`tests/unit/access.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { decideAccess, type Profile } from "@/auth/access";

const staff: Profile = { id: "u1", email: "a@ctyhp.vn", fullName: "A", avatarUrl: null, role: "user", status: "active" };
const admin: Profile = { ...staff, id: "u2", role: "admin" };

describe("decideAccess", () => {
  it("sends signed-out visitors to sign in without an error", () => {
    expect(decideAccess(null, "signed_out", "user")).toEqual({ kind: "login" });
  });

  it("explains suspended and not-permitted accounts", () => {
    expect(decideAccess(null, "suspended", "user")).toEqual({ kind: "login", error: "suspended" });
    expect(decideAccess(null, "not_permitted", "user")).toEqual({ kind: "login", error: "not_permitted" });
  });

  it("sends a session without a profile back through sign-in", () => {
    expect(decideAccess(null, "ok", "user")).toEqual({ kind: "login" });
  });

  it("allows Staff into Staff pages and hides Admin pages from them", () => {
    expect(decideAccess(staff, "ok", "user")).toEqual({ kind: "allow", profile: staff });
    expect(decideAccess(staff, "ok", "admin")).toEqual({ kind: "not_found" });
  });

  it("allows Admins everywhere", () => {
    expect(decideAccess(admin, "ok", "admin")).toEqual({ kind: "allow", profile: admin });
  });

  it("treats a suspended profile as suspended even if the status call said ok", () => {
    expect(decideAccess({ ...admin, status: "suspended" }, "ok", "admin")).toEqual({ kind: "login", error: "suspended" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/unit/redirect.test.ts tests/unit/access.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write the implementation**

`src/auth/redirect.ts`:
```ts
/**
 * The path to land on after sign-in. Only same-site absolute paths are accepted, so a crafted
 * ?next= cannot send people to another site or back into the sign-in loop.
 */
export function safeNext(raw: string | null | undefined, fallback = "/sheets"): string {
  if (!raw || !raw.startsWith("/")) return fallback;
  if (raw.startsWith("//") || raw.startsWith("/\\")) return fallback;
  if (raw === "/login" || raw.startsWith("/login?") || raw.startsWith("/auth/")) return fallback;
  return raw;
}
```

`src/auth/access.ts`:
```ts
export type Role = "user" | "admin";
export type Status = "active" | "suspended";
export type AccessStatus = "ok" | "signed_out" | "not_permitted" | "suspended";

export type Profile = {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  role: Role;
  status: Status;
};

export type Need = "user" | "admin";

export type Decision =
  | { kind: "allow"; profile: Profile }
  | { kind: "login"; error?: "not_permitted" | "suspended" }
  | { kind: "not_found" };

/**
 * The whole access rule for pages, as a pure function. The database is the real gate (RLS); this only
 * decides what the visitor sees: the page, the sign-in screen with a reason, or a 404 for Admin pages.
 */
export function decideAccess(profile: Profile | null, status: AccessStatus, need: Need): Decision {
  if (status === "signed_out") return { kind: "login" };
  if (status === "suspended") return { kind: "login", error: "suspended" };
  if (status === "not_permitted") return { kind: "login", error: "not_permitted" };
  if (profile === null) return { kind: "login" };
  if (profile.status !== "active") return { kind: "login", error: "suspended" };
  if (need === "admin" && profile.role !== "admin") return { kind: "not_found" };
  return { kind: "allow", profile };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/unit/redirect.test.ts tests/unit/access.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/auth/redirect.ts src/auth/access.ts tests/unit/redirect.test.ts tests/unit/access.test.ts
git commit -m "feat(auth): open-redirect-safe next path and pure access decision"
```

---

### Task 7: Supabase clients, session refresh, sign-in flow and guarded shell

**Files:**
- Create: `src/lib/supabase/server.ts`, `src/lib/supabase/admin.ts`, `src/proxy.ts`, `src/auth/session.ts`, `src/auth/actions.ts`, `src/app/auth/callback/route.ts`, `src/app/login/page.tsx`, `src/app/(app)/layout.tsx`, `src/app/(app)/sheets/page.tsx`, `src/app/(app)/admin/layout.tsx`, `src/app/(app)/admin/page.tsx`, `src/ui/app-header.tsx`, `src/ui/language-switch.tsx`
- Modify: `src/app/layout.tsx` (replace the Task 1 version)

**Interfaces:**
- Consumes: `getEnv()` (Task 2); `getLocale()`, `getMessages()`, `LocaleProvider`, `useMessages()`, `useLocale()`, `setLocale()`, `LOCALES`, `LOCALE_SHORT`, `LOCALE_LABEL` (Task 3); `safeNext()`, `decideAccess()`, `Profile`, `AccessStatus`, `Need` (Task 6); RPCs `my_access_status`, `touch_profile`, table `profiles`, `audit_log` (Task 4).
- Produces: `createSupabaseServer(): Promise<SupabaseClient>`; `createSupabaseAdmin(): SupabaseClient` (server-only); `loadAccess(): Promise<{ profile: Profile | null; status: AccessStatus }>` (cached per request); `requireUser(next?: string): Promise<Profile>`; `requireAdmin(next?: string): Promise<Profile>`; server actions `signInWithGoogle(form)` (field `next`), `signOut()`; request header `x-pathname` on every request; `<AppHeader me t locale />`; `<LanguageSwitch />` (client).

- [ ] **Step 1: Supabase clients and proxy**

`src/lib/supabase/server.ts`:
```ts
import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/env";

/** Supabase client bound to the visitor's session cookies. */
export async function createSupabaseServer() {
  const store = await cookies();
  const env = getEnv();
  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          list.forEach(({ name, value, options }) => store.set(name, value, options));
        } catch {
          // Called from a Server Component, which cannot set cookies; src/proxy.ts refreshes the session.
        }
      },
    },
  });
}
```

`src/lib/supabase/admin.ts`:
```ts
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/env";

/**
 * Secret-key client: bypasses RLS. Allowed uses only (NFR-10): logging rejected sign-ins, deleting files on
 * permanent deletion, listing and deleting orphan files. Never import from a client component.
 */
export function createSupabaseAdmin() {
  const env = getEnv();
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
```

`src/proxy.ts`:
```ts
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Runs on every page request (Next.js 16 "proxy", formerly middleware):
 * 1. passes the requested path to server components as `x-pathname`, so a guard can send people
 *    back to the same page after sign-in;
 * 2. refreshes the Supabase session (access tokens live one hour; Server Components cannot write cookies).
 * It does not guard anything — guarding lives in requireUser()/requireAdmin() and in RLS.
 */
function forwardHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.set("x-pathname", request.nextUrl.pathname + request.nextUrl.search);
  return headers;
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: forwardHeaders(request) } });

  // No Supabase cookie means no session to refresh: skip the network call to Supabase Auth.
  if (!request.cookies.getAll().some((c) => c.name.startsWith("sb-"))) return response;

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request: { headers: forwardHeaders(request) } });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() refreshes the token; getSession() only reads the cookie and would not.
  await supabase.auth.getUser();
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|models/|fonts/|.*\\.(?:png|jpg|jpeg|svg|ico|onnx|woff2)$).*)"],
};
```

- [ ] **Step 2: Session helpers and actions**

`src/auth/session.ts`:
```ts
import "server-only";
import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { decideAccess, type AccessStatus, type Need, type Profile } from "./access";

type ProfileRow = {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  role: Profile["role"];
  status: Profile["status"];
};

/** One read per request (layout and page both call the guards). */
export const loadAccess = cache(async (): Promise<{ profile: Profile | null; status: AccessStatus }> => {
  const supabase = await createSupabaseServer();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { profile: null, status: "signed_out" };

  const { data: status, error } = await supabase.rpc("my_access_status");
  if (error) throw error;
  if (status !== "ok") return { profile: null, status: status as AccessStatus };

  const { data: row, error: readError } = await supabase
    .from("profiles")
    .select("id, email, full_name, avatar_url, role, status")
    .eq("id", auth.user.id)
    .maybeSingle<ProfileRow>();
  if (readError) throw readError;

  const profile: Profile | null = row
    ? { id: row.id, email: row.email, fullName: row.full_name, avatarUrl: row.avatar_url, role: row.role, status: row.status }
    : null;
  return { profile, status: "ok" };
});

async function ensure(need: Need, next: string): Promise<Profile> {
  const { profile, status } = await loadAccess();
  const decision = decideAccess(profile, status, need);
  if (decision.kind === "allow") return decision.profile;
  if (decision.kind === "not_found") notFound();
  const query = new URLSearchParams({ next });
  if (decision.error) query.set("error", decision.error);
  redirect(`/login?${query.toString()}`);
}

export function requireUser(next = "/sheets"): Promise<Profile> {
  return ensure("user", next);
}

export function requireAdmin(next = "/admin"): Promise<Profile> {
  return ensure("admin", next);
}
```

`src/auth/actions.ts`:
```ts
"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
import { safeNext } from "./redirect";

/** Starts Google OAuth (PKCE). The code verifier cookie is written here, read by /auth/callback. */
export async function signInWithGoogle(form: FormData): Promise<void> {
  const next = safeNext(String(form.get("next") ?? ""));
  const h = await headers();
  const origin = h.get("origin") ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data.url) redirect("/login?error=google");
  redirect(data.url);
}

export async function signOut(): Promise<void> {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/login");
}
```

`src/app/auth/callback/route.ts`:
```ts
import { NextResponse, type NextRequest } from "next/server";
import { safeNext } from "@/auth/redirect";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";

/**
 * Google sends people here. In order: exchange the code for a session; ask the database whether this
 * account may enter (BR-08, BR-14); if not, log auth.denied, end the session and explain; otherwise
 * create/update the profile (touch_profile logs auth.login) and continue to the requested page.
 */
export async function GET(request: NextRequest) {
  const url = request.nextUrl;
  const go = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));
  if (!code) return go("/login?error=google");

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) return go("/login?error=google");

  const { data: status, error: statusError } = await supabase.rpc("my_access_status");
  if (statusError) {
    await supabase.auth.signOut();
    return go("/login?error=google");
  }

  if (status !== "ok") {
    await createSupabaseAdmin()
      .from("audit_log")
      .insert({
        actor_email: data.user.email ?? null,
        action: "auth.denied",
        target_type: "user",
        target_id: data.user.id,
        detail: { reason: status },
      });
    await supabase.auth.signOut();
    return go(`/login?error=${status === "suspended" ? "suspended" : "not_permitted"}`);
  }

  const { error: touchError } = await supabase.rpc("touch_profile");
  if (touchError) {
    await supabase.auth.signOut();
    return go("/login?error=google");
  }
  return go(next);
}
```

- [ ] **Step 3: Root layout, language switch and header**

`src/app/layout.tsx` (replace):
```tsx
import type { Metadata } from "next";
import { Be_Vietnam_Pro, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { LocaleProvider } from "@/messages/client";
import { getLocale, getMessages } from "@/messages/server";

const sans = Be_Vietnam_Pro({
  subsets: ["latin", "vietnamese"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-be-vietnam",
});
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono" });

export async function generateMetadata(): Promise<Metadata> {
  const t = await getMessages();
  return { title: t.app.name, description: t.app.tagline };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh bg-paper font-sans text-ink antialiased">
        <LocaleProvider locale={locale}>{children}</LocaleProvider>
      </body>
    </html>
  );
}
```

`src/ui/language-switch.tsx`:
```tsx
"use client";

import { setLocale } from "@/messages/actions";
import { useLocale, useMessages } from "@/messages/client";
import { LOCALE_LABEL, LOCALE_SHORT, LOCALES } from "@/messages/locale";

/** VI / EN. Each option is a real form posting to a server action, so it works without JavaScript too. */
export function LanguageSwitch() {
  const current = useLocale();
  const t = useMessages();
  return (
    <div role="group" aria-label={t.common.language} className="flex items-center gap-1 text-xs">
      {LOCALES.map((locale) => (
        <form key={locale} action={setLocale}>
          <input type="hidden" name="locale" value={locale} />
          <button
            type="submit"
            title={LOCALE_LABEL[locale]}
            aria-current={locale === current ? "true" : undefined}
            className={
              "rounded px-2 py-1 font-semibold tracking-wider " +
              (locale === current ? "bg-accent-soft text-accent" : "text-ink-3 hover:text-ink")
            }
          >
            {LOCALE_SHORT[locale]}
          </button>
        </form>
      ))}
    </div>
  );
}
```

`src/ui/app-header.tsx`:
```tsx
import Link from "next/link";
import type { Profile } from "@/auth/access";
import { signOut } from "@/auth/actions";
import type { Messages } from "@/messages";
import { LanguageSwitch } from "./language-switch";

export function AppHeader({ me, t }: { me: Profile; t: Messages }) {
  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
        <Link href="/sheets" className="font-bold tracking-tight">
          {t.app.name}
        </Link>
        <nav className="flex items-center gap-3 text-sm text-ink-2">
          <Link href="/sheets" className="hover:text-ink">{t.common.sheets}</Link>
          {me.role === "admin" && (
            <Link href="/admin" className="hover:text-ink">{t.common.admin}</Link>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <LanguageSwitch />
          <span className="hidden text-sm text-ink-2 sm:inline" title={me.email}>
            {me.fullName ?? me.email}
          </span>
          <form action={signOut}>
            <button type="submit" className="rounded border border-line px-3 py-1 text-sm hover:bg-sunk">
              {t.common.signOut}
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
```

- [ ] **Step 4: Sign-in page and guarded pages**

`src/app/login/page.tsx`:
```tsx
import { signInWithGoogle } from "@/auth/actions";
import { safeNext } from "@/auth/redirect";
import type { Messages } from "@/messages";
import { getMessages } from "@/messages/server";
import { LanguageSwitch } from "@/ui/language-switch";

function errorText(code: string | undefined, t: Messages): string | null {
  if (code === "not_permitted") return t.login.errors.notPermitted;
  if (code === "suspended") return t.login.errors.suspended;
  if (code === "google") return t.login.errors.google;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const t = await getMessages();
  const error = errorText(params.error, t);
  return (
    <main className="grid min-h-dvh place-items-center px-4">
      <div className="w-full max-w-sm space-y-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold">{t.app.name}</h1>
            <p className="mt-1 text-sm text-ink-2">{t.login.lead}</p>
          </div>
          <LanguageSwitch />
        </div>
        {error && (
          <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm">
            {error}
          </p>
        )}
        <form action={signInWithGoogle}>
          <input type="hidden" name="next" value={safeNext(params.next)} />
          <button
            type="submit"
            className="w-full rounded-md bg-accent px-4 py-2.5 font-semibold text-accent-ink hover:opacity-90"
          >
            {t.login.google}
          </button>
        </form>
      </div>
    </main>
  );
}
```

`src/app/(app)/layout.tsx`:
```tsx
import { headers } from "next/headers";
import { requireUser } from "@/auth/session";
import { getMessages } from "@/messages/server";
import { AppHeader } from "@/ui/app-header";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/sheets";
  const me = await requireUser(next);
  const t = await getMessages();
  return (
    <>
      <AppHeader me={me} t={t} />
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </>
  );
}
```

`src/app/(app)/sheets/page.tsx`:
```tsx
import { getMessages } from "@/messages/server";

export default async function SheetsPage() {
  const t = await getMessages();
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.sheets.title}</h1>
      <p className="rounded-lg border border-dashed border-line bg-surface px-4 py-10 text-center text-ink-2">
        {t.sheets.empty}
      </p>
    </section>
  );
}
```

`src/app/(app)/admin/layout.tsx`:
```tsx
import { headers } from "next/headers";
import { requireAdmin } from "@/auth/session";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const next = (await headers()).get("x-pathname") ?? "/admin";
  await requireAdmin(next);
  return <>{children}</>;
}
```

`src/app/(app)/admin/page.tsx`:
```tsx
import { getMessages } from "@/messages/server";

export default async function AdminPage() {
  const t = await getMessages();
  const areas = [t.admin.areas.users, t.admin.areas.access, t.admin.areas.audit, t.admin.areas.cleanup];
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{t.admin.title}</h1>
      <p className="text-ink-2">{t.admin.lead}</p>
      <ul className="grid gap-3 sm:grid-cols-2">
        {areas.map((name) => (
          <li key={name} className="rounded-lg border border-line bg-surface px-4 py-3 font-medium">
            {name}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 5: Verify build, lint, types and unit tests**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: lint and typecheck clean; Vitest PASS (unit tests; SQL tests pass or skip depending on `DATABASE_URL`); build lists `/`, `/login`, `/auth/callback`, `/sheets`, `/admin` and reports the proxy.

- [ ] **Step 6: Manual check (needs prerequisites 1–3)**

Start the server detached (the Bash tool kills foreground servers) — PowerShell:
`Start-Process -FilePath npm -ArgumentList "run","dev" -WindowStyle Hidden`

Check in a browser, in both VI and EN, and take a screenshot of each:
1. `http://localhost:3000/sheets` → redirects to `/login?next=%2Fsheets`.
2. Sign in with a `@ctyhp.vn` Google account → lands on `/sheets`, header shows the name and no Admin link; `/admin` returns 404.
3. Run the first-Admin statement in the Supabase SQL editor for that account, reload → Admin link appears; `/admin` shows the four areas.
4. Sign out → `/login`; Back does not show `/sheets` content.
5. Sign in with a gmail account → back on `/login` with the not-permitted message; `audit_log` has an `auth.denied` row.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase src/proxy.ts src/auth/session.ts src/auth/actions.ts src/app/auth src/app/login src/app/layout.tsx "src/app/(app)" src/ui
git commit -m "feat(auth): Google sign-in with domain and suspension checks, guarded Staff/Admin shell, VI/EN header"
```

---

### Task 8: CI and setup guide

**Files:**
- Create: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Consumes: npm scripts from Task 1; optional repository secret `DATABASE_URL` for SQL tests.

- [ ] **Step 1: Write the workflow**

`.github/workflows/ci.yml`:
```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run typecheck
      - name: Tests (SQL suites run only when the DATABASE_URL secret is set)
        run: npm test
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
      - run: npm run build
```

- [ ] **Step 2: Write `README.md`**

````markdown
# Spec Sheet Editor

Edit the dimension values on Product Specifications sheets and export a clean copy for customer
approval. Bilingual (Vietnamese / English).

- Design: [`docs/design/spec-sheet-editor-design.md`](docs/design/spec-sheet-editor-design.md)
  (HTML edition with wireframes: `docs/design/spec-sheet-editor-design.html`)
- Build roadmap and milestone plans: [`docs/plans/`](docs/plans/)
- OCR benchmark: [`research/ocr-bakeoff/`](research/ocr-bakeoff/)

## Stack

Next.js 16 · React 19 · Tailwind CSS 4 · Supabase (Postgres + RLS, Storage, Google Auth) · Vercel (`sin1`)

## Setup

1. Create a Supabase project in Singapore, enable the Google provider, and add
   `http://localhost:3000/auth/callback` to the redirect URLs.
2. `cp .env.example .env.local` and fill in the four values.
3. `npm install`
4. `npm run db:migrate` — applies `supabase/migrations/*.sql`.
5. `npm run dev`, sign in with a company Google account, then make yourself the first Admin in the
   Supabase SQL editor:
   ```sql
   update public.profiles set role = 'admin' where email = '<your-email>';
   ```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run lint` / `npm run typecheck` | ESLint / TypeScript |
| `npm test` | Unit tests; SQL tests too when `DATABASE_URL` is set (always rolled back) |
| `npm run build` | Production build |
| `npm run db:migrate` | Apply pending migrations |

## Data rules

This repository is public. Never commit real sheets, order numbers or keys: `samples/` and
`.env*.local` are ignored on purpose.
````

- [ ] **Step 3: Verify**

Run: `npm run lint && npm run typecheck && npm test && npm run build`
Expected: all green (same as Task 7 Step 5).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml README.md
git commit -m "ci: lint, typecheck, tests and build on every push; README setup guide"
```

---

## M1 exit checklist

- [ ] `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all green locally and in CI.
- [ ] SQL tests (19) green against the dev project — full Vitest summary pasted in the report.
- [ ] Manual check (Task 7 Step 6) done in VI and EN with screenshots.
- [ ] Diff scanned for `SO2`, `MO2`, `sb_secret_`, `service_role`, `.env.local` before push.
- [ ] Next: write `2026-10-xx-m2-browser-ocr.md`.
