import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

import { ShopInfoService } from '../../services/shop-info.service';

@Component({
  selector: 'bt-home-page',
  imports: [RouterLink, MatButtonModule, MatCardModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <h1>Bienvenue chez {{ shop.info()?.name ?? 'votre librairie' }}</h1>
      <p>Commandez vos fournitures et kits scolaires en ligne, retirez-les en librairie.</p>
      <a mat-flat-button routerLink="/catalogue">Voir le catalogue</a> <a mat-stroked-button routerLink="/kits">Choisir un kit scolaire</a>
    </section>
    <section class="steps">
      <mat-card appearance="outlined">
        <mat-card-content><mat-icon>school</mat-icon><h3>Choisissez</h3>
          <p>Sélectionnez le kit de votre établissement et de votre niveau, ou des articles à l'unité.</p></mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content><mat-icon>notifications_active</mat-icon><h3>Soyez prévenu</h3>
          <p>Nous vous avertissons dès que votre commande est prête.</p></mat-card-content>
      </mat-card>
      <mat-card appearance="outlined">
        <mat-card-content><mat-icon>qr_code_2</mat-icon><h3>Retirez</h3>
          <p>Présentez votre code de retrait en librairie et réglez sur place.</p></mat-card-content>
      </mat-card>
    </section>
  `,
  styles: `
    .hero {
      padding: 32px 0;
      text-align: center;
    }
    .hero h1 {
      font-size: clamp(24px, 5vw, 40px);
      margin-bottom: 8px;
    }
    .steps {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 16px;
    }
    mat-icon {
      color: var(--mat-sys-primary);
      font-size: 32px;
      width: 32px;
      height: 32px;
    }
  `,
})
export class HomePage {
  protected readonly shop = inject(ShopInfoService);
}
