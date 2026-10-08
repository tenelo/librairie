import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Depot, DepotKind, StockApiService, apiErrorMessage } from '@librairie/shared';

@Component({
  selector: 'bo-depots-page',
  imports: [ReactiveFormsModule, MatTableModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatSlideToggleModule, MatButtonModule, MatIconModule, MatChipsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Dépôts</h1>
    <mat-card appearance="outlined">
      <mat-card-header><mat-card-title>{{ editing() ? 'Modifier le dépôt' : 'Nouveau dépôt' }}</mat-card-title></mat-card-header>
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="save()" class="form-grid">
          <mat-form-field><mat-label>Code</mat-label><input matInput formControlName="code" maxlength="10" /></mat-form-field>
          <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="name" /></mat-form-field>
          <mat-form-field>
            <mat-label>Type</mat-label>
            <mat-select formControlName="kind">
              <mat-option value="BOUTIQUE">Magasin / boutique</mat-option>
              <mat-option value="RESERVE">Réserve</mat-option>
            </mat-select>
          </mat-form-field>
          <mat-form-field class="wide"><mat-label>Adresse</mat-label><input matInput formControlName="address" /></mat-form-field>
          <mat-slide-toggle formControlName="is_pickup_point">Point de retrait des commandes en ligne</mat-slide-toggle>
          <mat-slide-toggle formControlName="is_default">Dépôt par défaut</mat-slide-toggle>
          <mat-slide-toggle formControlName="is_active">Actif</mat-slide-toggle>
          <div class="actions wide">
            @if (editing()) { <button mat-button type="button" (click)="reset()">Annuler</button> }
            <button mat-flat-button type="submit" [disabled]="form.invalid">Enregistrer</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
    <table mat-table [dataSource]="depots()">
      <ng-container matColumnDef="code">
        <th mat-header-cell *matHeaderCellDef>Code</th>
        <td mat-cell *matCellDef="let d"><strong>{{ d.code }}</strong></td>
      </ng-container>
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef>Nom</th>
        <td mat-cell *matCellDef="let d">{{ d.name }}<br /><small class="muted">{{ d.kind_label }} · {{ d.address }}</small></td>
      </ng-container>
      <ng-container matColumnDef="flags">
        <th mat-header-cell *matHeaderCellDef></th>
        <td mat-cell *matCellDef="let d">
          <mat-chip-set>
            @if (d.is_default) { <mat-chip highlighted>Par défaut</mat-chip> }
            @if (d.is_pickup_point) { <mat-chip>Retrait</mat-chip> }
            @if (!d.is_active) { <mat-chip>Inactif</mat-chip> }
          </mat-chip-set>
        </td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="['code', 'name', 'flags']"></tr>
      <tr mat-row *matRowDef="let row; columns: ['code', 'name', 'flags']" class="clickable" (click)="edit(row)"></tr>
    </table>
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class DepotsPage {
  private readonly api = inject(StockApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly editing = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{2,10}$/)]],
    name: ['', Validators.required],
    kind: ['BOUTIQUE' as DepotKind],
    address: [''],
    is_pickup_point: [false],
    is_default: [false],
    is_active: [true],
  });

  constructor() {
    this.load();
  }

  protected edit(depot: Depot): void {
    this.editing.set(depot.id);
    this.form.reset(depot);
  }

  protected reset(): void {
    this.editing.set(null);
    this.form.reset({ code: '', name: '', kind: 'BOUTIQUE', address: '', is_pickup_point: false, is_default: false,
      is_active: true });
  }

  protected save(): void {
    this.api.saveDepot({ ...this.form.getRawValue(), id: this.editing() ?? undefined }).subscribe({
      next: () => {
        this.snack.open('Dépôt enregistré.');
        this.reset();
        this.load();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
  }

  private load(): void {
    this.api.listDepots().subscribe((depots) => this.depots.set(depots));
  }
}
