import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import {
  ArticleLookup,
  AuthService,
  CatalogApiService,
  Category,
  FcfaPipe,
  Kit,
  KitInput,
  KitPricingMode,
  KitStockMode,
  NetworkStatusService,
  School,
  SchoolLevel,
  SchoolYear,
  apiErrorMessage,
  computeKitPricing,
} from '@librairie/shared';
import { forkJoin } from 'rxjs';

import { AdminApiService } from '../../services/admin-api.service';
import { ArticlePickerComponent } from './article-picker.component';

export interface ComponentRow {
  article: string;
  code: string;
  name: string;
  unitPrice: number;
  unitCost: number;
  quantity: number;
  optional: boolean;
  substitutes: ArticleLookup[];
}

/** Éditeur de kit scolaire : rattachement, composition, équivalents et prix (aperçu instantané). */
@Component({
  selector: 'bo-kit-form-page',
  imports: [
    ReactiveFormsModule,
    FormsModule,
    RouterLink,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatChipsModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatProgressBarModule,
    FcfaPipe,
    DecimalPipe,
    ArticlePickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './kit-form.page.html',
  styleUrl: './catalog-page.scss',
  styles: `
    .components {
      width: 100%;
      border-collapse: collapse;
    }
    .components th,
    .components td {
      padding: 6px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      text-align: left;
      vertical-align: middle;
    }
    .components .qty {
      width: 90px;
    }
    .components input.qty-input {
      width: 64px;
      padding: 6px;
      font: inherit;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 4px;
      background: transparent;
      color: inherit;
    }
    .substitutes {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      align-items: center;
    }
    .pricing {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
    }
    .pricing div {
      display: flex;
      flex-direction: column;
      padding: 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }
    .pricing strong {
      font-size: 20px;
    }
    .negative {
      color: var(--mat-sys-error);
    }
  `,
})
export class KitFormPage implements OnInit {
  private readonly api = inject(CatalogApiService);
  private readonly adminApi = inject(AdminApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);

  readonly id = input<string | undefined>(undefined);

  protected readonly canManage = this.auth.hasPermission('catalog.manage');
  protected readonly canEditPrices = computed(() => this.auth.hasPermission('catalog.prices') && this.network.online());

  protected readonly kit = signal<Kit | null>(null);
  protected readonly levels = signal<SchoolLevel[]>([]);
  protected readonly schools = signal<School[]>([]);
  protected readonly years = signal<SchoolYear[]>([]);
  protected readonly categories = signal<Category[]>([]);
  protected readonly rows = signal<ComponentRow[]>([]);
  protected readonly editingSubstitutes = signal<string | null>(null);
  protected readonly rounding = signal(5);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: [''],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    category: [null as string | null],
    level: ['', Validators.required],
    school: [null as string | null],
    school_year: [null as string | null],
    pricing_mode: ['COMPUTED' as KitPricingMode],
    discount_percent: [0, [Validators.min(0), Validators.max(100)]],
    retail_price: [0, [Validators.min(0)]],
    stock_mode: ['VIRTUAL' as KitStockMode],
    is_active: [true],
    is_online: [false],
    notes: [''],
  });

  /** Valeurs du formulaire sous forme de signal, pour l'aperçu de prix. */
  private readonly formValue = signal(this.form.getRawValue());

  protected readonly pricing = computed(() => {
    const value = this.formValue();
    return computeKitPricing({
      pricingMode: value.pricing_mode,
      discountPercent: value.discount_percent,
      fixedPrice: Number(value.retail_price) || 0,
      rounding: this.rounding(),
      components: this.rows().map((row) => ({
        id: row.article,
        unitPrice: row.unitPrice,
        unitCost: row.unitCost,
        quantity: row.quantity,
      })),
    });
  });

  ngOnInit(): void {
    this.form.valueChanges.subscribe(() => this.formValue.set(this.form.getRawValue()));
    forkJoin({
      levels: this.api.listLevels(),
      schools: this.api.listSchools({ is_active: true }),
      years: this.api.listSchoolYears(),
      categories: this.api.listCategories(),
      settings: this.adminApi.getSettings(),
    }).subscribe({
      next: ({ levels, schools, years, categories, settings }) => {
        this.levels.set(levels.filter((l) => l.is_active));
        this.schools.set(schools.results);
        this.years.set(years);
        this.categories.set(categories);
        this.rounding.set(settings.price_rounding ?? 5);
        const id = this.id();
        if (id) {
          this.load(id);
        } else {
          const kitsCategory = categories.find((c) => c.name === 'Kits scolaires' && !c.parent);
          this.form.patchValue({
            school_year: years.find((y) => y.is_current)?.id ?? null,
            category: kitsCategory?.id ?? null,
          });
          this.loading.set(false);
          this.applyPermissions();
        }
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected isNew(): boolean {
    return !this.id();
  }

  protected addComponent(article: ArticleLookup): void {
    if (article.type === 'KIT') {
      this.snack.open('Un kit ne peut pas contenir un autre kit.');
      return;
    }
    const existing = this.rows().find((row) => row.article === article.id);
    if (existing) {
      this.setQuantity(existing, existing.quantity + 1);
      return;
    }
    this.rows.update((rows) => [
      ...rows,
      {
        article: article.id,
        code: article.code,
        name: article.name,
        unitPrice: article.retail_price,
        unitCost: article.avg_cost,
        quantity: 1,
        optional: false,
        substitutes: [],
      },
    ]);
  }

  protected setQuantity(row: ComponentRow, quantity: number): void {
    const value = Math.max(1, Math.trunc(Number(quantity) || 1));
    this.rows.update((rows) => rows.map((r) => (r.article === row.article ? { ...r, quantity: value } : r)));
  }

  protected setOptional(row: ComponentRow, optional: boolean): void {
    this.rows.update((rows) => rows.map((r) => (r.article === row.article ? { ...r, optional } : r)));
  }

  protected removeComponent(row: ComponentRow): void {
    this.rows.update((rows) => rows.filter((r) => r.article !== row.article));
  }

  protected move(row: ComponentRow, offset: number): void {
    this.rows.update((rows) => {
      const index = rows.findIndex((r) => r.article === row.article);
      const target = index + offset;
      if (target < 0 || target >= rows.length) {
        return rows;
      }
      const copy = [...rows];
      [copy[index], copy[target]] = [copy[target], copy[index]];
      return copy;
    });
  }

  protected addSubstitute(row: ComponentRow, article: ArticleLookup): void {
    if (article.id === row.article || article.type === 'KIT') {
      this.snack.open('Choisissez un autre article (hors kit) comme équivalent.');
      return;
    }
    this.rows.update((rows) =>
      rows.map((r) =>
        r.article === row.article && !r.substitutes.some((s) => s.id === article.id)
          ? { ...r, substitutes: [...r.substitutes, article] }
          : r,
      ),
    );
  }

  protected removeSubstitute(row: ComponentRow, substituteId: string): void {
    this.rows.update((rows) =>
      rows.map((r) =>
        r.article === row.article ? { ...r, substitutes: r.substitutes.filter((s) => s.id !== substituteId) } : r,
      ),
    );
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    if (!this.rows().length) {
      this.snack.open('Ajoutez au moins un article au kit.');
      return;
    }
    const raw = this.form.getRawValue();
    const payload: KitInput = {
      code: raw.code || undefined,
      name: raw.name,
      description: raw.description,
      category: raw.category,
      level: raw.level,
      school: raw.school,
      school_year: raw.school_year,
      pricing_mode: raw.pricing_mode,
      discount_percent: String(raw.discount_percent ?? 0),
      stock_mode: raw.stock_mode,
      is_active: raw.is_active,
      is_online: raw.is_online,
      notes: raw.notes,
      components: this.rows().map((row, index) => ({
        article: row.article,
        quantity: row.quantity,
        is_optional: row.optional,
        sort_order: index,
        substitutes: row.substitutes.map((s) => s.id),
      })),
    };
    if (raw.pricing_mode === 'FIXED') {
      payload.retail_price = Number(raw.retail_price) || 0;
    }
    this.saving.set(true);
    const request = this.isNew() ? this.api.createKit(payload) : this.api.updateKit(this.id() as string, payload);
    request.subscribe({
      next: (kit) => {
        this.saving.set(false);
        this.snack.open(this.isNew() ? `Kit ${kit.code} créé.` : 'Kit enregistré.');
        if (this.isNew()) {
          void this.router.navigate(['/catalogue/kits', kit.id], { replaceUrl: true });
        } else {
          this.fill(kit);
        }
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected remove(): void {
    const kit = this.kit();
    if (!kit || !confirm(`Supprimer le kit « ${kit.name} » ?`)) {
      return;
    }
    this.api.deleteKit(kit.id).subscribe({
      next: () => {
        this.snack.open('Kit supprimé.');
        void this.router.navigate(['/catalogue/kits']);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private load(id: string): void {
    this.api.getKit(id).subscribe({
      next: (kit) => {
        this.fill(kit);
        this.loading.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private fill(kit: Kit): void {
    this.kit.set(kit);
    this.form.reset({
      code: kit.code,
      name: kit.name,
      description: kit.description,
      category: kit.category,
      level: kit.level,
      school: kit.school,
      school_year: kit.school_year,
      pricing_mode: kit.pricing_mode,
      discount_percent: Number(kit.discount_percent),
      retail_price: kit.retail_price,
      stock_mode: kit.stock_mode,
      is_active: kit.is_active,
      is_online: kit.is_online,
      notes: kit.notes,
    });
    this.rows.set(
      kit.components.map((c) => ({
        article: c.article,
        code: c.article_code,
        name: c.article_name,
        unitPrice: c.unit_price,
        unitCost: c.unit_cost,
        quantity: c.quantity,
        optional: c.is_optional,
        substitutes: c.substitute_details,
      })),
    );
    this.applyPermissions();
  }

  private applyPermissions(): void {
    if (!this.canManage) {
      this.form.disable({ emitEvent: false });
      return;
    }
    const priceControls = [this.form.controls.pricing_mode, this.form.controls.discount_percent,
      this.form.controls.retail_price];
    for (const control of priceControls) {
      if (this.canEditPrices()) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    this.loading.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
  }
}
