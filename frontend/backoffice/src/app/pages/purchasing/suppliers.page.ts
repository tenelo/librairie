import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { AuthService, NetworkStatusService, PurchasingApiService, Supplier, apiErrorMessage } from '@librairie/shared';

@Component({
  selector: 'bo-suppliers-page',
  imports: [FormsModule, ReactiveFormsModule, MatTableModule, MatCardModule, MatFormFieldModule, MatInputModule,
    MatSlideToggleModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Fournisseurs</h1>
      @if (canManage && !editing()) {
        <button mat-flat-button type="button" (click)="edit(null)"><mat-icon>add</mat-icon> Nouveau fournisseur</button>
      }
    </header>
    @if (editing()) {
      <mat-card appearance="outlined">
        <mat-card-header><mat-card-title>{{ editing() === 'new' ? 'Nouveau fournisseur' : 'Modifier le fournisseur' }}</mat-card-title></mat-card-header>
        <mat-card-content>
          <form [formGroup]="form" (ngSubmit)="save()" class="form-grid">
            <mat-form-field class="wide"><mat-label>Raison sociale</mat-label><input matInput formControlName="name" /></mat-form-field>
            <mat-form-field><mat-label>Contact</mat-label><input matInput formControlName="contact_name" /></mat-form-field>
            <mat-form-field><mat-label>Téléphone</mat-label><input matInput formControlName="phone" /></mat-form-field>
            <mat-form-field><mat-label>E-mail</mat-label><input matInput type="email" formControlName="email" /></mat-form-field>
            <mat-form-field class="wide"><mat-label>Adresse</mat-label><input matInput formControlName="address" /></mat-form-field>
            <mat-form-field><mat-label>Conditions de paiement</mat-label><input matInput formControlName="payment_terms" placeholder="Comptant, 30 jours…" /></mat-form-field>
            <mat-form-field><mat-label>Délai de livraison (jours)</mat-label><input matInput type="number" min="0" formControlName="lead_time_days" /></mat-form-field>
            <mat-slide-toggle formControlName="is_active">Actif</mat-slide-toggle>
            <mat-form-field class="wide"><mat-label>Remarques</mat-label><textarea matInput rows="2" formControlName="notes"></textarea></mat-form-field>
            <div class="actions wide">
              <button mat-button type="button" (click)="editing.set(null)">Annuler</button>
              <button mat-flat-button type="submit" [disabled]="form.invalid || !network.online()">Enregistrer</button>
            </div>
          </form>
        </mat-card-content>
      </mat-card>
    }
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher</mat-label>
        <input matInput [(ngModel)]="search" (keyup.enter)="load()" />
      </mat-form-field>
    </div>
    <table mat-table [dataSource]="suppliers()">
      <ng-container matColumnDef="name">
        <th mat-header-cell *matHeaderCellDef>Fournisseur</th>
        <td mat-cell *matCellDef="let s"><strong>{{ s.name }}</strong><br /><small class="muted">{{ s.contact_name }}</small></td>
      </ng-container>
      <ng-container matColumnDef="contact">
        <th mat-header-cell *matHeaderCellDef>Coordonnées</th>
        <td mat-cell *matCellDef="let s">{{ s.phone }}<br /><small class="muted">{{ s.email }}</small></td>
      </ng-container>
      <ng-container matColumnDef="terms">
        <th mat-header-cell *matHeaderCellDef>Conditions</th>
        <td mat-cell *matCellDef="let s">{{ s.payment_terms || '—' }}<br /><small class="muted">livraison {{ s.lead_time_days }} j</small></td>
      </ng-container>
      <ng-container matColumnDef="orders">
        <th mat-header-cell *matHeaderCellDef class="num">Commandes</th>
        <td mat-cell *matCellDef="let s" class="num">{{ s.order_count }}</td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns" [class.clickable]="canManage" [class.inactive]="!row.is_active"
          (click)="canManage && edit(row)"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucun fournisseur.</td></tr>
    </table>
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class SuppliersPage {
  private readonly api = inject(PurchasingApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('purchasing.manage');
  protected readonly columns = ['name', 'contact', 'terms', 'orders'];
  protected readonly suppliers = signal<Supplier[]>([]);
  protected readonly editing = signal<string | null>(null);
  protected search = '';

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    contact_name: [''],
    phone: [''],
    email: ['', Validators.email],
    address: [''],
    payment_terms: [''],
    lead_time_days: [7, [Validators.min(0)]],
    notes: [''],
    is_active: [true],
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.api.listSuppliers({ search: this.search.trim() }).subscribe((page) => this.suppliers.set(page.results));
  }

  protected edit(supplier: Supplier | null): void {
    this.editing.set(supplier?.id ?? 'new');
    this.form.reset(supplier ?? { name: '', contact_name: '', phone: '', email: '', address: '', payment_terms: '',
      lead_time_days: 7, notes: '', is_active: true });
  }

  protected save(): void {
    const id = this.editing();
    this.api.saveSupplier({ ...this.form.getRawValue(), id: id === 'new' ? undefined : id ?? undefined }).subscribe({
      next: () => {
        this.snack.open('Fournisseur enregistré.');
        this.editing.set(null);
        this.load();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
  }
}
