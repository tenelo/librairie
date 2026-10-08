import { DatePipe } from '@angular/common';
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
  LibrarySettings,
  NetworkStatusService,
  StockApiService,
  StockTransfer,
  apiErrorMessage,
} from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';
import { EditableLine, LinesEditorComponent } from './lines-editor.component';

/** Bon de transfert : saisie, validation (mouvements sortant/entrant) et impression. */
@Component({
  selector: 'bo-transfer-form-page',
  imports: [ReactiveFormsModule, RouterLink, DatePipe, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, LinesEditorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="no-print">
      <header class="page-header">
        <div>
          <a mat-button routerLink="/stock/transferts"><mat-icon>arrow_back</mat-icon> Transferts</a>
          <h1>{{ transfer()?.number ?? 'Nouveau transfert' }}
            @if (transfer(); as t) { <small class="muted">· {{ t.status_label }}</small> }</h1>
        </div>
        <div class="actions">
          @if (transfer(); as t) {
            <button mat-stroked-button type="button" (click)="print()"><mat-icon>print</mat-icon> Imprimer le bon</button>
            @if (editable() && canTransfer) {
              <button mat-stroked-button type="button" (click)="cancel()" [disabled]="!network.online()">Annuler le transfert</button>
              <button mat-flat-button type="button" (click)="validate()" [disabled]="busy() || !network.online()">
                <mat-icon>check</mat-icon> Valider
              </button>
            }
          }
        </div>
      </header>
      <mat-card appearance="outlined">
        <mat-card-content>
          <form [formGroup]="form" class="form-grid">
            <mat-form-field>
              <mat-label>Dépôt de départ</mat-label>
              <mat-select formControlName="from_depot">
                @for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Dépôt d'arrivée</mat-label>
              <mat-select formControlName="to_depot">
                @for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }
              </mat-select>
            </mat-form-field>
            <mat-form-field class="wide">
              <mat-label>Note</mat-label>
              <input matInput formControlName="note" />
            </mat-form-field>
          </form>
          <bo-lines-editor [(lines)]="lines" [readonly]="!editable() || !canTransfer" />
        </mat-card-content>
      </mat-card>
      @if (editable() && canTransfer) {
        <div class="actions">
          <button mat-flat-button type="button" (click)="save()" [disabled]="form.invalid || !lines().length || busy() || !network.online()">
            Enregistrer le brouillon
          </button>
        </div>
      }
    </div>

    @if (transfer(); as t) {
      <section class="print-only document">
        <h2>{{ settings()?.name }}</h2>
        <h1>BON DE TRANSFERT {{ t.number }}</h1>
        <p>Du dépôt <strong>{{ t.from_depot_name }}</strong> vers <strong>{{ t.to_depot_name }}</strong> —
          {{ t.created_at | date: 'dd/MM/yyyy' }}. Statut : {{ t.status_label }}
          @if (t.validated_at) { (validé le {{ t.validated_at | date: 'dd/MM/yyyy HH:mm' }} par {{ t.validated_by_name }}) }</p>
        <table>
          <thead><tr><th>Code</th><th>Article</th><th class="num">Quantité</th><th>Contrôle</th></tr></thead>
          <tbody>
            @for (line of t.lines; track line.article) {
              <tr><td>{{ line.article_code }}</td><td>{{ line.article_name }}</td><td class="num">{{ line.quantity }}</td><td></td></tr>
            }
          </tbody>
        </table>
        @if (t.note) { <p>Note : {{ t.note }}</p> }
        <div class="signatures"><span>Remis par :</span><span>Reçu par :</span></div>
      </section>
    }
  `,
  styleUrl: '../catalog/catalog-page.scss',
  styles: `
    .print-only {
      display: none;
    }
    @media print {
      .no-print {
        display: none;
      }
      .print-only {
        display: block;
        color: #000;
      }
      .document table {
        width: 100%;
        border-collapse: collapse;
      }
      .document th,
      .document td {
        border: 1px solid #999;
        padding: 4px 6px;
        text-align: left;
      }
      .signatures {
        display: flex;
        justify-content: space-between;
        margin-top: 48px;
      }
    }
  `,
})
export class TransferFormPage implements OnInit {
  private readonly api = inject(StockApiService);
  private readonly adminApi = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canTransfer = inject(AuthService).hasPermission('stock.transfer');

  readonly id = input<string | undefined>(undefined);

  protected readonly depots = signal<Depot[]>([]);
  protected readonly transfer = signal<StockTransfer | null>(null);
  protected readonly settings = signal<LibrarySettings | null>(null);
  protected readonly lines = signal<EditableLine[]>([]);
  protected readonly busy = signal(false);
  protected readonly editable = computed(() => !this.transfer() || this.transfer()?.status === 'DRAFT');

  protected readonly form = inject(FormBuilder).nonNullable.group({
    from_depot: ['', Validators.required],
    to_depot: ['', Validators.required],
    note: [''],
  });

  ngOnInit(): void {
    this.api.listDepots().subscribe((depots) => {
      const active = depots.filter((d) => d.is_active);
      this.depots.set(active);
      if (!this.id()) {
        const reserve = active.find((d) => d.kind === 'RESERVE');
        const shop = active.find((d) => d.is_default) ?? active.find((d) => d.id !== reserve?.id);
        this.form.patchValue({ from_depot: reserve?.id ?? '', to_depot: shop?.id ?? '' });
      }
    });
    this.adminApi.getSettings().subscribe({ next: (s) => this.settings.set(s), error: () => undefined });
    const id = this.id();
    if (id) {
      this.api.getTransfer(id).subscribe((transfer) => this.fill(transfer));
    }
  }

  protected save(): void {
    const value = this.form.getRawValue();
    this.busy.set(true);
    this.api.saveTransfer({ ...value, lines: this.lines().filter((l) => l.quantity > 0)
      .map((l) => ({ article: l.article, quantity: l.quantity })) }, this.transfer()?.id).subscribe({
      next: (transfer) => {
        this.busy.set(false);
        this.snack.open(`Transfert ${transfer.number} enregistré.`);
        if (!this.id()) {
          void this.router.navigate(['/stock/transferts', transfer.id], { replaceUrl: true });
        } else {
          this.fill(transfer);
        }
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected validate(): void {
    const transfer = this.transfer();
    if (!transfer || !confirm(`Valider le transfert ${transfer.number} ? Le stock des deux dépôts sera mis à jour.`)) {
      return;
    }
    this.busy.set(true);
    this.api.validateTransfer(transfer.id).subscribe({
      next: (validated) => {
        this.busy.set(false);
        this.snack.open('Transfert validé : stocks mis à jour.');
        this.fill(validated);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected cancel(): void {
    const transfer = this.transfer();
    if (transfer && confirm('Annuler ce transfert ?')) {
      this.api.cancelTransfer(transfer.id).subscribe({ next: (t) => this.fill(t), error: (e: unknown) => this.fail(e) });
    }
  }

  protected print(): void {
    window.print();
  }

  private fill(transfer: StockTransfer): void {
    this.transfer.set(transfer);
    this.form.reset({ from_depot: transfer.from_depot, to_depot: transfer.to_depot, note: transfer.note });
    this.lines.set(transfer.lines.map((l) => ({ article: l.article, code: l.article_code ?? '', name: l.article_name ?? '',
      quantity: l.quantity, unitCost: 0 })));
    if (transfer.status !== 'DRAFT' || !this.canTransfer) {
      this.form.disable();
    }
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
  }
}
