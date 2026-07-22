# WatermelonDB

Local SQLite database (offline-first storage).
Sub-modules:
- `schema.ts` — tabel & kolom (increment + migration saat berubah).
- `migrations.ts` — daftar migrasi.
- `models/` — model classes ber-decorator (satu file per entity).
- `index.ts` — adapter + Database instance.

Decorator `@field`/`@text`/`@date` adalah dari `@nozbe/watermelondb/decorators` — butuh plugin `babel-plugin-transform-decorators-legacy` di `babel.config.js`.
