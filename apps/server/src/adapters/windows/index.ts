import type {
  CashDrawer,
  PrintWatcher,
  ReceiptPrinter,
  ServiceHost,
  ServiceStatus,
} from '../types.js';

function pending(task: string): never {
  throw new Error(`Adaptador de Windows pendiente de implementar (${task}).`);
}

/** Lee PrintService/Operational (evento 307). Lo define el resultado de T0.6. */
export class WindowsPrintWatcher implements PrintWatcher {
  async start(): Promise<void> {
    pending('T6.1');
  }
  async stop(): Promise<void> {}
}

/** ESC/POS a térmica, o impresora normal si no hay térmica. */
export class WindowsReceiptPrinter implements ReceiptPrinter {
  async print(): Promise<void> {
    pending('T2.7');
  }
}

export class WindowsCashDrawer implements CashDrawer {
  async open(): Promise<void> {
    pending('T2.7');
  }
}

/** Servicio de Windows (NSSM o node-windows). */
export class WindowsServiceHost implements ServiceHost {
  async install(): Promise<void> {
    pending('T7.2');
  }
  async uninstall(): Promise<void> {
    pending('T7.2');
  }
  async status(): Promise<ServiceStatus> {
    return pending('T7.2');
  }
}
