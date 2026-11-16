/**
 * Penyedia tema. Komponen memilih gayanya dari nama tema, jadi tidak ada
 * gaya yang dihitung saat render.
 */

import React, { createContext, useContext, useMemo } from 'react';

import { themes, type ThemeColors, type ThemeName } from './tokens';

/** Tema driver. Kalau uji terik gagal, cukup ganti nilai ini. */
export const TEMA_DRIVER: ThemeName = 'gelap';

export interface Tema {
  name: ThemeName;
  colors: ThemeColors;
}

const BAWAAN: Tema = { name: 'gelap', colors: themes.gelap };

const KonteksTema = createContext<Tema>(BAWAAN);

export interface ThemeProviderProps {
  name: ThemeName;
  children: React.ReactNode;
}

export function ThemeProvider({ name, children }: ThemeProviderProps): React.JSX.Element {
  const nilai = useMemo<Tema>(() => ({ name, colors: themes[name] }), [name]);
  return <KonteksTema.Provider value={nilai}>{children}</KonteksTema.Provider>;
}

/** Tema yang berlaku. Tanpa penyedia, hasilnya tema gelap. */
export function useTheme(): Tema {
  return useContext(KonteksTema);
}

/**
 * Membuat satu set gaya per tema, sekali saat modul dimuat. Komponen
 * mengambil setnya dengan `gaya[useTheme().name]`.
 */
export function perTema<T>(buat: (c: ThemeColors) => T): Record<ThemeName, T> {
  return { gelap: buat(themes.gelap), terang: buat(themes.terang) };
}
