/**
 * Tes modul getar: tiap fungsi harus memanggil pustaka getar sekali,
 * dengan argumen yang persis.
 *
 * Android dan iOS dibedakan, karena tiap platform punya polanya sendiri.
 */

import { Platform } from 'react-native';
import { trigger, triggerPattern } from 'react-native-haptic-feedback';

import { hapticAccept, hapticDelivered, hapticError } from './haptics';

describe('modul getar di Android', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('terima order bergetar dengan pola sendiri', () => {
    hapticAccept();

    expect(triggerPattern).toHaveBeenCalledTimes(1);
    expect(triggerPattern).toHaveBeenCalledWith([
      { time: 0, duration: 70, intensity: 1 },
    ]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('selesai bergetar dengan pola sendiri', () => {
    hapticDelivered();

    expect(triggerPattern).toHaveBeenCalledTimes(1);
    expect(triggerPattern).toHaveBeenCalledWith([
      { time: 0, duration: 60, intensity: 0.7 },
      { time: 250, duration: 90, intensity: 1 },
    ]);
    expect(trigger).not.toHaveBeenCalled();
  });

  it('galat bergetar dengan pola sendiri', () => {
    hapticError();

    expect(triggerPattern).toHaveBeenCalledTimes(1);
    expect(triggerPattern).toHaveBeenCalledWith([
      { time: 0, duration: 60, intensity: 1 },
      { time: 120, duration: 60, intensity: 1 },
      { time: 240, duration: 60, intensity: 1 },
    ]);
    expect(trigger).not.toHaveBeenCalled();
  });
});

describe('modul getar di iOS', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.replaceProperty(Platform, 'OS', 'ios');
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
