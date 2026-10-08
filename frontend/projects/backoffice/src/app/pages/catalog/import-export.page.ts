import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CatalogApiService, ImportResult, NetworkStatusService, apiErrorMessage, saveBlob } from '@librairie/shared';

type ImportKind = 'articles' | 'kits';

interface ImportState {
  file: File | null;
  result: ImportResult | null;
  busy: boolean;
}

const EMPTY: ImportState = { file: null, result: null, busy: false };

/**
 * Import / export Excel du catalogue et des listes de fournitures.
 * Chaque import commence par une simulation : le fichier n'est appliqué qu'après lecture du rapport.
 */
@Component({
  selector: 'bo-import-export-page',
  imports: [MatCardModule, MatButtonModule, MatIconModule, MatProgressBarModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './import-export.page.html',
  styleUrl: './catalog-page.scss',
  styles: `
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(340px, 1fr));
      gap: 16px;
    }
    .buttons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      margin: 12px 0;
    }
    .report {
      margin-top: 12px;
      padding: 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container);
    }
    .report.ok {
      background: color-mix(in srgb, #2e7d32 15%, transparent);
    }
    .errors {
      max-height: 240px;
      overflow: auto;
      color: var(--mat-sys-error);
      font-size: 14px;
    }
  `,
})
export class ImportExportPage {
  private readonly api = inject(CatalogApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);

  protected readonly state = signal<Record<ImportKind, ImportState>>({ articles: { ...EMPTY }, kits: { ...EMPTY } });
  protected readonly exporting = signal(false);
  protected readonly kinds: ImportKind[] = ['articles', 'kits'];

  protected choose(kind: ImportKind, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    this.patch(kind, { file, result: null });
    if (file) {
      this.run(kind, true);
    }
  }

  protected run(kind: ImportKind, dryRun: boolean): void {
    const file = this.state()[kind].file;
    if (!file) {
      return;
    }
    this.patch(kind, { busy: true });
    this.api.importFile(kind, file, dryRun).subscribe({
      next: (result) => {
        this.patch(kind, { busy: false, result, file: result.applied ? null : file });
        if (result.applied) {
          this.snack.open(`Import terminé : ${result.created} créé(s), ${result.updated} mis à jour.`);
        }
      },
      error: (err: unknown) => {
        this.patch(kind, { busy: false });
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  protected template(kind: ImportKind): void {
    this.api.downloadTemplate(kind).subscribe({
      next: (blob) => saveBlob(blob, kind === 'articles' ? 'modele-articles.xlsx' : 'modele-listes-fournitures.xlsx'),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  protected export(kind: ImportKind): void {
    this.exporting.set(true);
    const request = kind === 'articles' ? this.api.downloadArticles({ is_active: true }) : this.api.downloadKits();
    request.subscribe({
      next: (blob) => {
        this.exporting.set(false);
        saveBlob(blob, kind === 'articles' ? 'articles.xlsx' : 'listes-fournitures.xlsx');
      },
      error: (err: unknown) => {
        this.exporting.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer');
      },
    });
  }

  private patch(kind: ImportKind, changes: Partial<ImportState>): void {
    this.state.update((state) => ({ ...state, [kind]: { ...state[kind], ...changes } }));
  }
}
