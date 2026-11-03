import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, input, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { apiErrorMessage } from '@librairie/shared';

import { ReportsApiService, ScheduledReport } from './reports-api.service';

/** Adresses e-mail saisies séparées par des virgules, espaces ou points-virgules. */
export function parseRecipients(raw: string): string[] {
  return raw.split(/[\s,;]+/).map((e) => e.trim()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/** Rapports planifiés (envoi par e-mail) du rapport affiché. */
@Component({
  selector: 'bo-scheduled-reports',
  imports: [DatePipe, FormsModule, MatCardModule, MatButtonModule, MatIconModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <mat-card appearance="outlined" class="block">
      <mat-card-header><mat-card-title>Envoi automatique par e-mail</mat-card-title>
        <mat-card-subtitle>Excel en pièce jointe (et PDF si le serveur le permet).</mat-card-subtitle></mat-card-header>
      <mat-card-content>
        <ul class="schedules">
          @for (s of mine(); track s.id) {
            <li>
              <strong>{{ s.name }}</strong> · {{ s.frequency_label }} à {{ s.send_hour }} h · {{ s.recipients.join(', ') }}
              @if (s.last_sent_at) { <small> · dernier envoi {{ s.last_sent_at | date: 'dd/MM HH:mm' }}</small> }
              @if (s.last_error) { <small class="error"> · {{ s.last_error }}</small> }
              <button mat-button type="button" (click)="toggle(s)">{{ s.is_active ? 'Suspendre' : 'Réactiver' }}</button>
              <button mat-button type="button" (click)="sendNow(s)">Envoyer maintenant</button>
              <button mat-icon-button type="button" (click)="remove(s)" aria-label="Supprimer"><mat-icon>delete</mat-icon></button>
            </li>
          } @empty { <li class="muted">Aucun envoi planifié pour ce rapport.</li> }
        </ul>
        <div class="form">
          <input placeholder="Libellé (ex. Ventes de la semaine)" [(ngModel)]="label" aria-label="Libellé" />
          <select [(ngModel)]="frequency" aria-label="Fréquence">
            <option value="DAILY">Chaque jour (veille)</option>
            <option value="WEEKLY">Chaque lundi (semaine écoulée)</option>
            <option value="MONTHLY">Le 1er du mois (mois écoulé)</option>
          </select>
          <label>à <input type="number" min="0" max="23" [(ngModel)]="hour" class="hour" aria-label="Heure d'envoi" /> h</label>
          <input class="wide" placeholder="Destinataires : e-mails séparés par des virgules" [(ngModel)]="recipients" aria-label="Destinataires" />
          <button mat-flat-button type="button" (click)="add()" [disabled]="!label.trim() || !recipients.trim()">Planifier</button>
        </div>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .block { margin-top: 16px; }
    .schedules { padding-left: 18px; }
    .form { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .form input, .form select { font: inherit; padding: 4px; }
    .form .wide { flex: 1 1 260px; }
    .hour { width: 52px; }
    .muted { opacity: 0.7; }
    .error { color: var(--mat-sys-error); }
  `,
})
export class ScheduledReportsComponent implements OnInit {
  readonly report = input.required<string>();
  readonly depot = input<string | null>(null);
  private readonly api = inject(ReportsApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly all = signal<ScheduledReport[]>([]);
  protected readonly mine = computed(() => this.all().filter((s) => s.report === this.report()));
  protected label = '';
  protected frequency: ScheduledReport['frequency'] = 'WEEKLY';
  protected hour = 7;
  protected recipients = '';

  ngOnInit(): void {
    this.reload();
  }

  private reload(): void {
    this.api.scheduled().subscribe({ next: (page) => this.all.set(page.results), error: () => undefined });
  }

  protected add(): void {
    const emails = parseRecipients(this.recipients);
    if (!emails.length) {
      this.snack.open('Saisissez au moins une adresse e-mail valide.', 'Fermer');
      return;
    }
    this.api.saveScheduled({ name: this.label.trim(), report: this.report(), frequency: this.frequency,
      recipients: emails, filters: this.depot() ? { depot: this.depot()! } : {}, send_hour: this.hour,
      is_active: true }).subscribe({
      next: () => {
        this.label = '';
        this.recipients = '';
        this.snack.open('Envoi planifié.');
        this.reload();
      },
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  protected toggle(s: ScheduledReport): void {
    this.api.saveScheduled({ ...s, is_active: !s.is_active }).subscribe({ next: () => this.reload() });
  }

  protected sendNow(s: ScheduledReport): void {
    this.api.sendScheduled(s.id!).subscribe({
      next: () => this.snack.open(`Rapport envoyé à ${s.recipients.join(', ')}.`),
      error: (err: unknown) => this.snack.open(apiErrorMessage(err), 'Fermer'),
    });
  }

  protected remove(s: ScheduledReport): void {
    if (confirm(`Supprimer l'envoi « ${s.name} » ?`)) {
      this.api.deleteScheduled(s.id!).subscribe({ next: () => this.reload() });
    }
  }
}
