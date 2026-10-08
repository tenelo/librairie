import { ApplicationRef, EnvironmentInjector, Injectable, createComponent, inject, signal } from '@angular/core';

import { ReceiptComponent } from './receipt.component';
import { ReceiptData, ReceiptFormat } from './receipt.models';

/** Imprimante : couche d'abstraction (navigateur, ESC/POS via Web Serial, et plus tard WebUSB). */
export interface ReceiptPrinter {
  readonly name: string;
  print(receipt: ReceiptData, format: ReceiptFormat): Promise<void>;
}

const PAGE_SIZES: Record<ReceiptFormat, string> = {
  THERMAL_58: '58mm auto',
  THERMAL_80: '80mm auto',
  A5: 'A5 portrait',
  A4: 'A4 portrait',
};

/** Impression par la boîte de dialogue du navigateur (fonctionne hors ligne, toute imprimante). */
export class BrowserPrinter implements ReceiptPrinter {
  readonly name = 'Navigateur';

  constructor(private readonly appRef: ApplicationRef, private readonly injector: EnvironmentInjector) {}

  async print(receipt: ReceiptData, format: ReceiptFormat): Promise<void> {
    const host = document.createElement('div');
    host.className = 'receipt-print-host';
    document.body.appendChild(host);
    const ref = createComponent(ReceiptComponent, { environmentInjector: this.injector, hostElement: host });
    ref.setInput('receipt', receipt);
    ref.setInput('format', format);
    this.appRef.attachView(ref.hostView);
    ref.changeDetectorRef.detectChanges();
    const style = document.createElement('style');
    style.textContent = `@page { size: ${PAGE_SIZES[format]}; margin: ${format.startsWith('THERMAL') ? '0' : '8mm'}; }`;
    document.head.appendChild(style);
    document.body.classList.add('receipt-printing');
    // Laisse le temps au QR code (SVG) et au logo de se dessiner.
    await new Promise((resolve) => setTimeout(resolve, 150));
    try {
      window.print();
    } finally {
      document.body.classList.remove('receipt-printing');
      style.remove();
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      host.remove();
    }
  }
}

/** Retire les accents (les imprimantes thermiques n'ont pas toutes une table de caractères accentués). */
export function toPrinterText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’‘]/g, "'").replace(/[^\x20-\x7e]/g, ' ');
}

function padLine(left: string, right: string, width: number): string {
  const l = toPrinterText(left);
  const r = toPrinterText(right);
  const space = Math.max(1, width - l.length - r.length);
  return (l + ' '.repeat(space) + r).slice(0, Math.max(width, r.length + 1));
}

function amount(value: number): string {
  return `${new Intl.NumberFormat('fr-FR').format(Math.round(value)).replace(/\s/g, ' ')} F`;
}

/** Encode un reçu en commandes ESC/POS (texte, gras, centrage, QR code, coupe). */
export function encodeEscPos(receipt: ReceiptData, format: ReceiptFormat): Uint8Array {
  const width = format === 'THERMAL_58' ? 32 : 48;
  const bytes: number[] = [];
  const raw = (...values: number[]) => bytes.push(...values);
  const text = (value: string) => {
    for (const char of toPrinterText(value)) {
      bytes.push(char.charCodeAt(0));
    }
    bytes.push(0x0a);
  };
  const align = (mode: 0 | 1) => raw(0x1b, 0x61, mode);
  const bold = (on: boolean) => raw(0x1b, 0x45, on ? 1 : 0);
  const rule = () => text('-'.repeat(width));

  raw(0x1b, 0x40); // initialisation
  align(1);
  if (receipt.duplicate) {
    bold(true);
    text('*** DUPLICATA ***');
    bold(false);
  }
  bold(true);
  text(receipt.library.name);
  bold(false);
  [`${receipt.library.address} ${receipt.library.city}`.trim(), receipt.library.phone && `Tel. ${receipt.library.phone}`,
    receipt.library.taxpayer_number && `NCC : ${receipt.library.taxpayer_number}`, receipt.library.receipt_header]
    .filter(Boolean).forEach((line) => text(String(line)));
  align(0);
  rule();
  text(`${receipt.title} ${receipt.number}`);
  text(new Date(receipt.date).toLocaleString('fr-CI', { timeZone: 'Africa/Abidjan' }));
  text(`Caissier : ${receipt.cashier} - ${receipt.device}`);
  if (receipt.customer) {
    text(`Client : ${receipt.customer}`);
  }
  rule();
  for (const line of receipt.lines) {
    text(line.name.slice(0, width));
    line.details.forEach((detail) => text(`  ${detail}`.slice(0, width)));
    text(padLine(`  ${line.quantity} x ${amount(line.unitPrice)}`, amount(line.total), width));
  }
  rule();
  if (receipt.discountTotal) {
    text(padLine('Remises', `-${amount(receipt.discountTotal)}`, width));
  }
  bold(true);
  raw(0x1d, 0x21, 0x01); // double hauteur
  text(padLine('TOTAL', amount(receipt.total), width));
  raw(0x1d, 0x21, 0x00);
  bold(false);
  receipt.payments.forEach((p) => text(padLine(p.label, amount(p.amount), width)));
  if (receipt.change) {
    text(padLine('Monnaie rendue', amount(receipt.change), width));
  }
  receipt.extra.forEach((e) => text(padLine(e.label, e.value, width)));
  if (receipt.qrValue) {
    const data = Array.from(new TextEncoder().encode(receipt.qrValue));
    const length = data.length + 3;
    align(1);
    raw(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00); // modèle 2
    raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05); // taille du module
    raw(0x1d, 0x28, 0x6b, length & 0xff, length >> 8, 0x31, 0x50, 0x30, ...data);
    raw(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30); // impression
    raw(0x0a);
  }
  if (receipt.library.receipt_footer) {
    align(1);
    text(receipt.library.receipt_footer);
  }
  raw(0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x42, 0x00); // avance et coupe partielle
  return new Uint8Array(bytes);
}

interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  writable: WritableStream<Uint8Array> | null;
}

interface SerialLike {
  requestPort(): Promise<SerialPortLike>;
  getPorts(): Promise<SerialPortLike[]>;
}

/** Impression ESC/POS directe sur imprimante thermique USB/série (Chrome et Edge via Web Serial). */
export class WebSerialEscPosPrinter implements ReceiptPrinter {
  readonly name = 'Imprimante thermique (Web Serial)';

  constructor(private readonly port: SerialPortLike, private readonly baudRate = 9600) {}

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  async print(receipt: ReceiptData, format: ReceiptFormat): Promise<void> {
    await this.port.open({ baudRate: this.baudRate });
    try {
      const writer = this.port.writable?.getWriter();
      if (!writer) {
        throw new Error('Port série indisponible.');
      }
      await writer.write(encodeEscPos(receipt, format));
      writer.releaseLock();
    } finally {
      await this.port.close();
    }
  }
}

const FORMAT_KEY = 'librairie.receiptFormat';
const SERIAL_KEY = 'librairie.useSerialPrinter';

/** Choix de l'imprimante et du format de reçu de ce terminal. */
@Injectable({ providedIn: 'root' })
export class PrinterService {
  private readonly browser = new BrowserPrinter(inject(ApplicationRef), inject(EnvironmentInjector));
  private serial: WebSerialEscPosPrinter | null = null;

  readonly format = signal<ReceiptFormat>((localStorage.getItem(FORMAT_KEY) as ReceiptFormat) || 'THERMAL_80');
  readonly useSerial = signal(localStorage.getItem(SERIAL_KEY) === '1');
  readonly serialSupported = WebSerialEscPosPrinter.supported;

  setFormat(format: ReceiptFormat): void {
    localStorage.setItem(FORMAT_KEY, format);
    this.format.set(format);
  }

  /** Associe une imprimante thermique (doit être appelé depuis un clic : autorisation du navigateur). */
  async connectSerial(): Promise<void> {
    const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
    if (!serial) {
      throw new Error('Web Serial non disponible sur ce navigateur.');
    }
    this.serial = new WebSerialEscPosPrinter(await serial.requestPort());
    localStorage.setItem(SERIAL_KEY, '1');
    this.useSerial.set(true);
  }

  disconnectSerial(): void {
    this.serial = null;
    localStorage.removeItem(SERIAL_KEY);
    this.useSerial.set(false);
  }

  async print(receipt: ReceiptData, format: ReceiptFormat = this.format()): Promise<void> {
    if (this.useSerial() && format.startsWith('THERMAL')) {
      const printer = await this.serialPrinter();
      if (printer) {
        await printer.print(receipt, format);
        return;
      }
    }
    await this.browser.print(receipt, format);
  }

  private async serialPrinter(): Promise<WebSerialEscPosPrinter | null> {
    if (this.serial) {
      return this.serial;
    }
    const serial = (navigator as Navigator & { serial?: SerialLike }).serial;
    const [port] = (await serial?.getPorts()) ?? [];
    this.serial = port ? new WebSerialEscPosPrinter(port) : null;
    return this.serial;
  }
}
