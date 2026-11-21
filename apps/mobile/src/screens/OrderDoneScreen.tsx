/**
 * Layar sukses order selesai diantar.
 *
 * Layar ini menampilkan hasil akhir dari satu order yang sudah diantar:
 * centang besar, nomor order, dan ringkasan hari ini. Angkanya bergulir
 * setelah layar selesai memudar masuk, jadi layar sempat tenang dulu.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { withDatabase, withObservables } from '@nozbe/watermelondb/react';
import type { Database } from '@nozbe/watermelondb';
import { of } from 'rxjs';
import Svg, { Circle } from 'react-native-svg';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../App';
import { OrderModel } from '../db/models/OrderModel';
import { PaymentModel } from '../db/models/PaymentModel';
import { PendingActionModel } from '../db/models/PendingActionModel';
import {
  allActionsQuery,
  cashPaymentsQuery,
  driverOrdersQuery,
} from '../db/driverQueries';
import { getCurrentUserId } from '../sync/session';
import { hitungAntrean } from '../sync/hitungAntrean';
import { useNetworkStatus } from '../map/useNetworkStatus';
import { deriveDaySummary, MATA_UANG_TUNAI } from './daySummary';
import { Button } from '../components/Button';
import { DaySummary } from '../components/DaySummary';
import { ScreenFrame } from '../components/ScreenFrame';
import { DrawnStroke } from '../components/motion/DrawnPath';
import { shift } from '../components/motion/presets';
import { useTheme } from '../theme/ThemeProvider';
import { motion, space, type } from '../theme/tokens';
import { formatOrderNumber } from '../formatOrderNumber';

/** Centang baru digambar sesudah layar kira-kira selesai memudar masuk, supaya gambarnya terlihat. */
const JEDA_CENTANG = motion.duration.enter;

/** Panjang dua ruas path centang. */
const PANJANG_CENTANG = Math.hypot(14, 14) + Math.hypot(27, 28);

/** Path centang, dari titik kiri bawah ke titik kanan atas. */
const JALUR_CENTANG = 'M32 53 L46 67 L73 39';

const UKURAN_LINGKARAN = 104;

/**
 * Kerangka menggeser isi layar saat bilah koneksi masuk atau keluar.
 *
 * Isi tengah dan kaki posisinya dihitung dari tinggi isi layar, jadi diberi
 * gerak geser yang sama supaya tidak melompat. Layar ini tanpa jendela awal,
 * jadi geraknya selalu diisi.
 */
const GESER = shift();

interface Props {
  myOrders: OrderModel[];
  payments: PaymentModel[];
  actions?: PendingActionModel[];
}

/**
 * Isi layar sukses.
 *
 * Diekspor supaya tes bisa merender langsung, tanpa melewati pembungkus
 * database dan langganan data.
 */
export function OrderDoneBase({
  myOrders,
  payments,
  actions = [],
}: Props): React.JSX.Element {
  const { colors } = useTheme();
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList, 'OrderDone'>>();
  const route = useRoute<RouteProp<RootStackParamList, 'OrderDone'>>();
  const orderId = route.params.orderId;
  const insets = useSafeAreaInsets();
  const networkStatus = useNetworkStatus();
  const kurangiGerak = useReducedMotion();

  const ringkasan = deriveDaySummary(myOrders, payments, actions, Date.now());
  const antrean = hitungAntrean(actions);

  // Angka selesai baru bernilai akhir sesudah centang selesai digambar.
  const [angkaSesudah, setAngkaSesudah] = useState(kurangiGerak);

  useEffect(() => {
    if (angkaSesudah) return;
    const timer = setTimeout(
      () => setAngkaSesudah(true),
      JEDA_CENTANG + motion.duration.drawLine,
    );
    return () => clearTimeout(timer);
  }, [angkaSesudah]);

  const selesaiTampil = angkaSesudah
    ? ringkasan.doneCount
    : Math.max(0, ringkasan.doneCount - 1);

  return (
    <ScreenFrame
      header={null}
      connection={{
        status: networkStatus,
        pendingCount: antrean.pendingCount,
        failedCount: antrean.failedCount,
      }}
    >
      <View style={styles.isiTengah}>
        <Animated.View testID="isi-sukses" style={styles.kelompokTengah} layout={GESER}>
          <View
            style={styles.lingkaran}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          >
            <Svg width={UKURAN_LINGKARAN} height={UKURAN_LINGKARAN} viewBox="0 0 104 104">
              <Circle cx={52} cy={52} r={52} fill={colors.accent} />
              <DrawnStroke
                d={JALUR_CENTANG}
                length={PANJANG_CENTANG}
                color={colors.onAccent}
                strokeWidth={7}
                animate={!kurangiGerak}
                delay={JEDA_CENTANG}
              />
            </Svg>
          </View>
          <Text
            accessibilityRole="header"
            style={[styles.judul, { color: colors.text }]}
          >
            Order selesai diantar
          </Text>
          <Text style={[styles.nomorOrder, { color: colors.textSubtle }]}>
            {`Order ${formatOrderNumber(orderId)}`}
          </Text>
          <View style={styles.ringkasan}>
            <DaySummary
              doneCount={selesaiTampil}
              cashAmount={ringkasan.cashAmount}
              currency={MATA_UANG_TUNAI}
            />
          </View>
        </Animated.View>
      </View>
      <Animated.View
        testID="kaki-sukses"
        layout={GESER}
        style={[
          styles.kaki,
          { paddingBottom: space[6] + insets.bottom },
        ]}
      >
        <Button
          title="Kembali ke daftar order"
          size="lg"
          onPress={() => navigation.goBack()}
        />
      </Animated.View>
    </ScreenFrame>
  );
}

const OrderDoneDenganObservables = withDatabase(
  withObservables(
    ['currentUserId'],
    ({
      database,
      currentUserId,
    }: {
      database: Database;
      currentUserId: string | null;
    }) => ({
      myOrders: currentUserId
        ? driverOrdersQuery(database, currentUserId)
        : of<OrderModel[]>([]),
      payments: currentUserId
        ? cashPaymentsQuery(database)
        : of<PaymentModel[]>([]),
      actions: currentUserId
        ? allActionsQuery(database)
        : of<PendingActionModel[]>([]),
    }),
  )(OrderDoneBase),
);

function OrderDonePembungkus({
  database,
}: {
  database: Database;
}): React.JSX.Element {
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const { colors } = useTheme();

  useEffect(() => {
    getCurrentUserId().then(setCurrentUserId);
  }, []);

  if (currentUserId === null) {
    return <View style={[styles.menunggu, { backgroundColor: colors.bg }]} />;
  }

  return (
    <OrderDoneDenganObservables
      database={database}
      currentUserId={currentUserId}
    />
  );
}

export const OrderDoneScreen = withDatabase(OrderDonePembungkus);

const styles = StyleSheet.create({
  menunggu: {
    flex: 1,
  },
  isiTengah: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space[6],
  },
  kelompokTengah: {
    alignSelf: 'stretch',
    alignItems: 'center',
  },
  lingkaran: {
    width: UKURAN_LINGKARAN,
    height: UKURAN_LINGKARAN,
  },
  judul: {
    ...type.titleXl,
    marginTop: space[6],
    textAlign: 'center',
  },
  nomorOrder: {
    ...type.bodySm,
    marginTop: 6,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  ringkasan: {
    alignSelf: 'stretch',
    marginTop: 28,
  },
  kaki: {
    paddingHorizontal: space[6],
  },
});
