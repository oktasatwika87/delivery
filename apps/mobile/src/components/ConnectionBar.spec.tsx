/**
 * Tes komponen ConnectionBar.
 *
 * Bilah ini cuma muncul kalau ada yang perlu diberi tahu ke pengguna.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { ConnectionBar } from './ConnectionBar';
import { Icon } from '../theme/Icon';
import { colors } from '../theme/tokens';

const TITIK_TENGAH = '·';

describe('ConnectionBar', () => {
  it('offline menampilkan teks lengkap', () => {
    const { getByText } = render(<ConnectionBar status="offline" pendingCount={0} />);
    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
  });

  it('offline dengan antrean tetap menampilkan teks offline', () => {
    const { getByText } = render(<ConnectionBar status="offline" pendingCount={3} />);
    expect(getByText(`Offline ${TITIK_TENGAH} perubahan disimpan di HP`)).toBeTruthy();
  });

  it('online dengan antrean menampilkan jumlah perubahan yang dikirim', () => {
    const { getByText } = render(<ConnectionBar status="online" pendingCount={3} />);
    expect(getByText('Menyinkronkan 3 perubahan')).toBeTruthy();
  });

  it('online tanpa antrean tidak merender apa pun', () => {
    const { toJSON } = render(<ConnectionBar status="online" pendingCount={0} />);
    expect(toJSON()).toBeNull();
  });

  it('status unknown dengan antrean tidak merender apa pun', () => {
    const { toJSON } = render(<ConnectionBar status="unknown" pendingCount={3} />);
    expect(toJSON()).toBeNull();
  });

  it('warna isi berbeda antara offline dan sedang sinkron', () => {
    const offline = StyleSheet.flatten(
      render(<ConnectionBar status="offline" pendingCount={0} />).toJSON().props.style,
    );
    expect(offline.backgroundColor).toBe(colors.surfaceInverse);
    const sinkron = StyleSheet.flatten(
      render(<ConnectionBar status="online" pendingCount={2} />).toJSON().props.style,
    );
    expect(sinkron.backgroundColor).toBe(colors.success);
  });

  it('ikon menyesuaikan keadaan', () => {
    const offline = render(<ConnectionBar status="offline" pendingCount={0} />);
    expect(offline.UNSAFE_getByType(Icon).props.name).toBe('cloud_off');
    const sinkron = render(<ConnectionBar status="online" pendingCount={2} />);
    expect(sinkron.UNSAFE_getByType(Icon).props.name).toBe('sync');
  });
});
