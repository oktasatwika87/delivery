/**
 * Modul getar.
 *
 * Satu-satunya tempat yang memanggil pustaka getar, jadi layar cukup
 * memanggil fungsi di sini dan tidak perlu tahu detail polanya.
 *
 * Getar tanpa opsi, jadi tetap mengikuti setelan sistem: diam saat mode
 * senyap. Di Android jenis bawaan pustaka cuma 40 ms dan nyaris tidak
 * terasa di HP kelas bawah, jadi tiap getar ditulis sebagai pola dengan
 * durasinya sendiri. Pustaka di Android hanya membaca `time`, `duration`,
 * dan `intensity`. Di HP mahal getarnya mungkin sedikit lebih berdengung,
 * itu diterima.
 */

import { Platform } from 'react-native';
import { trigger, triggerPattern } from 'react-native-haptic-feedback';
import type { HapticEvent } from 'react-native-haptic-feedback';

/** Pola Android: hanya waktu mulai, durasi, dan kuatnya getaran. */
const POLA_TERIMA: HapticEvent[] = [{ time: 0, duration: 70, intensity: 1 }];

const POLA_SELESAI: HapticEvent[] = [
  { time: 0, duration: 60, intensity: 0.7 },
  { time: 250, duration: 90, intensity: 1 },
];

const POLA_GALAT: HapticEvent[] = [
  { time: 0, duration: 60, intensity: 1 },
  { time: 120, duration: 60, intensity: 1 },
  { time: 240, duration: 60, intensity: 1 },
];

/** Order diterima, jadi bergetar sekali dengan getaran sedang. */
export function hapticAccept(): void {
  if (Platform.OS === 'android') {
    triggerPattern(POLA_TERIMA);
    return;
  }
  trigger('impactMedium');
}

/** Order selesai diantar, jadi bergetar dua kali: pelan lalu tegas. */
export function hapticDelivered(): void {
  if (Platform.OS === 'android') {
    triggerPattern(POLA_SELESAI);
    return;
  }
  triggerPattern([
    { time: 0, type: 'transient', intensity: 0.4, sharpness: 0.4 },
    { time: 250, type: 'transient', intensity: 1, sharpness: 0.8 },
  ]);
}

/** Ada yang gagal, jadi bergetar tanda galat. */
export function hapticError(): void {
  if (Platform.OS === 'android') {
    triggerPattern(POLA_GALAT);
    return;
  }
  trigger('notificationError');
}
