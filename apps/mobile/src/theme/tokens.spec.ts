/**
 * Tes token tema: nilai warna, kunci warna, dan gaya teks.
 *
 * Gaya teks dicek supaya huruf yang dipakai pasti salah satu dari daftar
 * fontFamily, dan tidak ada gaya yang mengandalkan fontWeight.
 */

/// <reference types="node" />
import fs from 'fs';
import path from 'path';

import { fontFamily, motion, palette, themes, type } from './tokens';

const POLA_HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

const FOLDER_FONT = path.join(__dirname, '..', '..', 'assets', 'fonts');

describe('token tema', () => {
  it('kedua tema punya nama warna yang sama persis', () => {
    expect(Object.keys(themes.gelap).sort()).toEqual(Object.keys(themes.terang).sort());
  });

  it('jumlah nama warna di tiap tema 60', () => {
    expect(Object.keys(themes.gelap)).toHaveLength(60);
    expect(Object.keys(themes.terang)).toHaveLength(60);
  });

  it('semua nilai warna tema berupa hex 6 atau 8 digit', () => {
    for (const nilai of Object.values(themes.gelap)) {
      expect(nilai).toMatch(POLA_HEX);
    }
    for (const nilai of Object.values(themes.terang)) {
      expect(nilai).toMatch(POLA_HEX);
    }
  });

  it('semua nilai palet berupa hex 6 atau 8 digit', () => {
    for (const nilai of Object.values(palette)) {
      expect(nilai).toMatch(POLA_HEX);
    }
  });

  it('jumlah warna palet 20', () => {
    expect(Object.keys(palette)).toHaveLength(20);
  });

  it('teks tombol nonaktif tema gelap sama dengan warna teks halus', () => {
    expect(themes.gelap.onActionDisabled).toBe(themes.gelap.textSubtle);
  });

  it('teks tombol nonaktif tema terang sama dengan warna teks muted', () => {
    expect(themes.terang.onActionDisabled).toBe(themes.terang.textMuted);
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

describe('token gerak', () => {
  it('durasi tiap gerakan', () => {
    expect(motion.duration).toEqual({
      press: 120,
      release: 180,
      enter: 380,
      exit: 260,
      shift: 300,
      fadeIn: 180,
      fadeOut: 120,
      tabIndicator: 420,
      drawLine: 320,
      rollNumber: 400,
      fieldShake: 300,
      holdDone: 700,
      highlight: 1400,
      motorStep: 900,
    });
  });

  it('jeda antarbaris dan batas jeda', () => {
    expect(motion.stagger).toEqual({ enter: 50, exit: 25, maxDelay: 350 });
  });

  it('titik kurva tiap gerakan', () => {
    expect(motion.curve.standard).toEqual([0.22, 1, 0.36, 1]);
    expect(motion.curve.exit).toEqual([0.64, 0, 0.78, 0]);
    expect(motion.curve.motor).toEqual([0.45, 0, 0.2, 1]);
  });

  it('skala ditekan, jarak goyang, dan panjang jendela awal', () => {
    expect(motion.pressScale).toBe(0.97);
    expect(motion.shakeDistance).toBe(6);
    expect(motion.initialWindow).toBe(500);
  });
});
