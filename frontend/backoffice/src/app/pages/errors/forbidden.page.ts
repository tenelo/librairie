import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'bo-forbidden-page',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="error-page">
      <mat-icon>block</mat-icon>
      <h1>Accès refusé</h1>
      <p>Votre rôle ne permet pas d'accéder à cette page. Contactez un administrateur si nécessaire.</p>
      <a mat-flat-button routerLink="/">Retour au tableau de bord</a>
    </div>
  `,
  styleUrl: './error-page.scss',
})
export class ForbiddenPage {}
