/**
 * Tes token tema: nilai warna, kunci warna, dan gaya teks.
 *
 * Gaya teks dicek supaya huruf yang dipakai pasti salah satu dari daftar
 * fontFamily, dan tidak ada gaya yang mengandalkan fontWeight.
 */

/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { colors, fontFamily, type } from './tokens';

const POLA_HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

const FOLDER_FONT = path.join(__dirname, '..', '..', 'assets', 'fonts');

describe('token tema', () => {
  it('semua nilai colors berupa hex 6 atau 8 digit', () => {
    for (const nilai of Object.values(colors)) {
      expect(nilai).toMatch(POLA_HEX);
    }
  });

  it('jumlah kunci colors 32', () => {
    expect(Object.keys(colors)).toHaveLength(32);
  });

  it('teks tombol nonaktif sama dengan warna teks muted', () => {
    expect(colors.onActionDisabled).toBe(colors.textMuted);
  });

  it('setiap gaya teks memakai fontFamily yang ada di daftar', () => {
    const tersedia = Object.values(fontFamily);
    for (const gaya of Object.values(type)) {
      expect(tersedia).toContain(gaya.fontFamily);
    }
  });

  it('tidak ada gaya teks yang memakai fontWeight', () => {
    for (const gaya of Object.values(type)) {
      expect('fontWeight' in gaya).toBe(false);
    }
  });

  it('setiap fontFamily punya berkas ttf dengan nama sama', () => {
    const isi = fs.readdirSync(FOLDER_FONT);
    for (const nama of Object.values(fontFamily)) {
      expect(isi).toContain(`${nama}.ttf`);
    }
  });
});
