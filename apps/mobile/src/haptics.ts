/**
 * Modul getar.
 *
 * Satu-satunya tempat yang memanggil pustaka getar, supaya layar cukup
 * memanggil fungsi di sini dan tidak perlu tahu detail polanya.
 *
 * Getar tanpa opsi, jadi mengikuti setelan sistem.
 */

import { trigger, triggerPattern } from 'react-native-haptic-feedback';

/** Order diterima, jadi bergetar sekali dengan getaran sedang. */
export function hapticAccept(): void {
  trigger('impactMedium');
}

/** Order selesai diantar, jadi bergetar dua kali: pelan lalu tegas. */
export function hapticDelivered(): void {
  triggerPattern([
    { time: 0, type: 'transient', intensity: 0.4, sharpness: 0.4 },
    { time: 250, type: 'transient', intensity: 1, sharpness: 0.8 },
  ]);
}

/** Ada yang gagal, jadi bergetar tanda galat. */
export function hapticError(): void {
  trigger('notificationError');
}
