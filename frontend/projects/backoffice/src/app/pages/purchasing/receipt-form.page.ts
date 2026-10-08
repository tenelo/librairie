import { DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Depot,
  DeviceService,
  GoodsReceipt,
  NetworkStatusService,
  PurchaseOrder,
  PurchasingApiService,
  StockApiService,
  Supplier,
  apiErrorMessage,
  GoodsReceiptInput,
  OfflineDataService,
  OutboxService,
  SyncEngineService,
  defaultDepotId,
} from '@librairie/shared';
import { catchError, from, map } from 'rxjs';

import { EditableLine, LinesEditorComponent } from '../stock/lines-editor.component';

/** Lignes de réception préremplies avec le reliquat de chaque ligne du bon de commande. */
export function linesFromOrder(order: PurchaseOrder): EditableLine[] {
  return order.lines
    .filter((line) => (line.remaining ?? line.quantity) > 0)
    .map((line) => ({
      article: line.article,
      code: line.article_code ?? '',
      name: line.article_name ?? '',
      quantity: line.remaining ?? line.quantity,
      expected: line.remaining ?? line.quantity,
      unitCost: line.unit_cost,
      orderLine: line.id ?? null,
    }));
}

/**
 * Réception de marchandises, totale ou partielle, avec ou sans bon de commande.
 * L'identifiant est généré ici : un renvoi (double clic, réseau instable) ne crée pas de doublon.
 */
@Component({
  selector: 'bo-receipt-form-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, LinesEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <div>
        <a mat-button routerLink="/achats/receptions"><mat-icon>arrow_back</mat-icon> Réceptions</a>
        <h1>{{ receipt()?.number ?? 'Nouvelle réception' }}</h1>
      </div>
    </header>
    @if (receipt(); as r) {
      <mat-card appearance="outlined">
        <mat-card-content>
          <p><strong>{{ r.supplier_name }}</strong> → {{ r.depot_code }} · reçu le {{ r.received_at | date: 'dd/MM/yyyy HH:mm' }}
            par {{ r.user_name }}
            @if (r.purchase_order_number) { · commande {{ r.purchase_order_number }} }
            @if (r.delivery_note) { · BL {{ r.delivery_note }} }</p>
          @if (r.note) { <p>{{ r.note }}</p> }
          <bo-lines-editor [lines]="lines()" [showCost]="true" [readonly]="true" />
        </mat-card-content>
      </mat-card>
    } @else {
      <mat-card appearance="outlined">
        <mat-card-content>
          <form [formGroup]="form" class="form-grid">
            <mat-form-field>
              <mat-label>Fournisseur</mat-label>
              <mat-select formControlName="supplier" (selectionChange)="loadOpenOrders()">
                @for (s of suppliers(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Bon de commande</mat-label>
              <mat-select formControlName="purchase_order" (selectionChange)="useOrder($event.value)">
                <mat-option [value]="null">Sans commande</mat-option>
                @for (o of openOrders(); track o.id) { <mat-option [value]="o.id">{{ o.number }} ({{ o.status_label }})</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Dépôt</mat-label>
              <mat-select formControlName="depot">
                @for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>N° bon de livraison</mat-label>
              <input matInput formControlName="delivery_note" />
            </mat-form-field>
            <mat-form-field class="wide">
              <mat-label>Note</mat-label>
              <input matInput formControlName="note" placeholder="Colis abîmé, manquants…" />
            </mat-form-field>
          </form>
          <p class="muted">Saisissez les quantités réellement reçues ; scannez un article pour l'incrémenter.
            Le prix d'achat sert au calcul du CMP.</p>
          <bo-lines-editor [(lines)]="lines" [showCost]="true" [showExpected]="!!form.controls.purchase_order.value" />
        </mat-card-content>
      </mat-card>
      <div class="actions">
        <button mat-flat-button type="button" (click)="submit()" [disabled]="form.invalid || !hasQuantities() || busy()">
          <mat-icon>check</mat-icon> Valider la réception
        </button>
      </div>
    }
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class ReceiptFormPage implements OnInit {
  private readonly api = inject(PurchasingApiService);
  private readonly stockApi = inject(StockApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly snack = inject(MatSnackBar);
  private readonly device = inject(DeviceService).device;
  protected readonly network = inject(NetworkStatusService);
  private readonly offline = inject(OfflineDataService);
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncEngineService);

  readonly id = input<string | undefined>(undefined);

  protected readonly receipt = signal<GoodsReceipt | null>(null);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly openOrders = signal<PurchaseOrder[]>([]);
  protected readonly lines = signal<EditableLine[]>([]);
  protected readonly busy = signal(false);
  private readonly receiptId = crypto.randomUUID();

  protected readonly form = inject(FormBuilder).group({
    supplier: ['', Validators.required],
    purchase_order: [null as string | null],
    depot: ['', Validators.required],
    delivery_note: [''],
    note: [''],
  });

  ngOnInit(): void {
    const id = this.id();
    if (id) {
      this.api.getReceipt(id).subscribe((receipt) => {
        this.receipt.set(receipt);
        this.lines.set(receipt.lines.map((l) => ({ article: l.article, code: l.article_code ?? '', name: l.article_name ?? '',
          quantity: l.quantity, unitCost: l.unit_cost })));
      });
      return;
    }
    // Hors connexion, fournisseurs, dépôts et bons en attente viennent de la base locale.
    this.api.listSuppliers({ is_active: true }).pipe(map((page) => page.results),
      catchError(() => from(this.offline.table('suppliers')).pipe(map((rows) => rows as unknown as Supplier[]))))
      .subscribe((suppliers) => this.suppliers.set(suppliers.filter((s) => s.is_active)));
    this.stockApi.listDepots().pipe(
      catchError(() => from(this.offline.table('depots')).pipe(map((rows) => rows as unknown as Depot[]))),
    ).subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      if (!this.form.controls.depot.value) {
        this.form.patchValue({ depot: defaultDepotId(depots, this.device()?.depot) ?? '' });
      }
    });
    const orderId = this.route.snapshot.queryParamMap.get('commande');
    if (orderId) {
      this.api.getOrder(orderId).pipe(catchError(() => from(this.localOrders()).pipe(
        map((orders) => orders.find((o) => o.id === orderId) as PurchaseOrder)))).subscribe((order) => {
        if (!order) {
          return;
        }
        this.form.patchValue({ supplier: order.supplier, depot: order.depot });
        this.openOrders.set([order]);
        this.form.patchValue({ purchase_order: order.id });
        this.lines.set(linesFromOrder(order));
        this.loadOpenOrders(order.id);
      });
    }
  }

  private async localOrders(): Promise<PurchaseOrder[]> {
    return (await this.offline.table('purchase_orders')) as unknown as PurchaseOrder[];
  }

  protected loadOpenOrders(keep?: string): void {
    const supplier = this.form.controls.supplier.value;
    if (!supplier) {
      return;
    }
    this.api.listOrders({ supplier, open: true, page_size: 100 }).pipe(map((page) => page.results),
      catchError(() => from(this.localOrders()).pipe(map((orders) => orders.filter((o) => o.supplier === supplier)))),
    ).subscribe((orders) => {
      this.openOrders.set(orders);
      if (!keep) {
        this.form.patchValue({ purchase_order: null });
        this.lines.set([]);
      }
    });
  }

  protected useOrder(orderId: string | null): void {
    const order = this.openOrders().find((o) => o.id === orderId);
    this.lines.set(order ? linesFromOrder(order) : []);
    if (order) {
      this.form.patchValue({ depot: order.depot });
    }
  }

  protected hasQuantities(): boolean {
    return this.lines().some((line) => line.quantity > 0);
  }

  protected submit(): void {
    const value = this.form.getRawValue();
    const short = this.lines().filter((l) => l.expected !== undefined && l.quantity < l.expected);
    if (short.length && !confirm(`${short.length} ligne(s) reçue(s) partiellement : le reliquat restera attendu. Continuer ?`)) {
      return;
    }
    this.busy.set(true);
    const payload: GoodsReceiptInput = {
      id: this.receiptId,
      supplier: value.supplier ?? '',
      depot: value.depot ?? '',
      purchase_order: value.purchase_order,
      delivery_note: value.delivery_note ?? '',
      note: value.note ?? '',
      lines: this.lines().filter((l) => l.quantity > 0).map((l) => ({ article: l.article, order_line: l.orderLine ?? null,
        quantity: l.quantity, unit_cost: l.unitCost })),
    };
    if (!this.network.online()) {
      void this.saveOffline(payload);
      return;
    }
    this.api
      .createReceipt(payload)
      .subscribe({
        next: (receipt) => {
          this.busy.set(false);
          this.snack.open(`Réception ${receipt.number} enregistrée : stock et CMP mis à jour.`);
          void this.router.navigate(['/achats/receptions', receipt.id], { replaceUrl: true });
        },
        error: (err: unknown) => {
          this.busy.set(false);
          if (err instanceof HttpErrorResponse && err.status === 0) {
            void this.saveOffline(payload);
            return;
          }
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
        },
      });
  }

  /** Réception hors ligne : écrite dans l'outbox (le stock affiché en tient compte) puis envoyée au retour du réseau. */
  private async saveOffline(payload: GoodsReceiptInput): Promise<void> {
    const deltas = (await Promise.all(payload.lines.map((line) =>
      this.offline.stockDeltas(line.article, payload.depot, line.quantity)))).flat();
    const supplier = this.suppliers().find((s) => s.id === payload.supplier)?.name ?? '';
    await this.outbox.enqueue('goods_receipt', 'create', { ...payload }, {
      stockDeltas: deltas, label: `Réception ${supplier} (${payload.lines.length} ligne(s))`,
    });
    await this.sync.refreshCounts();
    void this.sync.requestBackgroundSync();
    this.busy.set(false);
    this.snack.open('Hors ligne : réception enregistrée sur ce terminal, elle sera envoyée au retour du réseau.', 'OK',
      { duration: 8000 });
    void this.router.navigate(['/achats/receptions']);
  }
}
