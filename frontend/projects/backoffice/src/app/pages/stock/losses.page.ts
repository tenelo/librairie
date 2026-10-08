import { ChangeDetectionStrategy, Component, inject, signal, viewChild } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, from, map } from 'rxjs';
import {
  ArticleLookup,
  Depot,
  DeviceService,
  MovementKind,
  NetworkStatusService,
  OfflineDataService,
  OutboxService,
  StockApiService,
  SyncEngineService,
  apiErrorMessage,
  defaultDepotId,
} from '@librairie/shared';

import { ArticlePickerComponent } from '../catalog/article-picker.component';
import { MovementsPage } from './movements.page';

type ManualKind = 'LOSS' | 'ADJUSTMENT' | 'OPENING';

/** Pertes / casse, ajustements manuels et saisie du stock initial (motif obligatoire, tracé dans l'audit). */
@Component({
  selector: 'bo-losses-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatButtonModule, MatIconModule, ArticlePickerComponent, MovementsPage],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Pertes, casse et ajustements</h1>
    <mat-card appearance="outlined">
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-button-toggle-group formControlName="kind" aria-label="Type de mouvement">
            <mat-button-toggle value="LOSS">Perte / casse</mat-button-toggle>
            <mat-button-toggle value="ADJUSTMENT">Ajustement (±)</mat-button-toggle>
            <mat-button-toggle value="OPENING">Stock initial</mat-button-toggle>
          </mat-button-toggle-group>
          <div class="form-grid">
            <div class="wide">
              @if (article(); as a) {
                <p>Article : <strong>{{ a.name }}</strong> <code>{{ a.code }}</code>
                  <button mat-button type="button" (click)="article.set(null)">Changer</button></p>
              } @else {
                <bo-article-picker label="Article (nom, code ou scan)" (picked)="article.set($event)" />
              }
            </div>
            <mat-form-field>
              <mat-label>Dépôt</mat-label>
              <mat-select formControlName="depot">
                @for (d of depots(); track d.id) {
                  <mat-option [value]="d.id">{{ d.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Quantité</mat-label>
              <input matInput type="number" formControlName="quantity" />
              <mat-hint>{{ form.controls.kind.value === 'ADJUSTMENT' ? 'Négative pour retirer, positive pour ajouter' : 'Nombre d’unités' }}</mat-hint>
            </mat-form-field>
            <mat-form-field class="wide">
              <mat-label>Motif</mat-label>
              <input matInput formControlName="reason" placeholder="Ex. cahiers abîmés par l'humidité" />
              @if (form.controls.reason.hasError('required')) {
                <mat-error>Le motif est obligatoire.</mat-error>
              }
            </mat-form-field>
          </div>
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="form.invalid || !article() || saving()">
              Enregistrer
            </button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
    <bo-movements-page title="Historique" [fixedKinds]="historyKinds" />
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class LossesPage {
  private readonly api = inject(StockApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly device = inject(DeviceService).device;
  protected readonly network = inject(NetworkStatusService);
  private readonly history = viewChild(MovementsPage);
  private readonly outbox = inject(OutboxService);
  private readonly offline = inject(OfflineDataService);
  private readonly sync = inject(SyncEngineService);

  protected readonly historyKinds: MovementKind[] = ['LOSS', 'ADJUSTMENT', 'OPENING'];
  protected readonly depots = signal<Depot[]>([]);
  protected readonly article = signal<ArticleLookup | null>(null);
  protected readonly saving = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    kind: ['LOSS' as ManualKind],
    depot: ['', Validators.required],
    quantity: [1, [Validators.required]],
    reason: ['', Validators.required],
  });

  constructor() {
    this.api.listDepots().pipe(
      catchError(() => from(this.offline.table('depots')).pipe(map((rows) => rows as unknown as Depot[]))),
    ).subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      this.form.patchValue({ depot: defaultDepotId(depots, this.device()?.depot) ?? '' });
    });
  }

  protected submit(): void {
    const article = this.article();
    const value = this.form.getRawValue();
    if (!article || !value.quantity) {
      return;
    }
    this.saving.set(true);
    if (!this.network.online()) {
      void this.saveOffline(article, value);
      return;
    }
    this.api.adjust({ article: article.id, depot: value.depot, kind: value.kind, quantity: Number(value.quantity),
      reason: value.reason.trim() }).subscribe({
      next: (movement) => {
        this.saving.set(false);
        this.snack.open(`${movement.kind_label} enregistré(e) : ${movement.quantity > 0 ? '+' : ''}${movement.quantity}.`);
        this.article.set(null);
        this.form.patchValue({ quantity: 1, reason: '' });
        this.history()?.reload(0);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  /** Hors ligne, seules les pertes et ajustements sont possibles (le stock initial exige le serveur). */
  private async saveOffline(article: ArticleLookup, value: { kind: ManualKind; depot: string; quantity: number;
    reason: string }): Promise<void> {
    if (value.kind === 'OPENING') {
      this.saving.set(false);
      this.snack.open('La saisie du stock initial nécessite une connexion.', 'Fermer');
      return;
    }
    const quantity = value.kind === 'LOSS' ? -Math.abs(Number(value.quantity)) : Number(value.quantity);
    await this.outbox.enqueue('stock_adjustment', 'create', {
      // Le serveur rend négative une perte ; un ajustement garde son signe.
      article: article.id, depot: value.depot, kind: value.kind, quantity: value.kind === 'LOSS' ? -quantity : quantity,
      reason: value.reason.trim(), movement_id: crypto.randomUUID(),
    }, {
      stockDeltas: await this.offline.stockDeltas(article.id, value.depot, quantity),
      label: `${value.kind === 'LOSS' ? 'Perte' : 'Ajustement'} : ${article.name} (${quantity})`,
    });
    await this.sync.refreshCounts();
    this.saving.set(false);
    this.article.set(null);
    this.form.patchValue({ quantity: 1, reason: '' });
    this.snack.open('Hors ligne : mouvement enregistré sur ce terminal, envoyé au retour du réseau.');
  }
}
