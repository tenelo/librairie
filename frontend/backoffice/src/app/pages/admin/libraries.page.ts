import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Library, StockApiService, apiErrorMessage } from '@librairie/shared';

/**
 * Administration › Librairies : les points de vente du propriétaire (libellé, quartier / commune).
 * Chaque employé est rattaché à une librairie ; chaque dépôt aussi (sauf l'entrepôt général).
 */
@Component({
  selector: 'bo-libraries-page',
  imports: [ReactiveFormsModule, MatTableModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSlideToggleModule, MatButtonModule, MatIconModule, MatChipsModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Librairies</h1>
    <p class="help">
      Une librairie regroupe ses dépôts, ses terminaux et son personnel. Rattachez ensuite chaque dépôt
      (Administration › Dépôts) et chaque utilisateur (Administration › Utilisateurs) à sa librairie.
      Un dépôt sans librairie est l'entrepôt général, commun à toutes.
    </p>

    <mat-card appearance="outlined">
      <mat-card-header>
        <mat-card-title>{{ editing() ? 'Modifier la librairie' : 'Nouvelle librairie' }}</mat-card-title>
      </mat-card-header>
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="save()" class="form-grid">
          <mat-form-field>
            <mat-label>Libellé</mat-label>
            <input matInput formControlName="name" placeholder="Librairie du Plateau" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Quartier / commune</mat-label>
            <input matInput formControlName="location" placeholder="Cocody, Riviera 2" />
          </mat-form-field>
          @if (editing()) {
            <mat-slide-toggle formControlName="is_active">Active</mat-slide-toggle>
          }
          <h3 class="full">Reçu de cette librairie</h3>
          <p class="help full">
            Imprimé par les caisses de cette librairie. Un champ laissé vide reprend la valeur de
            Administration › Paramètres librairie et reçus.
          </p>
          <mat-form-field>
            <mat-label>Nom sur le reçu</mat-label>
            <input matInput formControlName="receipt_name" placeholder="ETS MASSA — Ferké" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Ville</mat-label>
            <input matInput formControlName="city" />
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Adresse</mat-label>
            <input matInput formControlName="address" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Téléphone</mat-label>
            <input matInput formControlName="phone" inputmode="tel" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>E-mail</mat-label>
            <input matInput formControlName="email" type="email" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>N° compte contribuable</mat-label>
            <input matInput formControlName="taxpayer_number" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>RCCM</mat-label>
            <input matInput formControlName="trade_register" />
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>En-tête du reçu</mat-label>
            <textarea matInput formControlName="receipt_header" rows="2"></textarea>
          </mat-form-field>
          <mat-form-field class="full">
            <mat-label>Pied de page du reçu</mat-label>
            <textarea matInput formControlName="receipt_footer" rows="2"></textarea>
          </mat-form-field>
          <div class="actions">
            @if (editing()) {
              <button mat-button type="button" (click)="reset()">Annuler</button>
            }
            <button mat-flat-button type="submit" [disabled]="form.invalid || saving()">Enregistrer</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>

    <div class="table-wrapper">
      <table mat-table [dataSource]="libraries()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Libellé</th>
          <td mat-cell *matCellDef="let l"><strong>{{ l.name }}</strong></td>
        </ng-container>
        <ng-container matColumnDef="location">
          <th mat-header-cell *matHeaderCellDef>Quartier / commune</th>
          <td mat-cell *matCellDef="let l">{{ l.location || '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="counts">
          <th mat-header-cell *matHeaderCellDef>Rattachés</th>
          <td mat-cell *matCellDef="let l">{{ l.depot_count }} dépôt(s) · {{ l.user_count }} utilisateur(s)</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Statut</th>
          <td mat-cell *matCellDef="let l">
            <mat-chip-set><mat-chip [highlighted]="l.is_active">{{ l.is_active ? 'Active' : 'Désactivée' }}</mat-chip></mat-chip-set>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let l" class="row-actions">
            <button mat-icon-button type="button" (click)="edit(l); $event.stopPropagation()" matTooltip="Modifier"
                    aria-label="Modifier"><mat-icon>edit</mat-icon></button>
            @if (!l.depot_count && !l.user_count) {
              <button mat-icon-button type="button" (click)="remove(l); $event.stopPropagation()" matTooltip="Supprimer"
                      aria-label="Supprimer"><mat-icon>delete</mat-icon></button>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable" [class.inactive]="!row.is_active"
            (click)="edit(row)"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucune librairie : ajoutez la première ci-dessus.</td>
        </tr>
      </table>
    </div>
  `,
  styleUrl: './admin-page.scss',
  styles: `
    .help {
      opacity: 0.8;
      max-width: 820px;
    }
    mat-card {
      margin-bottom: 16px;
    }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      column-gap: 12px;
      align-items: center;
      padding-top: 12px;
    }
    .full {
      grid-column: 1 / -1;
    }
    h3.full {
      margin: 8px 0 0;
    }
    p.help.full {
      margin: 0 0 12px;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      grid-column: 1 / -1;
    }
    .clickable {
      cursor: pointer;
    }
    .row-actions {
      white-space: nowrap;
      text-align: right;
    }
  `,
})
export class LibrariesPage {
  private readonly api = inject(StockApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly libraries = signal<Library[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly columns = ['name', 'location', 'counts', 'status', 'actions'];

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(100)]],
    location: ['', Validators.maxLength(150)],
    is_active: [true],
    receipt_name: ['', Validators.maxLength(150)],
    address: ['', Validators.maxLength(255)],
    city: ['', Validators.maxLength(100)],
    phone: ['', Validators.maxLength(50)],
    email: ['', Validators.email],
    taxpayer_number: ['', Validators.maxLength(50)],
    trade_register: ['', Validators.maxLength(50)],
    receipt_header: [''],
    receipt_footer: [''],
  });

  constructor() {
    this.load();
  }

  protected edit(library: Library): void {
    this.editing.set(library.id);
    this.form.reset({
      name: library.name, location: library.location, is_active: library.is_active,
      receipt_name: library.receipt_name ?? '', address: library.address ?? '', city: library.city ?? '',
      phone: library.phone ?? '', email: library.email ?? '', taxpayer_number: library.taxpayer_number ?? '',
      trade_register: library.trade_register ?? '', receipt_header: library.receipt_header ?? '',
      receipt_footer: library.receipt_footer ?? '',
    });
  }

  protected reset(): void {
    this.editing.set(null);
    this.form.reset();
  }

  protected save(): void {
    this.saving.set(true);
    this.api.saveLibrary({ ...this.form.getRawValue(), id: this.editing() ?? undefined }).subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open('Librairie enregistrée.');
        this.reset();
        this.load();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }

  protected remove(library: Library): void {
    if (!confirm(`Supprimer la librairie « ${library.name} » ?`)) {
      return;
    }
    this.api.deleteLibrary(library.id).subscribe({
      next: () => {
        this.snack.open('Librairie supprimée.');
        if (this.editing() === library.id) {
          this.reset();
        }
        this.load();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
  }

  private load(): void {
    this.api.listLibraries().subscribe((libraries) => this.libraries.set(libraries));
  }
}
