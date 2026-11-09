# WatermelonDB

Local SQLite database (offline-first storage).
Sub-modules:
- `schema.ts` — tabel & kolom (increment + migration saat berubah).
- `migrations.ts` — daftar migrasi.
- `models/` — model classes ber-decorator (satu file per entity).
- `index.ts` — adapter + Database instance.

Dekorator `@field`/`@text`/`@date`/`@json` dari `@nozbe/watermelondb/decorators` butuh `@babel/plugin-proposal-decorators` dengan `legacy: true` di `babel.config.js`.
