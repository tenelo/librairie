import { DecimalPipe } from '@angular/common';
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
import { Router, RouterLink } from '@angular/router';
import {
  AuthService,
  CatalogApiService,
  FcfaPipe,
  Kit,
  NetworkStatusService,
  School,
  SchoolLevel,
  SchoolYear,
  apiErrorMessage,
  saveBlob,
} from '@librairie/shared';
import { forkJoin } from 'rxjs';

import { KitDuplicateDialogComponent, KitDuplicateDialogData } from './kit-duplicate-dialog.component';

@Component({
  selector: 'bo-kits-page',
  imports: [
    FormsModule,
    RouterLink,
    MatTableModule,
    MatPaginatorModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatMenuModule,
    MatProgressBarModule,
    FcfaPipe,
    DecimalPipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Kits scolaires</h1>
      <div class="actions">
        <button mat-stroked-button type="button" (click)="export()" [disabled]="!network.online()">
          <mat-icon>download</mat-icon> Exporter (Excel)
        </button>
        @if (canManage) {
          <a mat-flat-button routerLink="nouveau"><mat-icon>add</mat-icon> Nouveau kit</a>
        }
      </div>
    </header>

    <div class="filters">
      <mat-form-field subscriptSizing="dynamic" class="search">
        <mat-label>Rechercher</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput [(ngModel)]="search" (keyup.enter)="reload(0)" placeholder="Nom, code, établissement" />
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Niveau</mat-label>
        <mat-select [(ngModel)]="level" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          @for (l of levels(); track l.id) {
            <mat-option [value]="l.id">{{ l.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Établissement</mat-label>
        <mat-select [(ngModel)]="school" (selectionChange)="reload(0)">
          <mat-option value="">Tous</mat-option>
          <mat-option value="none">Liste générique (sans établissement)</mat-option>
          @for (s of schools(); track s.id) {
            <mat-option [value]="s.id">{{ s.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <mat-form-field subscriptSizing="dynamic">
        <mat-label>Année scolaire</mat-label>
        <mat-select [(ngModel)]="year" (selectionChange)="reload(0)">
          <mat-option value="">Toutes</mat-option>
          @for (y of years(); track y.id) {
            <mat-option [value]="y.id">{{ y.label }}{{ y.is_current ? ' (en cours)' : '' }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
    </div>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="table-wrapper">
      <table mat-table [dataSource]="kits()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Kit</th>
          <td mat-cell *matCellDef="let k">
            <strong>{{ k.name }}</strong><br /><small class="muted"><code>{{ k.code }}</code></small>
          </td>
        </ng-container>
        <ng-container matColumnDef="level">
          <th mat-header-cell *matHeaderCellDef>Niveau</th>
          <td mat-cell *matCellDef="let k">{{ k.level_label }}</td>
        </ng-container>
        <ng-container matColumnDef="school">
          <th mat-header-cell *matHeaderCellDef>Établissement / année</th>
          <td mat-cell *matCellDef="let k">
            {{ k.school_name ?? 'Générique' }}<br /><small class="muted">{{ k.school_year_label ?? '—' }}</small>
          </td>
        </ng-container>
        <ng-container matColumnDef="components">
          <th mat-header-cell *matHeaderCellDef class="num">Articles</th>
          <td mat-cell *matCellDef="let k" class="num">{{ k.components.length }}</td>
        </ng-container>
        <ng-container matColumnDef="price">
          <th mat-header-cell *matHeaderCellDef class="num">Prix</th>
          <td mat-cell *matCellDef="let k" class="num">
            <strong>{{ k.pricing.price | fcfa }}</strong>
            <br /><small class="muted">marge {{ k.pricing.margin | fcfa }}
              @if (k.pricing.margin_rate !== null) { ({{ +k.pricing.margin_rate | number: '1.1-1' }} %) }</small>
          </td>
        </ng-container>
        <ng-container matColumnDef="mode">
          <th mat-header-cell *matHeaderCellDef>Stock</th>
          <td mat-cell *matCellDef="let k">
            <mat-chip-set>
              <mat-chip>{{ k.stock_mode === 'VIRTUAL' ? 'Virtuel' : 'Pré-assemblé' }}</mat-chip>
              @if (k.is_online) {
                <mat-chip highlighted>En ligne</mat-chip>
              }
            </mat-chip-set>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let k" (click)="$event.stopPropagation()">
            @if (canManage) {
              <button mat-icon-button type="button" [matMenuTriggerFor]="menu" aria-label="Actions">
                <mat-icon>more_vert</mat-icon>
              </button>
              <mat-menu #menu="matMenu">
                <button mat-menu-item type="button" (click)="duplicate(k)">
                  <mat-icon>content_copy</mat-icon> Dupliquer
                </button>
                <button mat-menu-item type="button" (click)="exportOne(k)">
                  <mat-icon>download</mat-icon> Exporter la liste
                </button>
              </mat-menu>
            }
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" class="clickable" (click)="open(row)"
            [class.inactive]="!row.is_active"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucun kit.</td>
        </tr>
      </table>
    </div>
    <mat-paginator [length]="total()" [pageIndex]="page()" [pageSize]="pageSize" [hidePageSize]="true"
                   (page)="onPage($event)" />
  `,
  styleUrl: './catalog-page.scss',
})
export class KitsPage {
  private readonly api = inject(CatalogApiService);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('catalog.manage');

  protected readonly columns = ['name', 'level', 'school', 'components', 'price', 'mode', 'actions'];
  protected readonly pageSize = 50;
  protected readonly kits = signal<Kit[]>([]);
  protected readonly levels = signal<SchoolLevel[]>([]);
  protected readonly schools = signal<School[]>([]);
  protected readonly years = signal<SchoolYear[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(0);
  protected readonly loading = signal(false);
  protected search = '';
  protected level = '';
  protected school = '';
  protected year = '';

  constructor() {
    forkJoin({
      levels: this.api.listLevels(),
      schools: this.api.listSchools(),
      years: this.api.listSchoolYears(),
    }).subscribe(({ levels, schools, years }) => {
      this.levels.set(levels);
      this.schools.set(schools.results);
      this.years.set(years);
    });
    this.reload(0);
  }

  private query() {
    return {
      search: this.search.trim(),
      level: this.level,
      school: this.school === 'none' ? null : this.school,
      no_school: this.school === 'none' ? true : null,
      school_year: this.year,
    };
  }

  reload(page: number): void {
    this.page.set(page);
    this.loading.set(true);
    this.api.listKits({ ...this.query(), page: page + 1, page_size: this.pageSize }).subscribe({
      next: (result) => {
        this.kits.set(result.results);
        this.total.set(result.count);
        this.loading.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected onPage(event: PageEvent): void {
    this.reload(event.pageIndex);
  }

  protected open(kit: Kit): void {
    void this.router.navigate(['/catalogue/kits', kit.id]);
  }

  protected duplicate(kit: Kit): void {
    const data: KitDuplicateDialogData = { kit, levels: this.levels(), schools: this.schools(), years: this.years() };
    this.dialog
      .open(KitDuplicateDialogComponent, { data, width: '520px', maxWidth: '95vw' })
      .afterClosed()
      .subscribe((copy?: Kit) => {
        if (copy) {
          this.snack.open(`Kit dupliqué : ${copy.name}.`);
          void this.router.navigate(['/catalogue/kits', copy.id]);
        }
      });
  }

  protected export(): void {
    this.api.downloadKits(this.query()).subscribe({
      next: (blob) => saveBlob(blob, 'listes-fournitures.xlsx'),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected exportOne(kit: Kit): void {
    this.api.downloadKits({ ids: kit.id }).subscribe({
      next: (blob) => saveBlob(blob, `liste-${kit.code}.xlsx`),
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.loading.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
