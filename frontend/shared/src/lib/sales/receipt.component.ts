import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { QRCodeComponent } from 'angularx-qrcode';

import { FcfaPipe } from '../format/fcfa.pipe';
import { ReceiptData, ReceiptFormat } from './receipt.models';

/**
 * Reçu imprimable : ticket thermique 58 / 80 mm ou facture A5 / A4.
 * Entièrement généré dans le navigateur (logo, QR code) : imprimable hors connexion.
 */
@Component({
  selector: 'lib-receipt',
  imports: [DatePipe, FcfaPipe, QRCodeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let r = receipt();
    <article class="receipt" [class]="'receipt ' + format()">
      @if (r.duplicate) {
        <div class="duplicate">DUPLICATA</div>
      }
      <header>
        @if (r.library.logo) {
          <img class="logo" [src]="r.library.logo" alt="" />
        }
        <div class="name">{{ r.library.name }}</div>
        <div>{{ r.library.address }} {{ r.library.city }}</div>
        @if (r.library.phone) { <div>Tél. {{ r.library.phone }}</div> }
        @if (r.library.email) { <div>{{ r.library.email }}</div> }
        @if (r.library.taxpayer_number) { <div>NCC : {{ r.library.taxpayer_number }}</div> }
        @if (r.library.trade_register) { <div>RCCM : {{ r.library.trade_register }}</div> }
        @if (r.library.receipt_header) { <div class="free">{{ r.library.receipt_header }}</div> }
      </header>
      <section class="meta">
        <div class="title">{{ r.title }} {{ r.number }}</div>
        <div>{{ r.date | date: 'dd/MM/yyyy HH:mm' }}</div>
        <div>Caissier : {{ r.cashier }} · Terminal {{ r.device }}</div>
        @if (r.customer) { <div>Client : {{ r.customer }}</div> }
      </section>
      @if (r.lines.length) {
        <table class="lines">
          @if (isInvoice()) {
            <thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">P.U.</th><th class="num">Montant</th></tr></thead>
          }
          <tbody>
            @for (line of r.lines; track $index) {
              @if (isInvoice()) {
                <tr>
                  <td>{{ line.name }}
                    @for (d of line.details; track $index) { <div class="detail">{{ d }}</div> }
                    @if (line.discount) { <div class="detail">Remise −{{ line.discount | fcfa }}</div> }
                  </td>
                  <td class="num">{{ line.quantity }}</td>
                  <td class="num">{{ line.unitPrice | fcfa }}</td>
                  <td class="num">{{ line.total | fcfa }}</td>
                </tr>
              } @else {
                <tr><td colspan="2">{{ line.name }}</td></tr>
                @for (d of line.details; track $index) { <tr><td colspan="2" class="detail">{{ d }}</td></tr> }
                <tr>
                  <td class="qty">{{ line.quantity }} × {{ line.unitPrice | fcfa }}
                    @if (line.discount) { (−{{ line.discount | fcfa }}) }</td>
                  <td class="num">{{ line.total | fcfa }}</td>
                </tr>
              }
            }
          </tbody>
        </table>
      }
      <section class="totals">
        @if (r.discountTotal) {
          <div><span>Sous-total</span><span>{{ r.subtotal | fcfa }}</span></div>
          <div><span>Remises</span><span>−{{ r.discountTotal | fcfa }}</span></div>
        }
        <div class="grand"><span>TOTAL</span><span>{{ r.total | fcfa }}</span></div>
        @for (p of r.payments; track $index) {
          <div><span>{{ p.label }}@if (p.reference) { ({{ p.reference }}) }</span><span>{{ p.amount | fcfa }}</span></div>
        }
        @if (r.change) {
          <div><span>Monnaie rendue</span><span>{{ r.change | fcfa }}</span></div>
        }
        @for (e of r.extra; track $index) {
          <div><span>{{ e.label }}</span><span>{{ e.value }}</span></div>
        }
        @if (r.loyaltyPoints) {
          <div><span>Points de fidélité gagnés</span><span>{{ r.loyaltyPoints }}</span></div>
        }
      </section>
      @if (r.qrValue) {
        <div class="qr">
          <qrcode [qrdata]="r.qrValue" [width]="isInvoice() ? 110 : 96" [margin]="0" errorCorrectionLevel="M" elementType="svg" />
        </div>
      }
      @if (r.library.receipt_footer) {
        <footer>{{ r.library.receipt_footer }}</footer>
      }
    </article>
  `,
  styles: `
    :host {
      display: block;
      color: #000;
      background: #fff;
    }
    .receipt {
      font-family: 'Roboto Mono', Consolas, 'Courier New', monospace;
      font-size: 11px;
      line-height: 1.35;
      position: relative;
      margin: 0 auto;
      padding: 2mm;
      box-sizing: border-box;
    }
    .THERMAL_58 { width: 58mm; font-size: 10px; }
    .THERMAL_80 { width: 80mm; }
    .A5 { width: 148mm; font-family: Roboto, Arial, sans-serif; font-size: 11px; padding: 8mm; }
    .A4 { width: 210mm; font-family: Roboto, Arial, sans-serif; font-size: 12px; padding: 12mm; }
    header { text-align: center; margin-bottom: 6px; }
    .A5 header, .A4 header { text-align: left; }
    .logo { max-height: 48px; max-width: 70%; }
    .name { font-size: 1.35em; font-weight: 700; }
    .free { white-space: pre-line; margin-top: 4px; }
    .meta { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; margin-bottom: 4px; }
    .title { font-weight: 700; }
    .lines { width: 100%; border-collapse: collapse; }
    .lines td, .lines th { padding: 1px 0; vertical-align: top; }
    .A5 .lines th, .A4 .lines th { border-bottom: 1px solid #000; text-align: left; }
    .A5 .lines td, .A4 .lines td { border-bottom: 1px solid #ddd; padding: 3px 2px; }
    .num { text-align: right; white-space: nowrap; }
    .detail { font-size: 0.9em; padding-left: 8px; }
    .qty { padding-left: 8px !important; }
    .totals { border-top: 1px dashed #000; margin-top: 4px; padding-top: 4px; }
    .totals div { display: flex; justify-content: space-between; gap: 8px; }
    .grand { font-size: 1.3em; font-weight: 700; }
    .qr { display: flex; justify-content: center; margin: 6px 0; }
    footer { text-align: center; white-space: pre-line; border-top: 1px dashed #000; padding-top: 4px; }
    .duplicate { text-align: center; font-weight: 700; font-size: 1.4em; border: 2px solid #000; margin-bottom: 4px; }
  `,
})
export class ReceiptComponent {
  readonly receipt = input.required<ReceiptData>();
  readonly format = input<ReceiptFormat>('THERMAL_80');

  protected isInvoice(): boolean {
    return this.format() === 'A4' || this.format() === 'A5';
  }
}
