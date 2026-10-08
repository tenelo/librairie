import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService, CatalogApiService, Category, NetworkStatusService, apiErrorMessage } from '@librairie/shared';

export interface CategoryNode {
  category: Category;
  depth: number;
}

/** Aplatit l'arbre des catégories dans l'ordre d'affichage (parents puis enfants triés). */
export function flattenCategories(categories: Category[]): CategoryNode[] {
  const byParent = new Map<string | null, Category[]>();
  for (const category of categories) {
    const list = byParent.get(category.parent) ?? [];
    list.push(category);
    byParent.set(category.parent, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'fr'));
  }
  const result: CategoryNode[] = [];
  const visit = (parent: string | null, depth: number) => {
    for (const category of byParent.get(parent) ?? []) {
      result.push({ category, depth });
      visit(category.id, depth + 1);
    }
  };
  visit(null, 0);
  return result;
}

@Component({
  selector: 'bo-categories-page',
  imports: [FormsModule, MatButtonModule, MatIconModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule,
    MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Catégories</h1>
    </header>
    @if (canManage) {
      <div class="filters">
        <mat-form-field subscriptSizing="dynamic" class="search">
          <mat-label>Nouvelle catégorie principale</mat-label>
          <input matInput [(ngModel)]="newName" (keydown.enter)="add(null)" />
        </mat-form-field>
        <button mat-flat-button type="button" (click)="add(null)" [disabled]="!newName.trim() || !network.online()">
          <mat-icon>add</mat-icon> Ajouter
        </button>
      </div>
    }
    <ul class="tree">
      @for (node of nodes(); track node.category.id) {
        <li [style.padding-left.px]="node.depth * 28" [class.inactive]="!node.category.is_active">
          @if (editing() === node.category.id) {
            <mat-form-field subscriptSizing="dynamic">
              <mat-label>Nom</mat-label>
              <input matInput [(ngModel)]="editName" (keydown.enter)="rename(node.category)" />
            </mat-form-field>
            <button mat-icon-button type="button" (click)="rename(node.category)" aria-label="Valider"><mat-icon>check</mat-icon></button>
            <button mat-icon-button type="button" (click)="editing.set(null)" aria-label="Annuler"><mat-icon>close</mat-icon></button>
          } @else {
            <mat-icon class="folder">{{ node.depth ? 'subdirectory_arrow_right' : 'folder' }}</mat-icon>
            <span class="name">{{ node.category.name }}</span>
            <small class="muted">{{ node.category.article_count }} article(s)</small>
            @if (canManage) {
              <span class="spacer"></span>
              <button mat-icon-button type="button" matTooltip="Sous-catégorie" (click)="startChild(node.category)">
                <mat-icon>create_new_folder</mat-icon>
              </button>
              <button mat-icon-button type="button" matTooltip="Renommer" (click)="startEdit(node.category)">
                <mat-icon>edit</mat-icon>
              </button>
              <button mat-icon-button type="button" matTooltip="Monter" (click)="reorder(node.category, -1)">
                <mat-icon>arrow_upward</mat-icon>
              </button>
              <button mat-icon-button type="button" matTooltip="Descendre" (click)="reorder(node.category, 1)">
                <mat-icon>arrow_downward</mat-icon>
              </button>
              <mat-slide-toggle [checked]="node.category.is_active" (change)="toggleActive(node.category)"
                                [matTooltip]="node.category.is_active ? 'Désactiver' : 'Activer'" />
              <button mat-icon-button type="button" matTooltip="Supprimer" (click)="remove(node.category)">
                <mat-icon>delete</mat-icon>
              </button>
            }
          }
          @if (addingChildTo() === node.category.id) {
            <div class="child-form">
              <mat-form-field subscriptSizing="dynamic">
                <mat-label>Sous-catégorie de {{ node.category.name }}</mat-label>
                <input matInput [(ngModel)]="childName" (keydown.enter)="add(node.category.id)" />
              </mat-form-field>
              <button mat-stroked-button type="button" (click)="add(node.category.id)">Ajouter</button>
            </div>
          }
        </li>
      } @empty {
        <li class="muted">Aucune catégorie.</li>
      }
    </ul>
  `,
  styleUrl: './catalog-page.scss',
  styles: `
    .tree {
      list-style: none;
      padding: 0;
      margin: 0;
    }
    .tree li {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 48px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .name {
      font-weight: 500;
    }
    .folder {
      color: var(--mat-sys-primary);
    }
    .spacer {
      flex: 1;
    }
    .child-form {
      flex-basis: 100%;
      display: flex;
      gap: 8px;
      align-items: center;
      padding: 8px 0 8px 36px;
    }
  `,
})
export class CategoriesPage {
  private readonly api = inject(CatalogApiService);
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('catalog.manage');

  protected readonly categories = signal<Category[]>([]);
  protected readonly nodes = computed(() => flattenCategories(this.categories()));
  protected readonly editing = signal<string | null>(null);
  protected readonly addingChildTo = signal<string | null>(null);
  protected newName = '';
  protected editName = '';
  protected childName = '';

  constructor() {
    this.load();
  }

  protected startEdit(category: Category): void {
    this.editName = category.name;
    this.editing.set(category.id);
  }

  protected startChild(category: Category): void {
    this.childName = '';
    this.addingChildTo.set(this.addingChildTo() === category.id ? null : category.id);
  }

  protected add(parent: string | null): void {
    const name = (parent ? this.childName : this.newName).trim();
    if (!name) {
      return;
    }
    const siblings = this.categories().filter((c) => c.parent === parent);
    const sortOrder = siblings.reduce((max, c) => Math.max(max, c.sort_order), 0) + 10;
    this.api.saveCategory({ name, parent, sort_order: sortOrder }).subscribe({
      next: () => {
        this.newName = '';
        this.childName = '';
        this.addingChildTo.set(null);
        this.load();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected rename(category: Category): void {
    this.api.saveCategory({ id: category.id, name: this.editName.trim() }).subscribe({
      next: () => {
        this.editing.set(null);
        this.load();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected toggleActive(category: Category): void {
    this.api.saveCategory({ id: category.id, is_active: !category.is_active }).subscribe({
      next: () => this.load(),
      error: (err: unknown) => this.fail(err),
    });
  }

  /** Échange l'ordre avec la catégorie sœur voisine. */
  protected reorder(category: Category, offset: number): void {
    const siblings = flattenCategories(this.categories())
      .map((n) => n.category)
      .filter((c) => c.parent === category.parent);
    const index = siblings.findIndex((c) => c.id === category.id);
    const other = siblings[index + offset];
    if (!other) {
      return;
    }
    const first = { id: category.id, sort_order: (index + offset + 1) * 10 };
    const second = { id: other.id, sort_order: (index + 1) * 10 };
    this.api.saveCategory(first).subscribe({
      next: () => this.api.saveCategory(second).subscribe({ next: () => this.load(), error: (e: unknown) => this.fail(e) }),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected remove(category: Category): void {
    if (!confirm(`Supprimer la catégorie « ${category.name} » ?`)) {
      return;
    }
    this.api.deleteCategory(category.id).subscribe({
      next: () => this.load(),
      error: (err: unknown) => this.fail(err),
    });
  }

  private load(): void {
    this.api.listCategories().subscribe({
      next: (categories) => this.categories.set(categories),
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
