/**
 * Tes komponen Icon dan data path ikon.
 *
 * react-native-svg dipetakan ke tiruan di src/__mocks__/react-native-svg.ts,
 * jadi tes memeriksa props Svg dan Path yang diteruskan.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import Svg, { Path } from 'react-native-svg';

import { Icon } from './Icon';
import { iconPaths } from './icons';
import { colors, size } from './tokens';

const NAMA_IKON = [
  'add',
  'arrow_back',
  'call',
  'chat',
  'check',
  'check_circle',
  'check_circle_fill',
  'chevron_right',
  'close',
  'cloud_done',
  'cloud_off',
  'cloud_upload',
  'delete',
  'directions',
  'download',
  'download_done',
  'edit_note',
  'error',
  'history',
  'info',
  'inventory_2',
  'location_on',
  'lock',
  'logout',
  'map',
  'my_location',
  'navigation',
  'payments',
  'person',
  'refresh',
  'route',
  'schedule',
  'search',
  'send',
  'sync',
  'sync_problem',
  'two_wheeler',
  'visibility',
  'visibility_off',
  'warning',
];

describe('Icon', () => {
  it('Svg menerima viewBox ikon dan Path menerima data path serta warna', () => {
    const { UNSAFE_getByType } = render(<Icon name="check" />);
    const svg = UNSAFE_getByType(Svg);
    const path = UNSAFE_getByType(Path);
    expect(svg.props.viewBox).toBe(iconPaths.check.viewBox);
    expect(path.props.d).toBe(iconPaths.check.d);
    expect(path.props.fill).toBe(colors.text);
  });

  it('ukuran bawaan 24 dan warna bawaan warna teks', () => {
    const { UNSAFE_getByType } = render(<Icon name="check" />);
    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.width).toBe(size.icon);
    expect(svg.props.height).toBe(size.icon);
    expect(UNSAFE_getByType(Path).props.fill).toBe(colors.text);
  });

  it('ukuran dan warna yang diberikan dipakai apa adanya', () => {
    const { UNSAFE_getByType } = render(
      <Icon name="check" size={40} color={colors.danger} />,
    );
    const svg = UNSAFE_getByType(Svg);
    expect(svg.props.width).toBe(40);
    expect(svg.props.height).toBe(40);
    expect(UNSAFE_getByType(Path).props.fill).toBe(colors.danger);
  });

  it('tanpa label ikon disembunyikan dari pembaca layar', () => {
    const { UNSAFE_getByType } = render(<Icon name="check" />);
    const wadah = UNSAFE_getByType(View);
    expect(wadah.props.accessible).toBe(false);
    expect(wadah.props.importantForAccessibility).toBe('no-hide-descendants');
  });

  it('dengan label ikon berperan sebagai gambar dan memakai label itu', () => {
    const { UNSAFE_getByType } = render(
      <Icon name="check" accessibilityLabel="Tanda centang" />,
    );
    const wadah = UNSAFE_getByType(View);
    expect(wadah.props.accessible).toBe(true);
    expect(wadah.props.accessibilityRole).toBe('image');
    expect(wadah.props.accessibilityLabel).toBe('Tanda centang');
  });
});

describe('data path ikon', () => {
  it('memuat 40 ikon dengan nama yang lengkap', () => {
    expect(Object.keys(iconPaths).sort()).toEqual([...NAMA_IKON].sort());
  });

  it('tiap ikon punya data path dan viewBox yang tidak kosong', () => {
    for (const [, isi] of Object.entries(iconPaths)) {
      expect(isi.d.length).toBeGreaterThan(0);
      expect(isi.viewBox.length).toBeGreaterThan(0);
    }
  });
});
