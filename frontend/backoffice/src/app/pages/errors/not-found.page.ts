import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'bo-not-found-page',
  imports: [RouterLink, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="error-page">
      <mat-icon>travel_explore</mat-icon>
      <h1>Page introuvable</h1>
      <p>L'adresse demandée n'existe pas.</p>
      <a mat-flat-button routerLink="/">Retour au tableau de bord</a>
    </div>
  `,
  styleUrl: './error-page.scss',
})
export class NotFoundPage {}
