/**
 * Tes untuk appStateControl.ts.
 *
 * Kelas ini menentukan kapan sinkron dan kedua socket dijalankan lagi
 * dari perubahan status aplikasi:
 * - 'background' menghentikan sesi dan menandainya dijeda.
 * - 'inactive' tidak melakukan apa-apa, hanya mencatat.
 * - 'active' mengecek jaringan lagi, dan menjalankan sesi lagi hanya
 *   kalau sesi sebelumnya dijeda karena background dan masih hidup.
 */

import { AppStateControl } from './appStateControl';

describe('appStateControl', () => {
  let sessionActive: boolean;
  let beginSession: jest.Mock;
  let endSession: jest.Mock;
  let recheckNetwork: jest.Mock;

  beforeEach(() => {
    sessionActive = true;
    beginSession = jest.fn();
    endSession = jest.fn();
    recheckNetwork = jest.fn();
  });

  function buatControl(): AppStateControl {
    return new AppStateControl({
      isSessionActive: () => sessionActive,
      beginSession,
      endSession,
      recheckNetwork,
    });
  }

  it('status active lalu inactive lalu active tidak memutus dan tidak memulai sesi lagi', () => {
    const control = buatControl();

    control.handleChange('active');
    control.handleChange('inactive');
    control.handleChange('active');

    expect(endSession).not.toHaveBeenCalled();
    expect(beginSession).not.toHaveBeenCalled();
  });

  it('status active lalu inactive lalu background lalu active memutus sekali lalu memulai sekali', () => {
    const control = buatControl();

    control.handleChange('active');
    control.handleChange('inactive');
    control.handleChange('background');
    control.handleChange('active');

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(beginSession).toHaveBeenCalledTimes(1);
  });

  it('status active lalu background lalu active memutus sekali lalu memulai sekali', () => {
    const control = buatControl();

    control.handleChange('active');
    control.handleChange('background');
    control.handleChange('active');

    expect(endSession).toHaveBeenCalledTimes(1);
    expect(beginSession).toHaveBeenCalledTimes(1);
  });

  it('status background lalu active tanpa sesi tidak memulai sesi', () => {
    sessionActive = false;
    const control = buatControl();

    control.handleChange('background');
    control.handleChange('active');

    expect(beginSession).not.toHaveBeenCalled();
  });

  it('status active pertama tanpa jeda sebelumnya tidak memulai sesi', () => {
    const control = buatControl();

    control.handleChange('active');

    expect(beginSession).not.toHaveBeenCalled();
  });

  it('status background dua kali lalu active memulai sesi sekali', () => {
    const control = buatControl();

    control.handleChange('background');
    control.handleChange('background');
    control.handleChange('active');

    // Tiap status background memanggil penghentian sesi.
    expect(endSession).toHaveBeenCalledTimes(2);
    expect(beginSession).toHaveBeenCalledTimes(1);
  });

  it('status active mengecek jaringan lagi tiap kali', () => {
    const control = buatControl();

    control.handleChange('active');
    control.handleChange('inactive');
    control.handleChange('active');

    expect(recheckNetwork).toHaveBeenCalledTimes(2);
  });

  it('sesi yang dimulai dari login tidak memulai sesi lagi saat status active', () => {
    const control = buatControl();

    control.handleChange('background');
    control.noteSessionStarted();
    control.handleChange('active');

    expect(beginSession).not.toHaveBeenCalled();
  });

  it('sesi yang berakhir tidak dimulai lagi saat status active', () => {
    const control = buatControl();

    control.handleChange('background');
    control.noteSessionEnded();
    control.handleChange('active');

    expect(beginSession).not.toHaveBeenCalled();
  });
});
