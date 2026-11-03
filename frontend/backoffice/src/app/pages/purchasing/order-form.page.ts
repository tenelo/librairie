import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  Depot,
  DeviceService,
  NetworkStatusService,
  PurchaseOrder,
  PurchasingApiService,
  StockApiService,
  Supplier,
  apiErrorMessage,
  defaultDepotId,
  saveBlob,
} from '@librairie/shared';

import { EditableLine, LinesEditorComponent } from '../stock/lines-editor.component';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Bon de commande fournisseur : brouillon modifiable, envoi, annulation, solde, PDF et impression. */
@Component({
  selector: 'bo-order-form-page',
  imports: [ReactiveFormsModule, RouterLink, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, LinesEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <div>
        <a mat-button routerLink="/achats/bons-de-commande"><mat-icon>arrow_back</mat-icon> Bons de commande</a>
        <h1>{{ order()?.number ?? 'Nouveau bon de commande' }}
          @if (order(); as o) { <small class="muted">· {{ o.status_label }}</small> }</h1>
      </div>
      @if (order(); as o) {
        <div class="actions">
          <button mat-stroked-button type="button" (click)="printDocument()"><mat-icon>print</mat-icon> Imprimer</button>
          <button mat-stroked-button type="button" (click)="downloadPdf()" [disabled]="!network.online()"><mat-icon>picture_as_pdf</mat-icon> PDF</button>
          @if (canManage) {
            @if (o.status === 'DRAFT') {
              <button mat-stroked-button type="button" (click)="act('cancel')">Annuler</button>
              <button mat-flat-button type="button" (click)="act('send')" [disabled]="form.dirty"><mat-icon>send</mat-icon> Marquer envoyé</button>
            }
            @if (o.status === 'SENT') {
              <button mat-stroked-button type="button" (click)="act('cancel')">Annuler</button>
            }
            @if (o.status === 'PARTIAL') {
              <button mat-stroked-button type="button" (click)="act('close')">Solder (reliquat abandonné)</button>
            }
          }
          @if (canReceive && (o.status === 'SENT' || o.status === 'PARTIAL')) {
            <a mat-flat-button [routerLink]="['/achats/receptions/nouvelle']" [queryParams]="{ commande: o.id }">
              <mat-icon>inventory</mat-icon> Réceptionner</a>
          }
        </div>
      }
    </header>

    <mat-card appearance="outlined">
      <mat-card-content>
        <form [formGroup]="form" class="form-grid">
          <mat-form-field>
            <mat-label>Fournisseur</mat-label>
            <mat-select formControlName="supplier">
              @for (s of suppliers(); track s.id) { <mat-option [value]="s.id">{{ s.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Dépôt de livraison</mat-label>
            <mat-select formControlName="depot">
              @for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
            </mat-select>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Date de commande</mat-label>
            <input matInput type="date" formControlName="order_date" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Livraison prévue</mat-label>
            <input matInput type="date" formControlName="expected_date" />
          </mat-form-field>
          <mat-form-field class="wide">
            <mat-label>Note</mat-label>
            <textarea matInput rows="2" formControlName="note"></textarea>
          </mat-form-field>
        </form>
        <bo-lines-editor [lines]="lines()" (linesChange)="setLines($event)" [showCost]="true" [readonly]="!editable()" />
        @if (order(); as o) {
          @if (o.status !== 'DRAFT') {
            <h3>Suivi des réceptions</h3>
            <ul>
              @for (l of o.lines; track l.article) {
                <li>{{ l.article_name }} : {{ l.received_quantity }} / {{ l.quantity }} reçu(s)
                  @if (l.remaining) { — <strong>reste {{ l.remaining }}</strong> }</li>
              }
            </ul>
          }
        }
      </mat-card-content>
    </mat-card>
    @if (editable()) {
      <div class="actions">
        <button mat-flat-button type="button" (click)="save()" [disabled]="form.invalid || !lines().length || busy() || !network.online()">
          Enregistrer le brouillon
        </button>
      </div>
    }
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class OrderFormPage implements OnInit {
  private readonly api = inject(PurchasingApiService);
  private readonly stockApi = inject(StockApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly device = inject(DeviceService).device;
  private readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = this.auth.hasPermission('purchasing.manage');
  protected readonly canReceive = this.auth.hasPermission('purchasing.receive');

  readonly id = input<string | undefined>(undefined);

  protected readonly order = signal<PurchaseOrder | null>(null);
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly lines = signal<EditableLine[]>([]);
  protected readonly busy = signal(false);
  protected readonly editable = computed(() => this.canManage && (!this.order() || this.order()?.status === 'DRAFT'));

  protected readonly form = inject(FormBuilder).nonNullable.group({
    supplier: ['', Validators.required],
    depot: ['', Validators.required],
    order_date: [today(), Validators.required],
    expected_date: [''],
    note: [''],
  });

  ngOnInit(): void {
    this.api.listSuppliers({ is_active: true }).subscribe((page) => this.suppliers.set(page.results));
    this.stockApi.listDepots().subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      if (!this.id()) {
        this.form.patchValue({ depot: defaultDepotId(depots, this.device()?.depot) ?? '' });
      }
    });
    const id = this.id();
    if (id) {
      this.api.getOrder(id).subscribe((order) => this.fill(order));
    } else if (!this.canManage) {
      this.form.disable();
    }
  }

  protected setLines(lines: EditableLine[]): void {
    this.lines.set(lines);
    this.form.markAsDirty();
  }

  protected save(): void {
    const value = this.form.getRawValue();
    this.busy.set(true);
    this.api
      .saveOrder({ ...value, expected_date: value.expected_date || null,
        lines: this.lines().filter((l) => l.quantity > 0).map((l) => ({ article: l.article, quantity: l.quantity,
          unit_cost: l.unitCost })) }, this.order()?.id)
      .subscribe({
        next: (order) => {
          this.busy.set(false);
          this.snack.open(`Bon ${order.number} enregistré.`);
          if (!this.id()) {
            void this.router.navigate(['/achats/bons-de-commande', order.id], { replaceUrl: true });
          } else {
            this.fill(order);
          }
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  protected act(action: 'send' | 'cancel' | 'close'): void {
    const order = this.order();
    const questions = { send: 'Marquer ce bon comme envoyé au fournisseur ?', cancel: 'Annuler ce bon de commande ?',
      close: 'Solder ce bon ? Le reliquat ne sera plus attendu.' };
    if (!order || !confirm(questions[action])) {
      return;
    }
    this.api.orderAction(order.id, action).subscribe({ next: (o) => this.fill(o), error: (e: unknown) => this.fail(e) });
  }

  protected downloadPdf(): void {
    const order = this.order();
    if (!order) {
      return;
    }
    this.api.orderPdf(order.id).subscribe({
      next: (blob) => saveBlob(blob, `${order.number}.pdf`),
      error: () => this.snack.open('PDF indisponible sur ce serveur : utilisez « Imprimer ».', 'Fermer', { duration: 8000 }),
    });
  }

  /** Ouvre la version HTML du bon (même gabarit que le PDF) et lance l'impression. */
  protected printDocument(): void {
    const order = this.order();
    if (!order) {
      return;
    }
    this.api.orderDocument(order.id).subscribe({
      next: (html) => {
        const frame = document.createElement('iframe');
        frame.style.position = 'fixed';
        frame.style.width = '0';
        frame.style.height = '0';
        frame.style.border = '0';
        document.body.appendChild(frame);
        frame.srcdoc = html;
        frame.onload = () => {
          frame.contentWindow?.print();
          setTimeout(() => frame.remove(), 1000);
        };
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fill(order: PurchaseOrder): void {
    this.order.set(order);
    this.form.reset({ supplier: order.supplier, depot: order.depot, order_date: order.order_date,
      expected_date: order.expected_date ?? '', note: order.note });
    this.lines.set(order.lines.map((l) => ({ article: l.article, code: l.article_code ?? '', name: l.article_name ?? '',
      quantity: l.quantity, unitCost: l.unit_cost })));
    if (!this.editable()) {
      this.form.disable();
    } else {
      this.form.enable();
    }
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
  }
}
