import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';

/** Catalogue en ligne : la recherche, les kits par établissement et le panier arrivent en phase 7. */
@Component({
  selector: 'bt-catalog-page',
  imports: [MatCardModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Catalogue</h1>
    <mat-card appearance="outlined">
      <mat-card-content class="content">
        <mat-icon>construction</mat-icon>
        <p>
          Le catalogue en ligne, la sélection de kits par établissement et niveau et le panier sont livrés
          à la phase 7 du projet (boutique et commandes en ligne).
        </p>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .content {
      display: flex;
      gap: 16px;
      align-items: center;
    }
    mat-icon {
      color: var(--mat-sys-primary);
    }
  `,
})
export class CatalogPage {}
