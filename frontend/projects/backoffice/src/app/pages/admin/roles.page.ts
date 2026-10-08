import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppPermission, AuthService, Role, apiErrorMessage } from '@librairie/shared';
import { forkJoin } from 'rxjs';

import { AdminApiService } from '../../services/admin-api.service';

interface PermissionGroup {
  module: string;
  permissions: AppPermission[];
}

/** Matrice rôles × permissions, modifiable par l'administrateur. */
@Component({
  selector: 'bo-roles-page',
  imports: [MatCheckboxModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Rôles &amp; permissions</h1>
      <button mat-flat-button type="button" [disabled]="!dirty() || saving()" (click)="save()">
        <mat-icon>save</mat-icon> Enregistrer
      </button>
    </header>
    <p class="help">
      Cochez les actions autorisées pour chaque rôle. Le rôle Administrateur conserve l'accès à l'administration.
    </p>
    @if (loading() || saving()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="matrix-wrapper">
      <table class="matrix">
        <thead>
          <tr>
            <th class="perm-col">Permission</th>
            @for (role of roles(); track role.code) {
              <th>{{ role.label }}</th>
            }
          </tr>
        </thead>
        <tbody>
          @for (group of groups(); track group.module) {
            <tr class="group-row">
              <th [attr.colspan]="roles().length + 1">{{ group.module }}</th>
            </tr>
            @for (perm of group.permissions; track perm.code) {
              <tr>
                <td class="perm-col" [matTooltip]="perm.code">{{ perm.label }}</td>
                @for (role of roles(); track role.code) {
                  <td class="cell">
                    <mat-checkbox
                      [checked]="isGranted(role, perm.code)"
                      [disabled]="isLocked(role, perm.code)"
                      (change)="toggle(role, perm.code, $event.checked)"
                      [aria-label]="role.label + ' : ' + perm.label"
                    />
                  </td>
                }
              </tr>
            }
          }
        </tbody>
      </table>
    </div>
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }
    .help {
      opacity: 0.8;
    }
    .matrix-wrapper {
      overflow: auto;
      max-height: calc(100dvh - 240px);
    }
    .matrix {
      border-collapse: collapse;
      width: 100%;
      min-width: 900px;
    }
    th,
    td {
      padding: 4px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      font-size: 14px;
    }
    thead th {
      position: sticky;
      top: 0;
      background: var(--mat-sys-surface-container);
      z-index: 1;
    }
    .group-row th {
      text-align: left;
      background: var(--mat-sys-surface-container-low);
      font-weight: 600;
    }
    .perm-col {
      text-align: left;
      min-width: 260px;
    }
    .cell {
      text-align: center;
    }
  `,
})
export class RolesPage {
  private readonly api = inject(AdminApiService);
  private readonly auth = inject(AuthService);
  private readonly snack = inject(MatSnackBar);

  protected readonly roles = signal<Role[]>([]);
  protected readonly permissions = signal<AppPermission[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  /** Permissions modifiées localement, par identifiant de rôle. */
  private readonly draft = signal<Map<number, Set<string>>>(new Map());

  protected readonly groups = computed<PermissionGroup[]>(() => {
    const groups = new Map<string, AppPermission[]>();
    for (const perm of this.permissions()) {
      groups.set(perm.module, [...(groups.get(perm.module) ?? []), perm]);
    }
    return [...groups.entries()].map(([module, permissions]) => ({ module, permissions }));
  });

  protected readonly dirty = computed(() => this.draft().size > 0);

  constructor() {
    this.load();
  }

  protected isGranted(role: Role, code: string): boolean {
    return (this.draft().get(role.id) ?? new Set(role.permissions)).has(code);
  }

  /** Empêche l'administrateur de se retirer l'accès à l'écran des rôles. */
  protected isLocked(role: Role, code: string): boolean {
    return role.code === 'ADMIN' && code.startsWith('accounts.');
  }

  protected toggle(role: Role, code: string, checked: boolean): void {
    this.draft.update((draft) => {
      const next = new Map(draft);
      const set = new Set(next.get(role.id) ?? role.permissions);
      if (checked) {
        set.add(code);
      } else {
        set.delete(code);
      }
      next.set(role.id, set);
      return next;
    });
  }

  protected save(): void {
    const changes = [...this.draft().entries()].map(([id, set]) =>
      this.api.updateRole(id, { permissions: [...set].sort() }),
    );
    this.saving.set(true);
    forkJoin(changes).subscribe({
      next: () => {
        this.saving.set(false);
        this.snack.open('Matrice des permissions enregistrée.');
        this.auth.reloadProfile().subscribe();
        this.load();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }

  private load(): void {
    this.loading.set(true);
    forkJoin({ roles: this.api.listRoles(), permissions: this.api.listPermissions() }).subscribe({
      next: ({ roles, permissions }) => {
        this.roles.set(roles);
        this.permissions.set(permissions);
        this.draft.set(new Map());
        this.loading.set(false);
      },
      error: (err: unknown) => {
        this.loading.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
      },
    });
  }
}
