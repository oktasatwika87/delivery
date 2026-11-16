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
import { perTema, ThemeProvider, useTheme } from '../theme/ThemeProvider';
import { elevation, radius, size, space, stroke, type } from '../theme/tokens';

const TITIK_TENGAH = '\u00b7';
const JARAK_IKON = 6;

export interface OrderCardPoolProps {
  orderNumber: string;
  timeText: string;
  city: string | null;
  amountText: string;
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

const gaya = perTema((c) =>
  StyleSheet.create({
    kartu: {
      backgroundColor: c.surface,
      borderRadius: radius.xl2,
      borderWidth: stroke.hairline,
      borderColor: c.lineCard,
      borderTopColor: c.edgeHighlight,
      padding: space[4],
    },
    atas: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      gap: space[3],
    },
    barisKota: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: JARAK_IKON,
      flexShrink: 1,
    },
    kota: {
      ...type.titleLg,
      color: c.text,
      flexShrink: 1,
    },
    kotaKosong: {
      ...type.bodyMd,
      color: c.textMuted,
      flexShrink: 1,
    },
    jumlahBesar: {
      ...type.amountLg,
      color: c.text,
    },
    jumlah: {
      ...type.amount,
      color: c.text,
    },
    barisOrder: {
      ...type.bodySm,
      color: c.textSubtle,
      marginTop: 4,
    },
    tombol: {
      marginTop: space[4],
    },
    alamat: {
      ...type.titleSm,
      color: c.text,
      marginTop: 12,
    },
    kotaAlamat: {
      ...type.bodySm,
      color: c.textMuted,
      marginTop: 2,
    },
    lencana: {
      marginTop: 12,
    },
  }),
);

/**
 * Wadah kartu pool. Kalau bisa ditekan, kartu jadi satu tombol, tapi tombol
 * Terima di dalamnya tetap bisa dicapai pembaca layar.
 */
function WadahKartu({ onPress, children }: WadahKartuProps): React.JSX.Element {
  const { name } = useTheme();
  const s = gaya[name];
  // Tema terang pakai elevasi, tema gelap ambil kedalaman dari warnanya.
  const bayangan = name === 'terang' ? { elevation: elevation.card } : null;

  if (!onPress) {
    return <View style={[s.kartu, bayangan]}>{children}</View>;
  }
  return (
    <Pressable onPress={onPress} accessible={false} style={[s.kartu, bayangan]}>
      {children}
    </Pressable>
  );
}

export function OrderCard(props: OrderCardProps): React.JSX.Element {
  if (props.variant === 'pool') {
    return <KartuPool {...props} />;
  }

  if (props.variant === 'mine') {
    return <KartuMine {...props} />;
  }

  // Baris order di layar customer selalu memakai tema terang.
  return (
    <ThemeProvider name="terang">
      <KartuRow {...props} />
    </ThemeProvider>
  );
}

function KartuPool(props: OrderCardPoolProps): React.JSX.Element {
  const { name, colors } = useTheme();
  const s = gaya[name];

  return (
    <WadahKartu onPress={props.onPress}>
      <View style={s.atas}>
        <View style={s.barisKota}>
          <Icon
            name="location_on"
            size={size.iconMd}
            color={props.city ? colors.info : colors.textSubtle}
          />
          {props.city ? (
            <Text style={s.kota}>{props.city}</Text>
          ) : (
            <Text style={s.kotaKosong}>Alamat tampil setelah order diterima</Text>
          )}
        </View>
        <Text style={s.jumlahBesar}>{props.amountText}</Text>
      </View>
      <Text style={s.barisOrder}>
        {`Order ${props.orderNumber} ${TITIK_TENGAH} ${props.timeText}`}
      </Text>
      <View style={s.tombol}>
        <Button
          title="Terima Order"
          onPress={props.onAccept}
          variant="primary"
          size="card"
          disabled={props.acceptDisabled}
          loading={props.acceptLoading}
        />
      </View>
      {props.acceptHelp ? <HelpLine text={props.acceptHelp} /> : null}
    </WadahKartu>
  );
}

function KartuMine(props: OrderCardMineProps): React.JSX.Element {
  const { name } = useTheme();
  const s = gaya[name];
  const bayangan = name === 'terang' ? { elevation: elevation.card } : null;

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={[s.kartu, bayangan]}
    >
      <View style={s.atas}>
        <StatusLabel status={props.status} label={props.statusText} />
        <Text style={s.jumlah}>{props.amountText}</Text>
      </View>
      <Text style={s.alamat}>{props.addressMain}</Text>
      {props.addressSub ? <Text style={s.kotaAlamat}>{props.addressSub}</Text> : null}
      <Text style={s.barisOrder}>
        {props.timeText
          ? `Order ${props.orderNumber} ${TITIK_TENGAH} ${props.timeText}`
          : `Order ${props.orderNumber}`}
      </Text>
      {/*
        Lencana selalu dipasang, walau aksinya sudah terkirim. Kalau
        lencana dilepas begitu syncState kosong, useHoldDone di dalamnya
        tidak pernah sampai ke fase selesai dan centangnya tidak pernah
        keliatan.
      */}
      <SyncBadge state={props.syncState ?? null} style={s.lencana} />
    </Pressable>
  );
}

function KartuRow(props: OrderCardRowProps): React.JSX.Element {
  const { name } = useTheme();
  const s = gaya[name];
  const bayangan = name === 'terang' ? { elevation: elevation.card } : null;

  return (
    <Pressable
      onPress={props.onPress}
      accessibilityRole="button"
      style={[s.kartu, bayangan]}
    >
      <View style={s.atas}>
        <StatusLabel status={props.status} label={props.statusText} />
        <Text style={s.jumlah}>{props.amountText}</Text>
      </View>
      {props.addressText ? <Text style={s.alamat}>{props.addressText}</Text> : null}
      <Text style={s.barisOrder}>
        {`Order ${props.orderNumber} ${TITIK_TENGAH} ${props.dateText}`}
      </Text>
    </Pressable>
  );
}
