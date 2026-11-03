import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, ElementRef, inject, OnInit, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ActivatedRoute } from '@angular/router';
import {
  ArticleLookup,
  AuthService,
  LocalDbService,
  LocalRecord,
  NetworkStatusService,
  OutboxService,
  SyncEngineService,
  SyncedRow,
} from '@librairie/shared';

import { ArticlePickerComponent } from '../catalog/article-picker.component';

export interface CountTotal {
  article: string;
  name: string;
  code: string;
  round1: number;
  round2: number;
  entries: number;
}

/** Totaux par article des comptages saisis sur ce terminal (tour 1 additionné, tour 2 = recomptage). */
export function countTotals(counts: LocalRecord[]): CountTotal[] {
  const totals = new Map<string, CountTotal>();
  for (const count of counts) {
    const key = String(count['article']);
    const total = totals.get(key) ?? { article: key, name: String(count['article_name'] ?? ''),
      code: String(count['article_code'] ?? ''), round1: 0, round2: 0, entries: 0 };
    if (Number(count['round']) === 2) {
      total.round2 += Number(count['quantity']);
    } else {
      total.round1 += Number(count['quantity']);
    }
    total.entries += 1;
    totals.set(key, total);
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name, 'fr'));
}

/** Un inventoriste ne voit que les inventaires qui lui sont affectés (ou sans affectation). */
export function sessionsForUser(sessions: SyncedRow[], username: string | undefined): SyncedRow[] {
  return sessions.filter((s) => {
    const assignments = (s['assignments'] as { user: string }[] | undefined) ?? [];
    return assignments.length === 0 || assignments.some((a) => a.user === username);
  });
}

/**
 * Comptage d'inventaire par scan ou recherche, utilisable hors connexion : chaque comptage est
 * stocké localement et envoyé au serveur via la file de synchronisation (`inventory_count.create`).
 */
@Component({
  selector: 'bo-counting-page',
  imports: [DatePipe, FormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatButtonModule, MatIconModule, ArticlePickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Mes comptages</h1>
    @if (!network.online()) { <p class="offline-note">Hors ligne : les comptages sont conservés sur ce terminal et envoyés au retour du réseau.</p> }
    @if (sessions().length === 0) {
      <p>Aucun inventaire en cours ne vous est affecté. Synchronisez le terminal si un inventaire vient d'être démarré.</p>
    } @else {
      <mat-card appearance="outlined">
        <mat-card-content>
          <div class="form-grid">
            <mat-form-field class="wide"><mat-label>Inventaire</mat-label>
              <mat-select [ngModel]="sessionId()" (ngModelChange)="selectSession($event)">
                @for (s of sessions(); track s.id) { <mat-option [value]="s.id">{{ s['number'] }} · {{ s['name'] }}</mat-option> }
              </mat-select>
              @if (zone()) { <mat-hint>Zone : {{ zone() }}</mat-hint> }
            </mat-form-field>
            @if (current()?.['counting_mode'] === 'DOUBLE') {
              <mat-button-toggle-group [ngModel]="round()" (ngModelChange)="round.set($event)" aria-label="Tour de comptage">
                <mat-button-toggle [value]="1">1er comptage</mat-button-toggle>
                <mat-button-toggle [value]="2">Recomptage</mat-button-toggle>
              </mat-button-toggle-group>
            }
          </div>
          @if (article(); as a) {
            <div class="count-entry">
              <p><strong>{{ a.name }}</strong> <code>{{ a.code }}</code>
                @if (!inScope(a.id)) { <br /><small class="error">Hors périmètre : sera ajouté à l'inventaire.</small> }</p>
              <mat-form-field><mat-label>Quantité comptée</mat-label>
                <input matInput type="number" min="0" [(ngModel)]="quantity" (keydown.enter)="save()" #qty />
              </mat-form-field>
              <mat-form-field><mat-label>Emplacement (facultatif)</mat-label><input matInput [(ngModel)]="location" /></mat-form-field>
              <button mat-flat-button (click)="save()" [disabled]="quantity === null || quantity < 0"><mat-icon>check</mat-icon> Enregistrer</button>
              <button mat-button (click)="article.set(null)">Annuler</button>
            </div>
          } @else {
            <bo-article-picker label="Scanner ou rechercher l'article compté" (picked)="pick($event)" />
          }
        </mat-card-content>
      </mat-card>

      <h2>Comptages saisis sur ce terminal ({{ counts().length }})</h2>
      <table class="list">
        <thead><tr><th>Article</th><th class="num">Comptage</th>@if (current()?.['counting_mode'] === 'DOUBLE') { <th class="num">Recomptage</th> }<th class="num">Saisies</th></tr></thead>
        <tbody>
          @for (t of totals(); track t.article) {
            <tr><td>{{ t.name }} <small class="muted">{{ t.code }}</small></td><td class="num">{{ t.round1 }}</td>
              @if (current()?.['counting_mode'] === 'DOUBLE') { <td class="num">{{ t.round2 || '—' }}</td> }
              <td class="num">{{ t.entries }}</td></tr>
          } @empty { <tr><td colspan="4" class="empty">Aucun comptage.</td></tr> }
        </tbody>
      </table>
      <h3>Dernières saisies</h3>
      <ul class="journal">
        @for (c of recent(); track c.id) {
          <li>{{ c.createdAt | date: 'HH:mm:ss' }} · {{ c['article_name'] }} : {{ c['quantity'] }}@if (c['round'] === 2) { (recomptage) }@if (c['location']) { · {{ c['location'] }} }</li>
        }
      </ul>
    }
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `.form-grid { display: flex; gap: 16px; flex-wrap: wrap; align-items: center; }
    .form-grid .wide { flex: 1 1 320px; }
    .count-entry { display: flex; gap: 12px; flex-wrap: wrap; align-items: center; }
    .journal { font-size: 0.9em; max-height: 240px; overflow: auto; }`,
})
export class CountingPage implements OnInit {
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncEngineService);
  private readonly snack = inject(MatSnackBar);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  protected readonly network = inject(NetworkStatusService);

  protected readonly sessions = signal<SyncedRow[]>([]);
  protected readonly sessionId = signal<string | null>(null);
  protected readonly round = signal(1);
  protected readonly article = signal<ArticleLookup | null>(null);
  protected readonly counts = signal<LocalRecord[]>([]);
  protected readonly current = computed(() => this.sessions().find((s) => s.id === this.sessionId()) ?? null);
  protected readonly totals = computed(() => countTotals(this.counts()));
  protected readonly recent = computed(() => [...this.counts()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 15));
  protected readonly zone = computed(() => {
    const assignments = (this.current()?.['assignments'] as { user: string; zone: string }[] | undefined) ?? [];
    return assignments.find((a) => a.user === this.auth.user()?.username)?.zone ?? '';
  });
  protected quantity: number | null = 1;
  protected location = '';
  private readonly qtyInput = viewChild<ElementRef<HTMLInputElement>>('qty');

  constructor() {
    // Après un scan, le curseur passe directement sur la quantité (saisie au clavier puis Entrée).
    effect(() => {
      const input = this.qtyInput()?.nativeElement;
      if (input) {
        setTimeout(() => { input.focus(); input.select(); });
      }
    });
  }

  async ngOnInit(): Promise<void> {
    if (this.network.online()) {
      await this.sync.syncNow().catch(() => undefined);
    }
    const rows = await this.local.db.inventory_sessions.filter((s) => !s.is_deleted).toArray();
    const mine = sessionsForUser(rows, this.auth.user()?.username);
    this.sessions.set(mine);
    const wanted = this.route.snapshot.queryParamMap.get('session');
    const initial = mine.find((s) => s.id === wanted) ?? mine[0];
    if (initial) {
      await this.selectSession(initial.id);
    }
  }

  protected async selectSession(id: string): Promise<void> {
    this.sessionId.set(id);
    this.round.set(1);
    this.counts.set(await this.local.db.local_counts.where('session').equals(id).toArray());
  }

  protected inScope(articleId: string): boolean {
    return ((this.current()?.['articles'] as string[] | undefined) ?? []).includes(articleId);
  }

  protected pick(article: ArticleLookup): void {
    this.article.set(article);
    this.quantity = 1;

  }

  protected async save(): Promise<void> {
    const article = this.article();
    const session = this.current();
    const quantity = Number(this.quantity);
    if (!article || !session || !Number.isInteger(quantity) || quantity < 0) {
      this.snack.open('Saisissez une quantité entière positive ou nulle.', 'Fermer');
      return;
    }
    const id = crypto.randomUUID();
    const payload = { id, session: session.id, article: article.id, quantity, round: this.round(),
      location: this.location.trim() };
    await this.outbox.enqueue('inventory_count', 'create', payload, {
      label: `Comptage ${session['number']} : ${article.name} (${quantity})`,
    });
    const record: LocalRecord = { ...payload, createdAt: Date.now(), article_name: article.name, article_code: article.code };
    await this.local.db.local_counts.add(record);
    this.counts.update((list) => [...list, record]);
    this.article.set(null);
    await this.sync.refreshCounts();
    if (this.network.online()) {
      void this.sync.syncNow();
    }
    this.snack.open(`${article.name} : ${quantity} enregistré.`, undefined, { duration: 1500 });
  }
}
