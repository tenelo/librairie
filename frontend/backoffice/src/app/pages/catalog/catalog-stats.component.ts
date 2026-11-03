import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { LocalDbService, SyncedRow } from '@librairie/shared';
import { liveQuery } from 'dexie';
import { from, switchMap } from 'rxjs';

/** Page du menu Catalogue sur laquelle les chiffres clés sont affichés. */
export type CatalogStatsView = 'articles' | 'kits' | 'categories' | 'levels' | 'labels' | 'import';

interface Tile {
  label: string;
  value: string;
  /** Valeur à surveiller (affichée en couleur d'alerte quand elle n'est pas nulle). */
  warn?: boolean;
}

const fmt = (n: number): string => n.toLocaleString('fr-FR');
const alive = (rows: SyncedRow[]): SyncedRow[] => rows.filter((r) => !r.is_deleted);

/**
 * Chiffres clés d'une page du catalogue (nombre d'articles par type, kits, catégories…).
 * Calculés sur la copie locale du catalogue (fonctionne hors connexion) et mis à jour
 * automatiquement à chaque synchronisation.
 */
@Component({
  selector: 'bo-catalog-stats',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="tiles" role="list" aria-label="Chiffres clés">
      @for (t of tiles(); track t.label) {
        <div class="tile" role="listitem" [class.warn]="t.warn">
          <span>{{ t.label }}</span>
          <strong>{{ t.value }}</strong>
        </div>
      }
    </div>
  `,
  styles: `
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 12px;
      margin: 8px 0 20px;
    }
    .tile {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 12px;
      background: var(--mat-sys-surface-container);
    }
    .tile span {
      font-size: 13px;
      opacity: 0.8;
    }
    .tile strong {
      font-size: 22px;
      font-weight: 600;
    }
    .tile.warn strong {
      color: var(--mat-sys-error);
    }
  `,
})
export class CatalogStatsComponent {
  readonly view = input.required<CatalogStatsView>();
  private readonly db = inject(LocalDbService).db;

  protected readonly tiles = toSignal(
    toObservable(this.view).pipe(switchMap((view) => from(liveQuery(() => this.compute(view))))),
    { initialValue: [] as Tile[] },
  );

  private async compute(view: CatalogStatsView): Promise<Tile[]> {
    switch (view) {
      case 'articles':
        return this.articles();
      case 'kits':
        return this.kits();
      case 'categories':
        return this.categories();
      case 'levels':
        return this.levels();
      case 'labels':
        return this.labels();
      case 'import':
        return this.importExport();
    }
  }

  /** Articles hors kits (les kits ont leur propre page). */
  private async catalogArticles(): Promise<SyncedRow[]> {
    return alive(await this.db.articles.toArray()).filter((a) => a['type'] !== 'KIT');
  }

  private async articles(): Promise<Tile[]> {
    const all = await this.catalogArticles();
    const active = all.filter((a) => a['is_active']);
    const byType = (type: string) => active.filter((a) => a['type'] === type).length;

    // Stock total par article (tous dépôts), pour les ruptures et stocks bas.
    const stock = new Map<string, number>();
    for (const s of alive(await this.db.stock_levels.toArray())) {
      const id = String(s['article']);
      stock.set(id, (stock.get(id) ?? 0) + Number(s['quantity'] ?? 0));
    }
    const stocked = active.filter((a) => a['type'] !== 'SERVICE');
    const out = stocked.filter((a) => (stock.get(a.id) ?? 0) <= 0).length;
    const low = stocked.filter((a) => {
      const qty = stock.get(a.id) ?? 0;
      const threshold = Number(a['alert_threshold'] ?? 0);
      return qty > 0 && threshold > 0 && qty <= threshold;
    }).length;

    return [
      { label: 'Articles actifs', value: fmt(active.length) },
      { label: 'Simples', value: fmt(byType('SIMPLE')) },
      { label: 'Lots', value: fmt(byType('LOT')) },
      { label: 'Services', value: fmt(byType('SERVICE')) },
      { label: 'En rupture', value: fmt(out), warn: out > 0 },
      { label: 'Stock bas', value: fmt(low), warn: low > 0 },
      { label: 'Inactifs', value: fmt(all.length - active.length) },
    ];
  }

  private async kits(): Promise<Tile[]> {
    const kits = alive(await this.db.kits.toArray());
    const activeArticles = new Set(alive(await this.db.articles.toArray()).filter((a) => a['is_active']).map((a) => a.id));
    const active = kits.filter((k) => activeArticles.has(String(k['article'])));
    const levels = alive(await this.db.levels.toArray()).filter((l) => l['is_active']);
    const covered = new Set(active.map((k) => String(k['level'])));
    const uncovered = levels.filter((l) => !covered.has(l.id)).length;

    return [
      { label: 'Kits actifs', value: fmt(active.length) },
      { label: 'Kits virtuels', value: fmt(active.filter((k) => k['stock_mode'] === 'VIRTUAL').length) },
      { label: 'Pré-assemblés', value: fmt(active.filter((k) => k['stock_mode'] === 'ASSEMBLED').length) },
      { label: 'Listes génériques', value: fmt(active.filter((k) => !k['school']).length) },
      { label: 'Listes par établissement', value: fmt(active.filter((k) => !!k['school']).length) },
      { label: 'Niveaux couverts', value: `${fmt(covered.size)} / ${fmt(levels.length)}` },
      { label: 'Niveaux sans kit', value: fmt(uncovered), warn: uncovered > 0 },
      { label: 'Inactifs', value: fmt(kits.length - active.length) },
    ];
  }

  private async categories(): Promise<Tile[]> {
    const categories = alive(await this.db.categories.toArray());
    const articles = (await this.catalogArticles()).filter((a) => a['is_active']);
    const withoutCategory = articles.filter((a) => !a['category']).length;

    return [
      { label: 'Catégories principales', value: fmt(categories.filter((c) => !c['parent']).length) },
      { label: 'Sous-catégories', value: fmt(categories.filter((c) => !!c['parent']).length) },
      { label: 'Inactives', value: fmt(categories.filter((c) => !c['is_active']).length) },
      { label: 'Articles sans catégorie', value: fmt(withoutCategory), warn: withoutCategory > 0 },
    ];
  }

  private async levels(): Promise<Tile[]> {
    const levels = alive(await this.db.levels.toArray()).filter((l) => l['is_active']);
    const schools = alive(await this.db.schools.toArray()).filter((s) => s['is_active']);
    const years = alive(await this.db.school_years.toArray());
    const current = years.find((y) => y['is_current']);

    return [
      { label: 'Niveaux actifs', value: fmt(levels.length) },
      { label: 'Établissements', value: fmt(schools.length) },
      { label: 'Années scolaires', value: fmt(years.length) },
      { label: 'Année en cours', value: current ? String(current['label']) : '—', warn: !current },
    ];
  }

  private async labels(): Promise<Tile[]> {
    const articles = (await this.catalogArticles()).filter((a) => a['is_active'] && a['type'] !== 'SERVICE');
    const barcodes = alive(await this.db.barcodes.toArray());
    const withCode = new Set(barcodes.map((b) => String(b['article'])));
    const without = articles.filter((a) => !withCode.has(a.id)).length;

    return [
      { label: 'Articles avec code-barres', value: fmt(articles.length - without) },
      { label: 'Sans code-barres', value: fmt(without), warn: without > 0 },
      { label: 'Codes fabricant (EAN-13)', value: fmt(barcodes.filter((b) => b['kind'] === 'EAN13').length) },
      { label: 'Codes internes', value: fmt(barcodes.filter((b) => b['kind'] === 'INTERNAL').length) },
    ];
  }

  private async importExport(): Promise<Tile[]> {
    return [
      { label: 'Articles', value: fmt((await this.catalogArticles()).length) },
      { label: 'Kits', value: fmt(alive(await this.db.kits.toArray()).length) },
      { label: 'Catégories', value: fmt(alive(await this.db.categories.toArray()).length) },
      { label: 'Marques', value: fmt(alive(await this.db.brands.toArray()).length) },
    ];
  }
}
