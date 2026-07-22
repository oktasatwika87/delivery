# Delivery Monorepo

Offline-first delivery application. 3 workspaces, pnpm-managed.

## Workspaces

```
delivery-monorepo/
├── apps/
│   ├── mobile/        # React Native (TS) + WatermelonDB
│   └── backend/       # NestJS (TS) + PostgreSQL via Prisma
└── packages/
    └── shared/        # Types & contracts (Order, Payment, ChatMessage, SyncPayload)
```

## Stack

| Workspace  | Framework       | DB / Storage        | Language |
| ---------- | --------------- | ------------------- | -------- |
| mobile     | React Native    | WatermelonDB (SQLite) | TypeScript |
| backend    | NestJS          | PostgreSQL / Prisma | TypeScript |
| shared     | — (types only)  | —                   | TypeScript |

`shared` adalah kontrak antara client & server — semua tipe domain dan envelope sync didefinisikan di sini dan di-impor via `@delivery/shared` dari kedua workspace lain.

## Setup

Prasyarat:

- Node 20+
- pnpm 9+ (`corepack enable`)
- Untuk `apps/mobile`: React Native CLI, Android SDK / Xcode
- Untuk `apps/backend`: Postgres berjalan di lokal (atau via Docker)

Install dependency per workspace (sesuai kebutuhan, jangan sekaligus):

```bash
# Backend
pnpm --filter @delivery/backend add <pkg>
pnpm --filter @delivery/backend add -D <pkg>

# Mobile
pnpm --filter @delivery/mobile add <pkg>
pnpm --filter @delivery/mobile add -D <pkg>

# Shared (biasanya type-only)
pnpm --filter @delivery/shared add -D <pkg>
```

## Scripts (root)

| Script                  | Fungsi                                               |
| ----------------------- | ---------------------------------------------------- |
| `pnpm lint`             | ESLint di semua workspace, paralel                   |
| `pnpm format`           | Prettier write ke semua file                         |
| `pnpm format:check`     | Prettier check (CI-friendly)                         |
| `pnpm typecheck`        | `tsc --noEmit` di semua workspace                    |
| `pnpm build:shared`     | Build `packages/shared` dulu (diperlukan backend & mobile) |

## TypeScript configuration

- `tsconfig.base.json` — opsi bersama (`strict: true`, `isolatedModules`, decorator support untuk NestJS & WatermelonDB).
- Tiap workspace extend base lewat `extends: ["../../tsconfig.base.json"]` (sesuaikan kedalaman relatifnya).
- Mobile override `lib` (tanpa DOM) dan target JS engine Hermes.

## Linting & formatting

ESLint 9 flat config + Prettier 3.

- Konfigurasi bersama: `eslint.config.mjs` & `.prettierrc.json` di root.
- Tiap workspace bisa extend rules tambahan di `eslint.config.mjs` lokalnya.

## Notes

- `@delivery/shared` adalah ESM-only package — pastikan backend & mobile bisa resolve-nya (lihat `package.json` field `exports`).
- WatermelonDB butuh `babel.config.js` dengan plugin decorator di mobile — sudah disiapkan.
- Prisma schema di `apps/backend/prisma/schema.prisma`. Generate client dengan `pnpm --filter @delivery/backend exec prisma generate`.