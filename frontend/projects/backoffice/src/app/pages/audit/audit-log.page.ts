import { DatePipe, JsonPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { NetworkStatusService, apiErrorMessage, saveBlob } from '@librairie/shared';

import { AdminApiService, AuditLogEntry } from '../../services/admin-api.service';

/** Journal d'audit en lecture seule ; la route « Connexions » restreint aux événements de connexion. */
@Component({
  selector: 'bo-audit-log-page',
  imports: [
    DatePipe,
    JsonPipe,
    FormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>{{ connectionsOnly() ? 'Connexions' : "Journal d'audit" }}</h1>
    @if (!network.online()) {
      <p class="offline" role="alert">Le journal d'audit nécessite une connexion au serveur.</p>
    }
    <div class="filters">
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Rechercher</mat-label>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="Utilisateur, entité, n° de reçu" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Du</mat-label>
        <input matInput type="date" [(ngModel)]="dateFrom" (change)="reload(0)" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Au</mat-label>
        <input matInput type="date" [(ngModel)]="dateTo" (change)="reload(0)" />
      </mat-form-field>
      @if (!connectionsOnly()) {
        <label class="select">Type
          <select [(ngModel)]="action" (change)="reload(0)">
            <option value="">Tous</option>
            @for (a of actions; track a.code) { <option [value]="a.code">{{ a.label }}</option> }
          </select>
        </label>
        <label class="select">Origine
          <select [(ngModel)]="origin" (change)="reload(0)">
            <option value="">Toutes</option>
            <option value="ONLINE">En ligne</option>
            <option value="SYNC">Synchronisation (hors ligne)</option>
            <option value="SYSTEM">Système</option>
          </select>
        </label>
        <mat-form-field subscriptSizing="dynamic">
          <mat-label>Entité</mat-label>
          <input matInput [(ngModel)]="entity" (keyup.enter)="reload(0)" placeholder="Sale, Article, Customer…" />
        </mat-form-field>
      }
      <button mat-stroked-button type="button" (click)="reload(0)"><mat-icon>search</mat-icon> Filtrer</button>
      <button mat-button type="button" (click)="exportXlsx()" [disabled]="!network.online()"><mat-icon>table_view</mat-icon> Exporter</button>
    </div>
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="rows()" multiTemplateDataRows>
        <ng-container matColumnDef="date">
          <th mat-header-cell *matHeaderCellDef>Date serveur</th>
          <td mat-cell *matCellDef="let r">{{ r.server_timestamp | date: 'dd/MM/yyyy HH:mm:ss' }}</td>
        </ng-container>
        <ng-container matColumnDef="action">
          <th mat-header-cell *matHeaderCellDef>Action</th>
          <td mat-cell *matCellDef="let r">{{ r.action_label }}</td>
        </ng-container>
        <ng-container matColumnDef="user">
          <th mat-header-cell *matHeaderCellDef>Utilisateur</th>
          <td mat-cell *matCellDef="let r">{{ r.username || '—' }} <small>{{ r.role_code }}</small></td>
        </ng-container>
        <ng-container matColumnDef="device">
          <th mat-header-cell *matHeaderCellDef>Terminal</th>
          <td mat-cell *matCellDef="let r">{{ r.device_code || '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="entity">
          <th mat-header-cell *matHeaderCellDef>Objet</th>
          <td mat-cell *matCellDef="let r">{{ r.description || r.entity }}</td>
        </ng-container>
        <ng-container matColumnDef="origin">
          <th mat-header-cell *matHeaderCellDef>Origine</th>
          <td mat-cell *matCellDef="let r">{{ r.origin_label }} <small>{{ r.ip_address }}</small></td>
        </ng-container>
        <ng-container matColumnDef="detail">
          <td mat-cell *matCellDef="let r" [attr.colspan]="columns.length" class="detail">
            <div>
              <strong>Date client :</strong>
              {{ r.client_timestamp ? (r.client_timestamp | date: 'dd/MM/yyyy HH:mm:ss') : '—' }}
              · <strong>Identifiant :</strong> {{ r.entity }} {{ r.entity_id }}
            </div>
            @if (r.old_values || r.new_values) {
              <div class="diff">
                <pre><strong>Avant</strong>
{{ r.old_values | json }}</pre>
                <pre><strong>Après</strong>
{{ r.new_values | json }}</pre>
              </div>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="row" (click)="toggle(row)"></tr>
        <tr mat-row *matRowDef="let row; columns: ['detail']" class="detail-row" [class.open]="expanded() === row.id"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucune entrée.</td>
        </tr>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize" [hidePageSize]="true" (page)="onPage($event)" />
  `,
  styleUrl: '../admin/admin-page.scss',
  styles: `
    .row {
      cursor: pointer;
    }
    .detail-row {
      display: none;
    }
    .detail-row.open {
      display: table-row;
    }
    .detail {
      padding: 12px 16px;
      background: var(--mat-sys-surface-container-low);
    }
    .diff {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }
    pre {
      white-space: pre-wrap;
      font-size: 12px;
    }
    .offline {
      color: var(--mat-sys-error);
    }
  `,
})
export class AuditLogPage {
  private readonly api = inject(AdminApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);

  readonly connectionsOnly = input(false);

  protected readonly columns = ['date', 'action', 'user', 'device', 'entity', 'origin'];
  protected readonly pageSize = 50;
  protected readonly rows = signal<AuditLogEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected readonly expanded = signal<string | null>(null);
  protected search = '';
  protected dateFrom = '';
  protected dateTo = '';
  protected action = '';
  protected origin = '';
  protected entity = '';
  protected readonly actions = [
    { code: 'CREATE', label: 'Création' }, { code: 'UPDATE', label: 'Modification' },
    { code: 'DELETE', label: 'Suppression' }, { code: 'CANCEL', label: 'Annulation' },
    { code: 'REFUND', label: 'Retour / remboursement' }, { code: 'DISCOUNT_OVERRIDE', label: 'Remise au-delà du plafond' },
    { code: 'PRICE_CHANGE', label: 'Modification de prix' }, { code: 'REPRINT', label: 'Réimpression de reçu' },
    { code: 'DRAWER_OPEN', label: 'Ouverture de tiroir' }, { code: 'INVENTORY_VALIDATE', label: "Validation d'inventaire" },
    { code: 'SYNC_CONFLICT', label: 'Conflit de synchronisation' }, { code: 'PERMISSIONS_CHANGE', label: 'Permissions' },
    { code: 'PIN_UNLOCK', label: 'Déverrouillage PIN' }, { code: 'PIN_FAILED', label: 'Échec de PIN' },
    { code: 'LOGIN', label: 'Connexion' }, { code: 'LOGIN_FAILED', label: 'Échec de connexion' },
  ];

  constructor() {
    // Recharge lorsque l'on passe de « Journal » à « Connexions » (même composant réutilisé).
    effect(() => {
      this.connectionsOnly();
      this.reload(0);
    });
  }

  protected toggle(row: AuditLogEntry): void {
    this.expanded.set(this.expanded() === row.id ? null : row.id);
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  private filters() {
    return {
      search: this.search,
      date_from: this.dateFrom ? `${this.dateFrom}T00:00:00Z` : null,
      date_to: this.dateTo ? `${this.dateTo}T23:59:59Z` : null,
      connections: this.connectionsOnly() ? true : null,
      action: this.action || null,
      origin: this.origin || null,
      entity: this.entity.trim() || null,
    };
  }

  protected exportXlsx(): void {
    this.api.exportAuditLogs(this.filters()).subscribe({
      next: (blob) => saveBlob(blob, `journal-audit-${new Date().toISOString().slice(0, 10)}.xlsx`),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 }),
    });
  }

  reload(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.api
      .listAuditLogs({ page: page + 1, page_size: this.pageSize, ...this.filters() })
      .subscribe({
        next: (result) => {
          this.rows.set(result.results);
          this.total.set(result.count);
          this.loading.set(false);
        },
        error: (err: unknown) => {
          this.loading.set(false);
          this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
        },
      });
  }
}
