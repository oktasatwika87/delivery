/**
 * Tes modul getar: tiap fungsi harus memanggil pustaka getar sekali,
 * dengan argumen yang persis.
 */

import { trigger, triggerPattern } from 'react-native-haptic-feedback';

import { hapticAccept, hapticDelivered, hapticError } from './haptics';

describe('modul getar', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('terima order bergetar impactMedium', () => {
    hapticAccept();

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('impactMedium');
  });

  it('selesai bergetar dua kali', () => {
    hapticDelivered();

    expect(triggerPattern).toHaveBeenCalledTimes(1);
    expect(triggerPattern).toHaveBeenCalledWith([
      { time: 0, type: 'transient', intensity: 0.4, sharpness: 0.4 },
      { time: 250, type: 'transient', intensity: 1, sharpness: 0.8 },
    ]);
  });

  it('galat bergetar notificationError', () => {
    hapticError();

    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith('notificationError');
  });

  it('tidak ada opsi yang ikut', () => {
    hapticAccept();
    hapticError();

    expect(trigger).toHaveBeenNthCalledWith(1, 'impactMedium');
    expect(trigger).toHaveBeenNthCalledWith(2, 'notificationError');
  });
});
