import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, FcfaPipe, NetworkStatusService } from '@librairie/shared';

import { InventoryApiService, InventorySession } from './inventory-api.service';

/** Liste des inventaires : en cours (préparation, comptage, revue) ou historique (validés, clôturés). */
@Component({
  selector: 'bo-inventories-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>{{ history() ? 'Historique des inventaires' : 'Inventaires en cours' }}</h1>
      @if (canCreate && !history()) { <a mat-flat-button routerLink="/inventaires/nouveau"><mat-icon>add</mat-icon> Nouvel inventaire</a> }
    </header>
    @if (!network.online()) { <p class="offline-note">Liste disponible en ligne ; le comptage reste possible hors ligne (Mes comptages).</p> }
    <table class="list">
      <thead><tr><th>Inventaire</th><th>Type / dépôt</th><th>Statut</th><th class="num">Avancement</th><th class="num">Écart valorisé</th></tr></thead>
      <tbody>
        @for (s of sessions(); track s.id) {
          <tr class="clickable" (click)="open(s)">
            <td><strong>{{ s.number }}</strong> {{ s.name }}<br /><small class="muted">créé le {{ s.created_at | date: 'dd/MM/yyyy' }} par {{ s.created_by_name }}</small></td>
            <td>{{ s.kind_label }}<br /><small class="muted">{{ s.depot_name }}</small></td>
            <td>{{ s.status_label }}</td>
            <td class="num">@if ($any(s.summary).articles) { {{ $any(s.summary).counted }} / {{ $any(s.summary).articles }} } @else { — }</td>
            <td class="num">@if ($any(s.summary).articles) { {{ $any(s.summary).variance_value | fcfa }} }</td>
          </tr>
        } @empty {
          <tr><td colspan="5" class="empty">Aucun inventaire.</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
})
export class InventoriesPage implements OnInit {
  private readonly api = inject(InventoryApiService);
  private readonly router = inject(Router);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canCreate = inject(AuthService).hasPermission('inventory.create');
  /** Vrai pour l'écran « Historique et rapports d'écarts » (même composant). */
  protected readonly history = signal(inject(ActivatedRoute).snapshot.routeConfig?.path === 'historique');
  protected readonly sessions = signal<InventorySession[]>([]);

  ngOnInit(): void {
    this.api.list({ page_size: 100 }).subscribe({
      next: (page) => this.sessions.set(page.results.filter((s) => this.history()
        ? ['VALIDATED', 'CLOSED', 'CANCELLED'].includes(s.status)
        : ['DRAFT', 'COUNTING', 'REVIEW'].includes(s.status))),
      error: () => undefined,
    });
  }

  protected open(session: InventorySession): void {
    void this.router.navigate(['/inventaires/sessions', session.id]);
  }
}
