import path from 'node:path';
import {
  SimulatedCashDrawer,
  SimulatedPrintWatcher,
  SimulatedReceiptPrinter,
  SimulatedServiceHost,
} from './simulated/index.js';
import type { Adapters } from './types.js';
import {
  WindowsCashDrawer,
  WindowsPrintWatcher,
  WindowsReceiptPrinter,
  WindowsServiceHost,
} from './windows/index.js';

export * from './types.js';
export * from './simulated/index.js';

export interface AdapterEnv {
  platform?: NodeJS.Platform;
  /** `POS_ADAPTERS=simulated` fuerza simulación aunque sea Windows. */
  POS_ADAPTERS?: string;
  /** Directorio donde la simulación guarda comprobantes de texto. */
  dataDir?: string;
  /** `POS_SIM_PRINT_INTERVAL_MS`: cada cuánto la simulación genera un trabajo (0 = nunca). */
  simPrintIntervalMs?: number;
}

export function createAdapters(env: AdapterEnv = {}): Adapters {
  const platform = env.platform ?? process.platform;
  const simulated = env.POS_ADAPTERS === 'simulated' || platform !== 'win32';

  if (simulated) {
    return {
      mode: 'simulated',
      printWatcher: new SimulatedPrintWatcher(env.simPrintIntervalMs ?? 0),
      receiptPrinter: new SimulatedReceiptPrinter(
        env.dataDir ? path.join(env.dataDir, 'receipts') : undefined,
      ),
      cashDrawer: new SimulatedCashDrawer(),
      serviceHost: new SimulatedServiceHost(),
    };
  }

  return {
    mode: 'windows',
    printWatcher: new WindowsPrintWatcher(),
    receiptPrinter: new WindowsReceiptPrinter(),
    cashDrawer: new WindowsCashDrawer(),
    serviceHost: new WindowsServiceHost(),
  };
}
