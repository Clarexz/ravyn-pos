/** Contratos de todo lo que depende del SO o del hardware. El negocio solo conoce estas interfaces. */

export interface PrintJobEvent {
  /** Id del trabajo en el spooler (o generado en simulación). */
  externalId: string;
  document: string;
  printer: string;
  pages: number;
  detectedAt: number;
}

export interface PrintWatcher {
  start(onJob: (job: PrintJobEvent) => void): Promise<void>;
  stop(): Promise<void>;
}

export interface ReceiptDocument {
  title: string;
  lines: string[];
  /** Folio grande (órdenes). */
  folio?: string;
}

export interface ReceiptPrinter {
  /** Térmica ESC/POS, impresora normal o archivo de texto en simulación. */
  print(doc: ReceiptDocument): Promise<void>;
}

export interface CashDrawer {
  open(): Promise<void>;
}

export interface ServiceStatus {
  installed: boolean;
  running: boolean;
}

export interface ServiceHost {
  install(): Promise<void>;
  uninstall(): Promise<void>;
  status(): Promise<ServiceStatus>;
}

export interface Adapters {
  mode: 'simulated' | 'windows';
  printWatcher: PrintWatcher;
  receiptPrinter: ReceiptPrinter;
  cashDrawer: CashDrawer;
  serviceHost: ServiceHost;
}
