import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  CashDrawer,
  PrintJobEvent,
  PrintWatcher,
  ReceiptDocument,
  ReceiptPrinter,
  ServiceHost,
  ServiceStatus,
} from '../types.js';

const SAMPLE_DOCS = ['Tarea_historia.pdf', 'Reporte.docx', 'Cartel.pdf', 'Formato_inscripcion.pdf'];
const SAMPLE_PRINTERS = ['Simulada B/N', 'Simulada Color'];

/** Genera trabajos de impresión falsos cada `intervalMs` (0 = solo manual con `emit`). */
export class SimulatedPrintWatcher implements PrintWatcher {
  private timer: NodeJS.Timeout | undefined;
  private onJob: ((job: PrintJobEvent) => void) | undefined;
  private counter = 0;

  constructor(private readonly intervalMs = 0) {}

  async start(onJob: (job: PrintJobEvent) => void): Promise<void> {
    this.onJob = onJob;
    if (this.intervalMs > 0) {
      this.timer = setInterval(() => this.emit(), this.intervalMs);
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.timer = undefined;
    this.onJob = undefined;
  }

  emit(partial: Partial<PrintJobEvent> = {}): PrintJobEvent {
    this.counter += 1;
    const job: PrintJobEvent = {
      externalId: `sim-${this.counter}`,
      document: SAMPLE_DOCS[this.counter % SAMPLE_DOCS.length]!,
      printer: SAMPLE_PRINTERS[this.counter % SAMPLE_PRINTERS.length]!,
      pages: (this.counter % 5) + 1,
      detectedAt: Date.now(),
      ...partial,
    };
    this.onJob?.(job);
    return job;
  }
}

/** Renderiza el comprobante como texto; opcionalmente lo guarda en `outDir`. */
export class SimulatedReceiptPrinter implements ReceiptPrinter {
  readonly printed: string[] = [];

  constructor(private readonly outDir?: string) {}

  static render(doc: ReceiptDocument, width = 42): string {
    const line = '='.repeat(width);
    const center = (t: string) => t.padStart(Math.floor((width + t.length) / 2)).padEnd(width);
    const out = [line, center(doc.title)];
    if (doc.folio) out.push('', center(doc.folio));
    out.push(line, ...doc.lines, line);
    return out.join('\n');
  }

  async print(doc: ReceiptDocument): Promise<void> {
    const text = SimulatedReceiptPrinter.render(doc);
    this.printed.push(text);
    if (this.outDir) {
      await fs.mkdir(this.outDir, { recursive: true });
      await fs.writeFile(path.join(this.outDir, `receipt-${Date.now()}.txt`), text, 'utf8');
    }
  }
}

export class SimulatedCashDrawer implements CashDrawer {
  opened = 0;
  async open(): Promise<void> {
    this.opened += 1;
  }
}

export class SimulatedServiceHost implements ServiceHost {
  private installed = false;
  async install(): Promise<void> {
    this.installed = true;
  }
  async uninstall(): Promise<void> {
    this.installed = false;
  }
  async status(): Promise<ServiceStatus> {
    return { installed: this.installed, running: this.installed };
  }
}
