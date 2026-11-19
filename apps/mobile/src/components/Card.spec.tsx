/**
 * Tes komponen Card.
 *
 * Card cuma wadah dengan gaya kartu, jadi yang dicek isi dan gayanya.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { Card } from './Card';
import { ThemeProvider } from '../theme/ThemeProvider';
import { elevation, radius, themes } from '../theme/tokens';

describe('Card', () => {
  it('anak kartu tampil', () => {
    const { getByText } = render(
      <Card>
        <Text>Isi kartu</Text>
      </Card>,
    );
    expect(getByText('Isi kartu')).toBeTruthy();
  });

  it('gaya kartu sama dengan kartu order', () => {
    const { toJSON } = render(
      <Card>
        <Text>Isi kartu</Text>
      </Card>,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.backgroundColor).toBe(themes.gelap.surface);
    expect(gaya.borderRadius).toBe(radius.xl2);
    expect(gaya.borderWidth).toBe(1);
    expect(gaya.borderColor).toBe(themes.gelap.lineCard);
    expect(gaya.borderTopColor).toBe(themes.gelap.edgeHighlight);
    expect(gaya.padding).toBe(16);
  });

  it('tema gelap tidak pakai elevasi', () => {
    const { toJSON } = render(
      <ThemeProvider name="gelap">
        <Card>
          <Text>Isi kartu</Text>
        </Card>
      </ThemeProvider>,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.elevation).toBeUndefined();
  });

  it('tema terang pakai elevasi kartu', () => {
    const { toJSON } = render(
      <ThemeProvider name="terang">
        <Card>
          <Text>Isi kartu</Text>
        </Card>
      </ThemeProvider>,
    );
    const gaya = StyleSheet.flatten(toJSON().props.style);
    expect(gaya.elevation).toBe(elevation.card);
    expect(gaya.backgroundColor).toBe(themes.terang.surface);
  });

  it('label aksesibilitas diteruskan', () => {
    const { getByLabelText } = render(
      <Card accessibilityLabel="Kartu langkah">
        <Text>Isi kartu</Text>
      </Card>,
    );
    expect(getByLabelText('Kartu langkah')).toBeTruthy();
  });
});
