/**
 * Jendela awal layar.
 *
 * Elemen keadaan yang muncul atau berubah dalam motion.initialWindow
 * milidetik pertama sejak layar dipasang tampil tanpa gerak, supaya layar
 * yang baru dibuka tidak ramai. Sesudah itu jendelanya ditutup sendiri.
 */

import React, { createContext, useContext, useEffect, useState } from 'react';

import { motion } from '../../theme/tokens';

const KonteksJendela = createContext<boolean>(false);

interface InitialWindowProviderProps {
  children: React.ReactNode;
}

export function InitialWindowProvider({
  children,
}: InitialWindowProviderProps): React.JSX.Element {
  const [dalamJendela, setDalamJendela] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDalamJendela(false);
    }, motion.initialWindow);
    return () => clearTimeout(timer);
  }, []);

  return (
    <KonteksJendela.Provider value={dalamJendela}>{children}</KonteksJendela.Provider>
  );
}

/** True selama jendela awal masih terbuka. Tanpa penyedia, langsung false. */
export function useInitialWindow(): boolean {
  return useContext(KonteksJendela);
}

/**
 * Membungkus layar dengan penyedia jendela awal.
 *
 * Dipakai di registrasi layar, jadi layar tidak perlu tahu soal jendela.
 */
export function withInitialWindow<P extends object>(
  Layar: React.ComponentType<P>,
): React.FunctionComponent<P> {
  function LayarDenganJendela(props: P): React.JSX.Element {
    return (
      <InitialWindowProvider>
        <Layar {...props} />
      </InitialWindowProvider>
    );
  }
  return LayarDenganJendela;
}
