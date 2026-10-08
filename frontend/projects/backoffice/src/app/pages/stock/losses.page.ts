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
import {
  ArticleLookup,
  Depot,
  DeviceService,
  MovementKind,
  NetworkStatusService,
  StockApiService,
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
            <button mat-flat-button type="submit" [disabled]="form.invalid || !article() || saving() || !network.online()">
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
    this.api.listDepots().subscribe((depots) => {
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
}
