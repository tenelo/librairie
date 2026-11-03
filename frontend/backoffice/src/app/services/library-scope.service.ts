import { Injectable, computed, inject, signal } from '@angular/core';
import { AuthService, Depot, Library, LibrarySummary, StockApiService } from '@librairie/shared';

/** Choix de périmètre proposé dans les filtres (état des stocks, statistiques). */
export interface LibraryScopeOption {
  /** '' = périmètre par défaut, 'central' = entrepôt général, sinon identifiant de librairie. */
  value: string;
  label: string;
}

/** Valeur d'option désignant l'entrepôt général (dépôts sans librairie). */
export const CENTRAL_WAREHOUSE = 'central';

/**
 * Périmètre « librairie » de l'utilisateur connecté.
 *
 * - L'administrateur (ou un compte sans librairie) voit toutes les librairies.
 * - Un employé voit sa librairie, l'entrepôt général, et les autres librairies seulement
 *   avec la permission « Voir le stock des autres librairies ».
 * Le serveur applique les mêmes règles : ce service ne sert qu'à proposer les bons choix.
 */
@Injectable({ providedIn: 'root' })
export class LibraryScopeService {
  private readonly auth = inject(AuthService);
  private readonly api = inject(StockApiService);

  readonly libraries = signal<Library[]>([]);
  private loaded = false;

  /** Librairie de l'employé (null pour l'administrateur ou un compte non rattaché). */
  readonly myLibrary = computed<LibrarySummary | null>(() => this.auth.user()?.library ?? null);
  /** Vrai si l'utilisateur voit toutes les librairies. */
  readonly seesAll = computed(() => this.myLibrary() === null || this.auth.user()?.all_libraries === true);
  readonly canSeeOtherStock = computed(() => this.seesAll() || this.auth.hasPermission('stock.view_all_libraries'));

  /** Libellé court du périmètre, affiché dans la barre du haut. */
  readonly label = computed(() => (this.seesAll() ? 'Toutes les librairies' : this.myLibrary()?.name ?? ''));

  /** Charge la liste des librairies une seule fois (appelé par les écrans qui en ont besoin). */
  load(): void {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    this.api.listLibraries().subscribe({
      next: (libraries) => this.libraries.set(libraries),
      error: () => (this.loaded = false),
    });
  }

  /** Choix « librairie » pour l'état des stocks. */
  readonly stockOptions = computed<LibraryScopeOption[]>(() => {
    const own = this.myLibrary();
    const options: LibraryScopeOption[] = [];
    if (this.seesAll()) {
      options.push({ value: '', label: 'Toutes (stock global)' });
    } else if (own) {
      options.push({ value: '', label: `Ma librairie (${own.name})` });
    }
    options.push({ value: CENTRAL_WAREHOUSE, label: 'Entrepôt général' });
    if (this.canSeeOtherStock()) {
      for (const library of this.libraries()) {
        if (library.id !== own?.id || this.seesAll()) {
          options.push({ value: library.id, label: library.name });
        }
      }
    }
    return options;
  });

  /** Choix « librairie » pour les statistiques (un employé est limité à la sienne par le serveur). */
  readonly reportOptions = computed<LibraryScopeOption[]>(() => {
    if (!this.seesAll()) {
      return [{ value: '', label: this.myLibrary()?.name ?? '' }];
    }
    return [{ value: '', label: 'Toutes les librairies' },
      ...this.libraries().map((l) => ({ value: l.id, label: l.name }))];
  });

  /** Dépôts correspondant à un choix de périmètre (pour le filtre « Dépôt » qui l'accompagne). */
  depotsFor(depots: Depot[], scope: string): Depot[] {
    if (scope === CENTRAL_WAREHOUSE) {
      return depots.filter((d) => !d.library);
    }
    if (scope) {
      return depots.filter((d) => d.library === scope);
    }
    if (!this.seesAll()) {
      const own = this.myLibrary()?.id;
      return depots.filter((d) => d.library === own);
    }
    return depots;
  }
}
