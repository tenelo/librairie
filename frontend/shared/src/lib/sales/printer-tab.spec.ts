import { ApplicationRef, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BrowserPrinter } from './printer.service';
import { ReceiptData } from './receipt.models';

const RECEIPT: ReceiptData = {
  title: 'Versement — Tontine scolaire', number: 'TS-2026-00007-V02', date: '2026-11-03T17:52:00Z',
  cashier: 'Administrateur', device: '', customer: 'Bamba Seydou', lines: [], subtotal: 27530, discountTotal: 0,
  total: 27530, payments: [{ label: 'Espèces', amount: 27530 }], change: 0, loyaltyPoints: null, duplicate: false,
  extra: [{ label: 'Reste à verser', value: '0 FCFA' }], qrValue: null,
  library: { name: 'Ma Librairie', logo: null, address: '', city: 'Ferké', phone: '', email: '', taxpayer_number: '',
    trade_register: '', receipt_header: '', receipt_footer: '' },
};

describe('impression des reçus dans un onglet', () => {
  let printer: BrowserPrinter;

  beforeEach(() => {
    printer = new BrowserPrinter(TestBed.inject(ApplicationRef), TestBed.inject(EnvironmentInjector));
  });

  it("ouvre le reçu dans un nouvel onglet, avec Imprimer et Fermer, sans toucher à l'application", async () => {
    const tab = document.implementation.createHTMLDocument('');
    const fakeTab = { document: tab, print: jasmine.createSpy('print'), close: jasmine.createSpy('close'),
      focus: () => undefined } as unknown as Window;
    spyOn(window, 'open').and.returnValue(fakeTab);
    const pagePrint = spyOn(window, 'print');

    await printer.print(RECEIPT, 'THERMAL_80');

    expect(tab.body.textContent).toContain('Bamba Seydou');
    expect(tab.body.textContent).toContain('TS-2026-00007-V02');
    expect(fakeTab.print).toHaveBeenCalled();
    expect(pagePrint).not.toHaveBeenCalled();
    (tab.getElementById('receipt-close') as HTMLButtonElement).click();
    expect(fakeTab.close).toHaveBeenCalled();
    expect(document.querySelector('.receipt-tab-host')).toBeNull();
  });

  it("recopie dans l'onglet la mise en forme du reçu (styles du composant)", async () => {
    const tab = document.implementation.createHTMLDocument('');
    const fakeTab = { document: tab, print: () => undefined, close: () => undefined,
      focus: () => undefined } as unknown as Window;
    spyOn(window, 'open').and.returnValue(fakeTab);

    await printer.print(RECEIPT, 'THERMAL_80');

    const css = [...tab.querySelectorAll('style')].map((node) => node.textContent ?? '').join('\n');
    expect(css).toContain('Roboto Mono');
    expect(css).toContain('80mm');
  });

  it("imprime depuis la page si l'onglet est bloqué par le navigateur", async () => {
    spyOn(window, 'open').and.returnValue(null);
    const pagePrint = spyOn(window, 'print');
    await printer.print(RECEIPT, 'THERMAL_80');
    expect(pagePrint).toHaveBeenCalled();
    expect(document.body.classList.contains('receipt-printing')).toBeFalse();
  });
});
