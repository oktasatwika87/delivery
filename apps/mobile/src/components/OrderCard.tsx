/**
 * Kartu order.
 *
 * Satu komponen dengan tiga bentuk. Pool untuk order yang tersedia diambil,
 * mine untuk order milik sendiri, dan row untuk baris order di layar
 * customer.
 */

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { OrderStatus } from '@delivery/shared';

import { Button } from './Button';
import { HelpLine } from './HelpLine';
import { StatusLabel } from './StatusLabel';
import { SyncBadge } from './SyncBadge';
import type { SyncState } from './SyncBadge';
import { Icon } from '../theme/Icon';
import { colors, elevation, radius, size, space, type } from '../theme/tokens';

const TINGGI_GARIS = 1;

export interface OrderCardPoolProps {
  orderNumber: string;
  timeText: string;
  city: string | null;
  amountText: string;
  amountCaption?: string;
  onAccept: () => void;
  acceptDisabled?: boolean;
  acceptLoading?: boolean;
  acceptHelp?: string;
  onPress?: () => void;
}

export interface OrderCardMineProps {
  orderNumber: string;
  status: OrderStatus;
  statusText: string;
  addressMain: string;
  addressSub?: string;
  syncState?: SyncState;
  amountText: string;
  onPress: () => void;
  timeText?: string;
}

export interface OrderCardRowProps {
  orderNumber: string;
  dateText: string;
  addressText?: string;
  status: OrderStatus;
  statusText: string;
  amountText: string;
  onPress: () => void;
}

export type OrderCardProps =
  | ({ variant: 'pool' } & OrderCardPoolProps)
  | ({ variant: 'mine' } & OrderCardMineProps)
  | ({ variant: 'row' } & OrderCardRowProps);

interface WadahKartuProps {
  onPress?: () => void;
  children: React.ReactNode;
}

/**
 * Wadah kartu pool. Kalau bisa ditekan, kartu jadi satu tombol, tapi tombol
 * Terima di dalamnya tetap bisa dicapai pembaca layar.
 */
function WadahKartu({ onPress, children }: WadahKartuProps): React.JSX.Element {
  if (!onPress) {
    return <View style={styles.kartu}>{children}</View>;
  }
  return (
    <Pressable onPress={onPress} accessible={false} style={styles.kartu}>
      {children}
    </Pressable>
  );
}

export function OrderCard(props: OrderCardProps): React.JSX.Element {
  if (props.variant === 'pool') {
    return (
      <WadahKartu onPress={props.onPress}>
        <View style={styles.atas}>
          <Text style={styles.nomorKartu}>ORDER {props.orderNumber}</Text>
          <Text style={styles.waktuKartu}>{props.timeText}</Text>
        </View>
        <View style={styles.barisAlamat}>
          <Icon name="location_on" size={size.iconSm} color={colors.text} />
          {props.city ? (
            <Text style={styles.kota}>{props.city}</Text>
          ) : (
            <Text style={styles.kotaKosong}>Alamat tampil setelah order diterima</Text>
          )}
        </View>
        <View style={styles.garis} />
        <View style={styles.bawah}>
          <View style={styles.kolomKiri}>
            <Text style={styles.jumlah}>{props.amountText}</Text>
            {props.amountCaption ? (
              <Text style={styles.keterangan}>{props.amountCaption}</Text>
            ) : null}
          </View>
          <Button
            title="Terima Order"
            onPress={props.onAccept}
            variant="primary"
            size="md"
            disabled={props.acceptDisabled}
            loading={props.acceptLoading}
          />
        </View>
        {props.acceptHelp ? <HelpLine text={props.acceptHelp} /> : null}
      </WadahKartu>
    );
  }

  if (props.variant === 'mine') {
    return (
      <Pressable onPress={props.onPress} accessibilityRole="button" style={styles.kartu}>
        <View style={styles.atas}>
          <View style={styles.kolomKiri}>
            <Text style={styles.nomorKartu}>ORDER {props.orderNumber}</Text>
            {props.timeText ? (
              <Text style={styles.waktuKartu}>{props.timeText}</Text>
            ) : null}
          </View>
          <StatusLabel status={props.status} label={props.statusText} />
        </View>
        <View style={styles.barisAlamat}>
          <Icon name="location_on" size={size.iconSm} color={colors.text} />
          <View style={styles.kolomKiri}>
            <Text style={styles.kota}>{props.addressMain}</Text>
            {props.addressSub ? (
              <Text style={styles.keteranganAlamat}>{props.addressSub}</Text>
            ) : null}
          </View>
        </View>
        {props.syncState ? <SyncBadge state={props.syncState} /> : null}
        <View style={styles.garis} />
        <View style={styles.bawah}>
          <Text style={styles.jumlah}>{props.amountText}</Text>
          <Icon name="chevron_right" size={size.iconSm} color={colors.textSubtle} />
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable onPress={props.onPress} accessibilityRole="button" style={styles.barisKartu}>
      <View style={styles.kolomKiri}>
        <Text style={styles.nomorBaris}>{props.orderNumber}</Text>
        {props.addressText ? (
          <Text style={styles.alamatBaris} numberOfLines={1}>
            {props.addressText}
          </Text>
        ) : null}
        <Text style={styles.waktuBaris}>{props.dateText}</Text>
      </View>
      <View style={styles.kananBaris}>
        <StatusLabel status={props.status} label={props.statusText} />
        <Text style={styles.jumlahBaris}>{props.amountText}</Text>
      </View>
      <Icon name="chevron_right" size={size.iconSm} color={colors.textSubtle} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  kartu: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    elevation: elevation.card,
    padding: space[4],
    gap: space[3],
  },
  atas: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: space[3],
  },
  kolomKiri: {
    flex: 1,
    gap: space[1],
  },
  nomorKartu: {
    ...type.overline,
    color: colors.textMuted,
  },
  waktuKartu: {
    ...type.caption,
    color: colors.textMuted,
  },
  barisAlamat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
  },
  kota: {
    ...type.titleSm,
    color: colors.text,
    flexShrink: 1,
  },
  kotaKosong: {
    ...type.bodySm,
    color: colors.textMuted,
    flexShrink: 1,
  },
  keteranganAlamat: {
    ...type.bodySm,
    color: colors.textMuted,
  },
  garis: {
    height: TINGGI_GARIS,
    backgroundColor: colors.line,
  },
  bawah: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space[3],
  },
  jumlah: {
    ...type.amount,
    color: colors.text,
  },
  keterangan: {
    ...type.caption,
    color: colors.textMuted,
  },
  barisKartu: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    paddingVertical: space[3],
    paddingHorizontal: space[4],
    gap: space[3],
  },
  nomorBaris: {
    ...type.overline,
    color: colors.text,
  },
  alamatBaris: {
    ...type.bodySm,
    color: colors.text,
  },
  waktuBaris: {
    ...type.caption,
    color: colors.textMuted,
  },
  kananBaris: {
    alignItems: 'flex-end',
    gap: space[1],
  },
  jumlahBaris: {
    ...type.titleSm,
    color: colors.text,
  },
});
