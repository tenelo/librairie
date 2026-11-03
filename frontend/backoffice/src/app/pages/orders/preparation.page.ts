import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import {
  ArticleLookup,
  LocalDbService,
  NetworkStatusService,
  OutboxService,
  SyncEngineService,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { ArticlePickerComponent } from '../catalog/article-picker.component';
import { OrdersApiService } from './orders-api.service';
import { PrepLine, Shortage, applyScan, readiness, sortByLocation, target } from './preparation';

interface SavedProgress {
  prepared: Record<string, number>;
  shortages: Record<string, Shortage>;
  parcels: number;
}

/**
 * Préparation d'une commande par scan, utilisable hors connexion une fois la commande téléchargée
 * (base locale) : la progression est conservée sur le terminal et envoyée par la file de synchronisation.
 */
@Component({
  selector: 'bo-preparation-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, ArticlePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Préparation {{ number() }}</h1>
      <a mat-button [routerLink]="['/commandes/detail', id()]"><mat-icon>arrow_back</mat-icon> Fiche commande</a>
    </header>
    @if (!network.online()) { <p class="offline-note">Hors ligne : la préparation est enregistrée sur ce terminal et envoyée au retour du réseau.</p> }
    @if (customer()) { <p>Client : <strong>{{ customer() }}</strong>@if (comment()) { · « {{ comment() }} » }</p> }
    @if (lines().length) {
      <div class="scan card">
        <mat-icon>qr_code_scanner</mat-icon>
        <input #scanBox type="text" placeholder="Scanner un article (ou saisir son code puis Entrée)" aria-label="Scanner un article"
               [(ngModel)]="code" (keydown.enter)="scan()" autocomplete="off" />
        <span class="progress">{{ preparedCount() }} / {{ totalCount() }}</span>
      </div>
      @if (lastError()) { <p class="error" role="alert">{{ lastError() }}</p> }
      <table class="list">
        <thead><tr><th>Empl.</th><th>Article</th><th class="num">À préparer</th><th class="num">Préparé</th><th></th></tr></thead>
        <tbody>
          @for (l of lines(); track l.id) {
            <tr [class.done]="doneOf(l) >= targetOf(l)" [class.flash]="flash() === l.id">
              <td>{{ l.location || '—' }}</td>
              <td>{{ l.name }} <small class="muted">{{ l.code }}</small>
                @if (shortages()[l.id]; as s) {
                  <br /><small class="error">Rupture : {{ s.quantity }} disponible(s) sur {{ l.quantity }}@if (s.substitute) { · remplacement proposé : {{ s.substitute.name }} }
                    <button mat-button type="button" (click)="clearShortage(l)">Annuler</button></small>
                }
                @if (editing() === l.id) {
                  <div class="shortage">
                    <label>Disponible <input type="number" min="0" [max]="l.quantity - 1" [(ngModel)]="shortQty" /></label>
                    @if (substitute(); as sub) { <span>Remplacé par {{ sub.name }} <button mat-button type="button" (click)="substitute.set(null)">Retirer</button></span> }
                    @else { <bo-article-picker label="Article de remplacement (facultatif)" (picked)="substitute.set($event)" /> }
                    <button mat-flat-button type="button" (click)="saveShortage(l)">Valider la rupture</button>
                    <button mat-button type="button" (click)="editing.set(null)">Fermer</button>
                  </div>
                }
              </td>
              <td class="num">{{ targetOf(l) }}@if (shortages()[l.id]) { <small class="muted"> / {{ l.quantity }}</small> }</td>
              <td class="num"><strong>{{ doneOf(l) }}</strong></td>
              <td class="actions">
                <button mat-icon-button type="button" (click)="step(l, -1)" aria-label="Retirer un"><mat-icon>remove</mat-icon></button>
                <button mat-icon-button type="button" (click)="step(l, 1)" aria-label="Ajouter un"><mat-icon>add</mat-icon></button>
                <button mat-button type="button" (click)="openShortage(l)">Rupture</button>
              </td>
            </tr>
          }
        </tbody>
      </table>
      <div class="toolbar">
        <label>Nombre de colis <input type="number" min="1" max="99" [ngModel]="parcels()" (ngModelChange)="setParcels($event)" /></label>
        <button mat-stroked-button type="button" (click)="submit(false)" [disabled]="busy()">Enregistrer la progression</button>
        <button mat-flat-button type="button" (click)="submit(true)" [disabled]="busy() || !ready().complete">
          <mat-icon>inventory</mat-icon> {{ hasShortage() ? 'Soumettre (ruptures)' : 'Commande prête' }}
        </button>
      </div>
      @if (!ready().complete) { <p class="muted">Reste à préparer : {{ ready().missing.join(', ') }}</p> }
    } @else {
      <p>{{ loadError() ?? 'Chargement…' }}</p>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .scan { display: flex; align-items: center; gap: 12px; padding: 12px; margin-bottom: 12px; }
    .scan input { flex: 1; font-size: 18px; padding: 8px; }
    .progress { font-size: 20px; font-weight: 600; }
    tr.done td { background: color-mix(in srgb, #2e7d32 10%, transparent); }
    tr.flash td { outline: 2px solid var(--mat-sys-primary); }
    .actions { white-space: nowrap; }
    .shortage { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
    .shortage input, .toolbar input { width: 64px; }
  `,
})
export class PreparationPage implements OnInit {
  readonly id = input.required<string>();
  private readonly api = inject(OrdersApiService);
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncEngineService);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  protected readonly network = inject(NetworkStatusService);
  private readonly scanBox = viewChild<ElementRef<HTMLInputElement>>('scanBox');

  protected readonly lines = signal<PrepLine[]>([]);
  protected readonly number = signal('');
  protected readonly customer = signal('');
  protected readonly comment = signal('');
  protected readonly prepared = signal<Record<string, number>>({});
  protected readonly shortages = signal<Record<string, Shortage>>({});
  protected readonly parcels = signal(1);
  protected readonly editing = signal<string | null>(null);
  protected readonly substitute = signal<ArticleLookup | null>(null);
  protected readonly lastError = signal<string | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly flash = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly ready = computed(() => readiness(this.lines(), this.prepared(), this.shortages()));
  protected readonly hasShortage = computed(() => Object.keys(this.shortages()).length > 0);
  protected readonly totalCount = computed(() => this.lines().reduce((s, l) => s + target(l, this.shortages()), 0));
  protected readonly preparedCount = computed(() => Object.values(this.prepared()).reduce((s, n) => s + n, 0));
  protected code = '';
  protected shortQty = 0;

  async ngOnInit(): Promise<void> {
    const saved = await this.local.getMeta<SavedProgress | null>(this.key(), null);
    let serverPrepared: Record<string, number> = {};
    try {
      if (!this.network.online()) {
        throw new Error('offline');
      }
      let picking = await firstValueFrom(this.api.picking(this.id()));
      if (picking.order.status === 'CONFIRMED') {
        await firstValueFrom(this.api.start(this.id()));
        picking = await firstValueFrom(this.api.picking(this.id()));
      }
      if (!['CONFIRMED', 'PREPARING'].includes(picking.order.status) || picking.order.awaiting_customer) {
        this.loadError.set(`Commande ${picking.order.number} : ${picking.order.status_label}`
          + (picking.order.awaiting_customer ? ' (en attente de la réponse du client).' : ', préparation impossible.'));
        return;
      }
      this.number.set(picking.order.number);
      this.customer.set(`${picking.order.customer_name} · ${picking.order.customer_phone}`);
      this.comment.set(picking.order.comment);
      this.parcels.set(picking.order.parcels ?? 1);
      this.lines.set(picking.lines.map((p) => ({ id: p.line, article: p.article, code: p.code, name: p.name,
        quantity: p.quantity, location: p.location, barcodes: p.barcodes })));
      serverPrepared = Object.fromEntries(picking.lines.map((p) => [p.line, p.prepared_qty]));
    } catch {
      const row = await this.local.db.online_orders.get(this.id());
      if (!row || row.is_deleted) {
        this.loadError.set('Commande non disponible hors ligne : synchronisez le terminal quand le réseau revient.');
        return;
      }
      this.number.set(String(row['number']));
      this.customer.set(`${row['customer_name']} · ${row['customer_phone']}`);
      this.comment.set(String(row['comment'] ?? ''));
      const lines = row['lines'] as { id: string; article: string; code: string; description: string; quantity: number;
        prepared_qty: number; barcodes: string[] }[];
      this.lines.set(sortByLocation(lines.map((l) => ({ id: l.id, article: l.article, code: l.code, name: l.description,
        quantity: l.quantity, location: '', barcodes: l.barcodes ?? [] }))));
      serverPrepared = Object.fromEntries(lines.map((l) => [l.id, l.prepared_qty]));
    }
    this.prepared.set(saved?.prepared ?? serverPrepared);
    this.shortages.set(saved?.shortages ?? {});
    if (saved?.parcels) {
      this.parcels.set(saved.parcels);
    }
    setTimeout(() => this.scanBox()?.nativeElement.focus(), 50);
  }

  protected doneOf(line: PrepLine): number {
    return this.prepared()[line.id] || 0;
  }

  protected targetOf(line: PrepLine): number {
    return target(line, this.shortages());
  }

  protected scan(): void {
    const result = applyScan(this.lines(), this.prepared(), this.shortages(), this.code);
    this.code = '';
    if (!result.ok) {
      this.lastError.set(result.error);
      beep(220);
      return;
    }
    this.lastError.set(null);
    this.prepared.update((p) => ({ ...p, [result.line.id]: result.prepared }));
    this.flash.set(result.line.id);
    beep(880);
    void this.persist();
  }

  protected step(line: PrepLine, delta: number): void {
    const value = Math.min(Math.max((this.prepared()[line.id] ?? 0) + delta, 0), this.targetOf(line));
    this.prepared.update((p) => ({ ...p, [line.id]: value }));
    void this.persist();
  }

  protected openShortage(line: PrepLine): void {
    this.editing.set(line.id);
    this.shortQty = Math.min(this.prepared()[line.id] ?? 0, line.quantity - 1);
    this.substitute.set(null);
  }

  protected saveShortage(line: PrepLine): void {
    const quantity = Math.trunc(Number(this.shortQty));
    if (!(quantity >= 0 && quantity < line.quantity)) {
      this.snack.open(`La quantité disponible doit être comprise entre 0 et ${line.quantity - 1}.`, 'Fermer');
      return;
    }
    const sub = this.substitute();
    this.shortages.update((s) => ({ ...s, [line.id]: { quantity, substitute: sub ? { id: sub.id, name: sub.name } : null } }));
    this.prepared.update((p) => ({ ...p, [line.id]: Math.min(p[line.id] ?? 0, quantity) }));
    this.editing.set(null);
    void this.persist();
  }

  protected clearShortage(line: PrepLine): void {
    this.shortages.update((s) => {
      const { [line.id]: _removed, ...rest } = s;
      return rest;
    });
    void this.persist();
  }

  protected setParcels(value: number): void {
    this.parcels.set(Math.min(Math.max(Math.trunc(Number(value) || 1), 1), 99));
    void this.persist();
  }

  protected async submit(ready: boolean): Promise<void> {
    if (ready && !this.ready().complete) {
      return;
    }
    this.busy.set(true);
    const payload = {
      order: this.id(),
      lines: this.lines().map((l) => ({ line: l.id, prepared_qty: this.prepared()[l.id] ?? 0 })),
      shortages: Object.entries(this.shortages()).map(([line, s]) => ({ line, quantity: s.quantity,
        substitute: s.substitute?.id ?? null })),
      ready, parcels: this.parcels(),
    };
    await this.outbox.enqueue('online_order', 'prepare', payload,
      { label: `Préparation ${this.number()}${ready ? ' (prête)' : ''}` });
    await this.local.setMeta(this.key(), null);
    await this.sync.refreshCounts();
    if (this.network.online()) {
      await this.sync.syncNow();
    } else {
      void this.sync.requestBackgroundSync();
    }
    this.busy.set(false);
    this.snack.open(ready
      ? (this.hasShortage() ? 'Ruptures envoyées : le client est sollicité si nécessaire.' : `Commande ${this.number()} prête.`)
      : 'Progression enregistrée.');
    if (ready) {
      void this.router.navigate(this.network.online() ? ['/commandes/detail', this.id()] : ['/commandes/a-preparer']);
    }
  }

  private key(): string {
    return `prep-${this.id()}`;
  }

  private persist(): Promise<void> {
    return this.local.setMeta(this.key(), { prepared: this.prepared(), shortages: this.shortages(),
      parcels: this.parcels() } satisfies SavedProgress);
  }
}

/** Signal sonore court (scan accepté : aigu ; refusé : grave). */
function beep(frequency: number): void {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    oscillator.frequency.value = frequency;
    oscillator.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => void context.close();
  } catch {
    // Audio indisponible : l'alerte visuelle suffit.
  }
  if (frequency < 400) {
    navigator.vibrate?.(200);
  }
}
