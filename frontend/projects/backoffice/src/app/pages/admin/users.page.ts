import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { ManagedUser, Role, apiErrorMessage } from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';
import { UserDialogComponent, UserDialogData } from './user-dialog.component';

@Component({
  selector: 'bo-users-page',
  imports: [
    DatePipe,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatMenuModule,
    MatChipsModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Utilisateurs</h1>
      <button mat-flat-button type="button" (click)="openDialog()">
        <mat-icon>person_add</mat-icon> Nouvel utilisateur
      </button>
    </header>

    <div class="filters">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Rechercher</mat-label>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="Nom, identifiant, téléphone" />
        <mat-icon matSuffix>search</mat-icon>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Rôle</mat-label>
        <mat-select [(ngModel)]="roleFilter" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          @for (role of roles(); track role.code) {
            <mat-option [value]="role.code">{{ role.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="users()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Nom</th>
          <td mat-cell *matCellDef="let u">
            <strong>{{ u.full_name }}</strong><br /><small>{{ u.username }}</small>
          </td>
        </ng-container>
        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>Rôle</th>
          <td mat-cell *matCellDef="let u">{{ u.role_label }}</td>
        </ng-container>
        <ng-container matColumnDef="phone">
          <th mat-header-cell *matHeaderCellDef>Téléphone</th>
          <td mat-cell *matCellDef="let u">{{ u.phone }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Statut</th>
          <td mat-cell *matCellDef="let u">
            <mat-chip-set>
              <mat-chip [highlighted]="u.is_active">{{ u.is_active ? 'Actif' : 'Désactivé' }}</mat-chip>
              @if (u.has_pin) {
                <mat-chip>PIN</mat-chip>
              }
            </mat-chip-set>
          </td>
        </ng-container>
        <ng-container matColumnDef="lastLogin">
          <th mat-header-cell *matHeaderCellDef>Dernière connexion</th>
          <td mat-cell *matCellDef="let u">{{ u.last_login ? (u.last_login | date) : '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let u">
            <button mat-icon-button type="button" [matMenuTriggerFor]="actions" aria-label="Actions">
              <mat-icon>more_vert</mat-icon>
            </button>
            <mat-menu #actions="matMenu">
              <button mat-menu-item type="button" (click)="openDialog(u)">
                <mat-icon>edit</mat-icon> Modifier
              </button>
              <button mat-menu-item type="button" (click)="toggleActive(u)">
                <mat-icon>{{ u.is_active ? 'person_off' : 'person' }}</mat-icon>
                {{ u.is_active ? 'Désactiver' : 'Réactiver' }}
              </button>
              @if (u.has_pin) {
                <button mat-menu-item type="button" (click)="resetPin(u)">
                  <mat-icon>pin</mat-icon> Réinitialiser le PIN
                </button>
              }
            </mat-menu>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" [class.inactive]="!row.is_active"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucun utilisateur.</td>
        </tr>
      </table>
    </div>
    <mat-paginator
      [length]="total()"
      [pageIndex]="page()"
      [pageSize]="pageSize"
      [hidePageSize]="true"
      (page)="onPage($event)"
    />
  `,
  styleUrl: './admin-page.scss',
})
export class UsersPage {
  private readonly api = inject(AdminApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  protected readonly columns = ['name', 'role', 'phone', 'status', 'lastLogin', 'actions'];
  protected readonly pageSize = 25;
  protected readonly users = signal<ManagedUser[]>([]);
  protected readonly roles = signal<Role[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected search = '';
  protected roleFilter = '';

  constructor() {
    this.api.listRoles().subscribe((roles) => this.roles.set(roles));
    this.reload(0);
  }

  reload(page = this.page()): void {
    this.loading.set(true);
    this.page.set(page);
    this.api
      .listUsers({ page: page + 1, page_size: this.pageSize, search: this.search, role__code: this.roleFilter })
      .subscribe({
        next: (result) => {
          this.users.set(result.results);
          this.total.set(result.count);
          this.loading.set(false);
        },
        error: (err: unknown) => this.fail(err),
      });
  }

  onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  openDialog(user?: ManagedUser): void {
    const data: UserDialogData = { user, roles: this.roles() };
    this.dialog
      .open(UserDialogComponent, { data, width: '560px', maxWidth: '95vw' })
      .afterClosed()
      .subscribe((saved?: ManagedUser) => {
        if (saved) {
          this.snack.open(user ? 'Utilisateur modifié.' : 'Utilisateur créé.');
          this.reload();
        }
      });
  }

  toggleActive(user: ManagedUser): void {
    this.api.setUserActive(user.id, !user.is_active).subscribe({
      next: () => this.reload(),
      error: (err: unknown) => this.fail(err),
    });
  }

  resetPin(user: ManagedUser): void {
    this.api.resetUserPin(user.id).subscribe({
      next: () => {
        this.snack.open(`PIN de ${user.full_name} réinitialisé.`);
        this.reload();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
