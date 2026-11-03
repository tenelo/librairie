import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import {
  ArticleLookup,
  CatalogApiService,
  Category,
  Depot,
  ManagedUser,
  NetworkStatusService,
  StockApiService,
  apiErrorMessage,
} from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';
import { ArticlePickerComponent } from '../catalog/article-picker.component';
import { InventoryApiService, InventoryKind } from './inventory-api.service';

/** Création d'un inventaire complet, partiel (catégories) ou tournant (articles choisis), avec affectations. */
@Component({
  selector: 'bo-new-inventory-page',
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatChipsModule, MatButtonModule, MatIconModule, ArticlePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Nouvel inventaire</h1>
    @if (!network.online()) { <p class="offline-note">La création d'un inventaire nécessite une connexion.</p> }
    <form [formGroup]="form" (ngSubmit)="create(false)">
      <mat-card appearance="outlined">
        <mat-card-content class="form-grid">
          <mat-form-field class="wide"><mat-label>Libellé</mat-label><input matInput formControlName="name" placeholder="Inventaire de fin d'année" /></mat-form-field>
          <mat-button-toggle-group formControlName="kind" aria-label="Type d'inventaire" class="wide">
            <mat-button-toggle value="FULL">Complet</mat-button-toggle>
            <mat-button-toggle value="PARTIAL">Partiel (catégories)</mat-button-toggle>
            <mat-button-toggle value="CYCLE">Tournant (articles choisis)</mat-button-toggle>
          </mat-button-toggle-group>
          <mat-form-field><mat-label>Dépôt</mat-label>
            <mat-select formControlName="depot">@for (d of depots(); track d.id) { <mat-option [value]="d.id">{{ d.name }}</mat-option> }</mat-select>
          </mat-form-field>
          @if (form.controls.kind.value === 'PARTIAL') {
            <mat-form-field class="wide"><mat-label>Catégories</mat-label>
              <mat-select formControlName="categories" multiple>
                @for (c of categories(); track c.id) { <mat-option [value]="c.id">{{ c.path }}</mat-option> }
              </mat-select>
            </mat-form-field>
          }
          @if (form.controls.kind.value === 'CYCLE') {
            <div class="wide">
              <bo-article-picker label="Ajouter un article à compter" (picked)="addArticle($event)" />
              <mat-chip-set>
                @for (a of selected(); track a.id) {
                  <mat-chip (removed)="removeArticle(a.id)">{{ a.name }}<button matChipRemove aria-label="Retirer"><mat-icon>cancel</mat-icon></button></mat-chip>
                }
              </mat-chip-set>
            </div>
          }
          <mat-form-field><mat-label>Mode de comptage</mat-label>
            <mat-select formControlName="counting_mode">
              <mat-option value="SUM">Comptages additionnés</mat-option>
              <mat-option value="DOUBLE">Double comptage si écart</mat-option>
            </mat-select>
          </mat-form-field>
          @if (form.controls.counting_mode.value === 'DOUBLE') {
            <mat-form-field><mat-label>Seuil d'écart (unités)</mat-label><input matInput type="number" min="0" formControlName="double_count_threshold" /></mat-form-field>
          }
          <mat-form-field class="wide"><mat-label>Inventoristes affectés</mat-label>
            <mat-select formControlName="counters" multiple>
              @for (u of users(); track u.id) { <mat-option [value]="u.username">{{ u.full_name }} ({{ u.role_label }})</mat-option> }
            </mat-select>
            <mat-hint>Sans affectation, tout le personnel autorisé peut compter.</mat-hint>
          </mat-form-field>
          <mat-form-field class="wide"><mat-label>Consigne / zones</mat-label><input matInput formControlName="zone" /></mat-form-field>
        </mat-card-content>
      </mat-card>
      <div class="actions">
        <button mat-stroked-button type="submit" [disabled]="form.invalid || busy() || !network.online()">Enregistrer en préparation</button>
        <button mat-flat-button type="button" (click)="create(true)" [disabled]="form.invalid || busy() || !network.online()">
          <mat-icon>ac_unit</mat-icon> Créer et geler le stock
        </button>
      </div>
    </form>
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class NewInventoryPage {
  private readonly api = inject(InventoryApiService);
  private readonly catalog = inject(CatalogApiService);
  private readonly stock = inject(StockApiService);
  private readonly admin = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);

  protected readonly depots = signal<Depot[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly users = signal<ManagedUser[]>([]);
  protected readonly selected = signal<ArticleLookup[]>([]);
  protected readonly busy = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    kind: ['FULL' as InventoryKind],
    depot: ['', Validators.required],
    categories: [[] as string[]],
    counting_mode: ['SUM' as 'SUM' | 'DOUBLE'],
    double_count_threshold: [2],
    counters: [[] as string[]],
    zone: [''],
  });

  constructor() {
    this.stock.listDepots().subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      this.form.patchValue({ depot: depots.find((d) => d.is_default)?.id ?? depots[0]?.id ?? '' });
    });
    this.catalog.listCategories().subscribe((c) => this.categories.set(c));
    this.admin.listUsers({ is_active: true, page_size: 200 }).subscribe({
      next: (page) => this.users.set(page.results.filter((u) => u.role !== 'CLIENT')),
      error: () => undefined,
    });
  }

  protected addArticle(article: ArticleLookup): void {
    if (!this.selected().some((a) => a.id === article.id)) {
      this.selected.update((list) => [...list, article]);
    }
  }

  protected removeArticle(id: string): void {
    this.selected.update((list) => list.filter((a) => a.id !== id));
  }

  protected create(start: boolean): void {
    const value = this.form.getRawValue();
    this.busy.set(true);
    this.api.create({
      name: value.name, kind: value.kind, depot: value.depot, categories: value.kind === 'PARTIAL' ? value.categories : [],
      articles: value.kind === 'CYCLE' ? this.selected().map((a) => a.id) : [], counting_mode: value.counting_mode,
      double_count_threshold: value.double_count_threshold,
      assignments: value.counters.map((user) => ({ user, zone: value.zone, categories: [] })),
    }).subscribe({
      next: (session) => {
        if (!start) {
          this.busy.set(false);
          void this.router.navigate(['/inventaires/sessions', session.id]);
          return;
        }
        this.api.action(session.id, 'start').subscribe({
          next: () => {
            this.busy.set(false);
            this.snack.open(`Inventaire ${session.number} démarré : stock théorique gelé.`);
            void this.router.navigate(['/inventaires/sessions', session.id]);
          },
          error: (err: unknown) => this.fail(err),
        });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.busy.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
  }
}
