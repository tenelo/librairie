import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnInit, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
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
  ARTICLE_TYPE_LABELS,
  Article,
  ArticleInput,
  ArticleLookup,
  ArticleType,
  AuthService,
  Barcode,
  BarcodeSvgComponent,
  Brand,
  CatalogApiService,
  Category,
  FcfaPipe,
  NetworkStatusService,
  PriceHistoryEntry,
  Unit,
  apiErrorMessage,
  isValidEan13,
} from '@librairie/shared';
import { forkJoin } from 'rxjs';

import { ArticlePickerComponent } from './article-picker.component';

const PRICE_LABELS: Record<string, string> = {
  retail_price: 'Prix détail',
  wholesale_price: 'Prix gros',
  wholesale_min_qty: 'Seuil gros',
  avg_cost: "Prix d'achat moyen",
  vat_rate: 'TVA',
  vat_exempt: 'Exonération TVA',
};

/** Fiche article : création et modification (les kits ont leur propre éditeur). */
@Component({
  selector: 'bo-article-form-page',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    DatePipe,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatTooltipModule,
    MatProgressBarModule,
    FcfaPipe,
    BarcodeSvgComponent,
    ArticlePickerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './article-form.page.html',
  styleUrl: './catalog-page.scss',
  styles: `
    .barcodes {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 12px;
    }
    .barcode {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 180px;
      padding: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 8px;
    }
    .barcode lib-barcode-svg {
      width: 160px;
      height: 64px;
    }
    .barcode-add {
      display: flex;
      gap: 8px;
      align-items: baseline;
      flex-wrap: wrap;
    }
    .images {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
    }
    .image {
      position: relative;
    }
    .image img {
      width: 120px;
      height: 120px;
      object-fit: cover;
      border-radius: 8px;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .image button {
      position: absolute;
      top: 0;
      right: 0;
    }
    .summary {
      display: flex;
      gap: 24px;
      flex-wrap: wrap;
      margin: 8px 0 0;
    }
    .history {
      width: 100%;
      border-collapse: collapse;
      font-size: 14px;
    }
    .history td,
    .history th {
      text-align: left;
      padding: 4px 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
  `,
})
export class ArticleFormPage implements OnInit {
  private readonly api = inject(CatalogApiService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  protected readonly network = inject(NetworkStatusService);

  /** Identifiant de route (`:id`) ; absent pour une création. */
  readonly id = input<string | undefined>(undefined);

  protected readonly typeLabels = ARTICLE_TYPE_LABELS;
  protected readonly types: ArticleType[] = ['SIMPLE', 'LOT', 'SERVICE'];
  protected readonly priceLabels = PRICE_LABELS;
  protected readonly canManage = this.auth.hasPermission('catalog.manage');
  protected readonly canEditPrices = computed(
    () => this.auth.hasPermission('catalog.prices') && this.network.online(),
  );

  protected readonly article = signal<Article | null>(null);
  protected readonly categories = signal<Category[]>([]);
  protected readonly brands = signal<Brand[]>([]);
  protected readonly units = signal<Unit[]>([]);
  protected readonly barcodes = signal<Barcode[]>([]);
  protected readonly history = signal<PriceHistoryEntry[]>([]);
  protected readonly lotBase = signal<{ id: string; name: string } | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly newBarcode = signal('');

  protected readonly form = inject(FormBuilder).group({
    code: [''],
    name: ['', [Validators.required, Validators.maxLength(200)]],
    description: [''],
    type: ['SIMPLE' as ArticleType, Validators.required],
    category: [null as string | null],
    brand: [null as string | null],
    unit: [null as string | null],
    avg_cost: [0, [Validators.min(0)]],
    retail_price: [0, [Validators.required, Validators.min(0)]],
    wholesale_price: [null as number | null, [Validators.min(0)]],
    wholesale_min_qty: [null as number | null, [Validators.min(2)]],
    vat_rate: [null as string | null],
    vat_exempt: [false],
    alert_threshold: [0, [Validators.min(0)]],
    max_stock: [null as number | null, [Validators.min(0)]],
    is_active: [true],
    is_online: [false],
    lot_units: [null as number | null, [Validators.min(2)]],
  });

  protected readonly margin = signal(0);

  constructor() {
    // Le passage hors ligne / en ligne verrouille ou déverrouille les prix.
    effect(() => {
      this.canEditPrices();
      untracked(() => {
        if (!this.loading()) {
          this.applyPermissions();
        }
      });
    });
  }

  ngOnInit(): void {
    forkJoin({
      categories: this.api.listCategories(),
      brands: this.api.listBrands(),
      units: this.api.listUnits(),
    }).subscribe(({ categories, brands, units }) => {
      this.categories.set(categories);
      this.brands.set(brands);
      this.units.set(units);
    });
    this.form.valueChanges.subscribe((value) =>
      this.margin.set(Number(value.retail_price ?? 0) - Number(value.avg_cost ?? 0)),
    );
    const id = this.id();
    if (id) {
      this.load(id);
    } else {
      this.loading.set(false);
      this.applyPermissions();
    }
  }

  protected isNew(): boolean {
    return !this.id();
  }

  protected setLotBase(article: ArticleLookup): void {
    if (article.type !== 'SIMPLE') {
      this.snack.open('Un lot ne peut contenir qu’un article simple.');
      return;
    }
    this.lotBase.set({ id: article.id, name: article.name });
  }

  protected addBarcode(): void {
    const code = this.newBarcode().trim();
    if (!code) {
      return;
    }
    if (this.barcodes().some((b) => b.code === code)) {
      this.snack.open('Ce code-barres est déjà dans la liste.');
      return;
    }
    const kind = isValidEan13(code) ? 'EAN13' : 'OTHER';
    if (/^\d{13}$/.test(code) && kind === 'OTHER') {
      this.snack.open('Clé de contrôle EAN-13 incorrecte : vérifiez la saisie.', 'Fermer');
      return;
    }
    this.barcodes.update((list) => [...list, { code, kind }]);
    this.newBarcode.set('');
    this.form.markAsDirty();
  }

  protected removeBarcode(code: string): void {
    this.barcodes.update((list) => list.filter((b) => b.code !== code));
    this.form.markAsDirty();
  }

  protected generateBarcode(): void {
    const article = this.article();
    if (!article) {
      return;
    }
    this.api.generateBarcode(article.id).subscribe({
      next: (barcode) => this.barcodes.update((list) => [...list, barcode]),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected addBrand(name: string): void {
    if (!name.trim()) {
      return;
    }
    this.api.createBrand(name.trim()).subscribe({
      next: (brand) => {
        this.brands.update((list) => [...list, brand].sort((a, b) => a.name.localeCompare(b.name)));
        this.form.patchValue({ brand: brand.id });
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected uploadImage(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    const article = this.article();
    if (!file || !article) {
      return;
    }
    this.api.uploadImage(article.id, file).subscribe({
      next: (image) => this.article.set({ ...article, images: [...article.images, image] }),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected deleteImage(imageId: string): void {
    const article = this.article();
    if (!article) {
      return;
    }
    this.api.deleteImage(article.id, imageId).subscribe({
      next: () => this.article.set({ ...article, images: article.images.filter((i) => i.id !== imageId) }),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue();
    const payload: ArticleInput = {
      name: raw.name ?? '',
      description: raw.description ?? '',
      category: raw.category,
      brand: raw.brand,
      unit: raw.unit,
      alert_threshold: raw.alert_threshold ?? 0,
      max_stock: raw.max_stock || null,
      is_active: !!raw.is_active,
      is_online: !!raw.is_online,
      barcodes: this.barcodes().map((b) => ({ code: b.code, kind: b.kind })),
    };
    if (raw.code) {
      payload.code = raw.code;
    }
    if (this.isNew()) {
      payload.type = raw.type ?? 'SIMPLE';
      payload.avg_cost = raw.avg_cost ?? 0;
    }
    if (this.canEditPrices()) {
      payload.retail_price = raw.retail_price ?? 0;
      payload.wholesale_price = raw.wholesale_price || null;
      payload.wholesale_min_qty = raw.wholesale_price ? raw.wholesale_min_qty : null;
      payload.vat_rate = raw.vat_rate || null;
      payload.vat_exempt = !!raw.vat_exempt;
    }
    if ((raw.type ?? this.article()?.type) === 'LOT') {
      payload.lot_base_article = this.lotBase()?.id ?? null;
      payload.lot_units = raw.lot_units;
    }
    this.saving.set(true);
    const request = this.isNew()
      ? this.api.createArticle(payload)
      : this.api.updateArticle(this.id() as string, payload);
    request.subscribe({
      next: (article) => {
        this.saving.set(false);
        this.snack.open(this.isNew() ? `Article ${article.code} créé.` : 'Article enregistré.');
        if (this.isNew()) {
          void this.router.navigate(['/catalogue/articles', article.id], { replaceUrl: true });
        } else {
          this.fill(article);
          this.api.priceHistory(article.id).subscribe((history) => this.history.set(history));
        }
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected remove(): void {
    const article = this.article();
    if (!article || !confirm(`Supprimer l'article « ${article.name} » ?`)) {
      return;
    }
    this.api.deleteArticle(article.id).subscribe({
      next: () => {
        this.snack.open('Article supprimé.');
        void this.router.navigate(['/catalogue/articles']);
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  private load(id: string): void {
    this.api.getArticle(id).subscribe({
      next: (article) => {
        if (article.type === 'KIT' && article.kit_id) {
          void this.router.navigate(['/catalogue/kits', article.kit_id], { replaceUrl: true });
          return;
        }
        this.fill(article);
        this.loading.set(false);
      },
      error: (err: unknown) => this.fail(err),
    });
    this.api.priceHistory(id).subscribe((history) => this.history.set(history));
  }

  private fill(article: Article): void {
    this.article.set(article);
    this.barcodes.set(article.barcodes);
    this.lotBase.set(
      article.lot_base_article ? { id: article.lot_base_article, name: article.lot_base_article_name ?? '' } : null,
    );
    this.form.reset({
      code: article.code,
      name: article.name,
      description: article.description,
      type: article.type,
      category: article.category,
      brand: article.brand,
      unit: article.unit,
      avg_cost: article.avg_cost,
      retail_price: article.retail_price,
      wholesale_price: article.wholesale_price,
      wholesale_min_qty: article.wholesale_min_qty,
      vat_rate: article.vat_rate,
      vat_exempt: article.vat_exempt,
      alert_threshold: article.alert_threshold,
      max_stock: article.max_stock,
      is_active: article.is_active,
      is_online: article.is_online,
      lot_units: article.lot_units,
    });
    this.applyPermissions();
  }

  /** Champs verrouillés : type et CMP après création, prix sans permission ou hors ligne. */
  private applyPermissions(): void {
    const controls = this.form.controls;
    if (!this.canManage) {
      this.form.disable({ emitEvent: false });
      return;
    }
    if (!this.isNew()) {
      controls.type.disable({ emitEvent: false });
      controls.avg_cost.disable({ emitEvent: false });
    }
    const priceControls = [
      controls.retail_price,
      controls.wholesale_price,
      controls.wholesale_min_qty,
      controls.vat_rate,
      controls.vat_exempt,
    ];
    for (const control of priceControls) {
      if (this.canEditPrices()) {
        control.enable({ emitEvent: false });
      } else {
        control.disable({ emitEvent: false });
      }
    }
    if (this.isNew() && !this.canEditPrices()) {
      controls.avg_cost.disable({ emitEvent: false });
    }
  }

  private fail(err: unknown): void {
    this.saving.set(false);
    this.loading.set(false);
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
  }
}
