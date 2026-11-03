import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  APP_CONFIG,
  AuthService,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  OutboxService,
  SyncEngineService,
  SyncedRow,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

export interface CustomerStatement {
  account: { date: string; kind: string; amount: number; reference: string }[];
  loyalty: { date: string; points: number; reason: string }[];
  credit_notes: { number: string; amount: number; remaining: number }[];
  sales: { id: string; receipt_number: string; sold_at: string; total: number }[];
}

/**
 * Clients : liste (base locale, donc consultable hors connexion), création et modification
 * (envoyées par la synchronisation, conflits arbitrés par « dernier écrit gagne »), relevé en ligne.
 */
@Component({
  selector: 'bo-customers-page',
  imports: [DatePipe, FormsModule, ReactiveFormsModule, MatButtonModule, MatIconModule, MatFormFieldModule,
    MatInputModule, FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-header">
      <h1>Clients</h1>
      @if (canManage) { <button mat-flat-button type="button" (click)="edit(null)"><mat-icon>person_add</mat-icon> Nouveau client</button> }
    </header>
    @if (editing()) {
      <form class="card form-grid" [formGroup]="form" (ngSubmit)="save()">
        <mat-form-field><mat-label>Nom</mat-label><input matInput formControlName="name" /></mat-form-field>
        <mat-form-field><mat-label>Téléphone</mat-label><input matInput formControlName="phone" /></mat-form-field>
        <mat-form-field><mat-label>E-mail</mat-label><input matInput formControlName="email" /></mat-form-field>
        <mat-form-field><mat-label>Adresse</mat-label><input matInput formControlName="address" /></mat-form-field>
        <mat-form-field><mat-label>Plafond de crédit (FCFA)</mat-label><input matInput type="number" min="0" formControlName="credit_limit" /></mat-form-field>
        <div class="actions">
          <button mat-button type="button" (click)="editing.set(null)">Annuler</button>
          <button mat-flat-button type="submit" [disabled]="form.invalid">Enregistrer</button>
        </div>
      </form>
    }
    <div class="toolbar">
      <input type="search" [(ngModel)]="term" (input)="load()" placeholder="Nom ou téléphone" aria-label="Rechercher un client" />
    </div>
    <table class="list">
      <thead><tr><th>Client</th><th class="num">Crédit en cours</th><th class="num">Points</th><th></th></tr></thead>
      <tbody>
        @for (c of customers(); track c.id) {
          <tr>
            <td><strong>{{ c['name'] }}</strong><br /><small class="muted">{{ c['phone'] }} {{ c['email'] }}</small></td>
            <td class="num">{{ $any(c['credit_balance']) | fcfa }} <small class="muted">/ {{ $any(c['credit_limit']) | fcfa }}</small></td>
            <td class="num">{{ c['loyalty_points'] }}</td>
            <td class="num">
              <button mat-icon-button type="button" (click)="showStatement(c)" [disabled]="!network.online()" aria-label="Relevé"><mat-icon>receipt_long</mat-icon></button>
              @if (canManage) { <button mat-icon-button type="button" (click)="edit(c)" aria-label="Modifier"><mat-icon>edit</mat-icon></button> }
            </td>
          </tr>
          @if (statementFor() === c.id && statement(); as st) {
            <tr><td colspan="4">
              <div class="statement">
                <div><h4>Compte</h4>
                  @for (e of st.account; track $index) { <div>{{ e.date | date: 'dd/MM/yy' }} · {{ e.kind }} {{ e.reference }} : {{ e.amount | fcfa }}</div> }
                  @empty { <div class="muted">Aucune écriture.</div> }</div>
                <div><h4>Fidélité</h4>
                  @for (e of st.loyalty; track $index) { <div>{{ e.date | date: 'dd/MM/yy' }} · {{ e.reason }} : {{ e.points }}</div> }
                  @empty { <div class="muted">Aucun point.</div> }</div>
                <div><h4>Dernières ventes</h4>
                  @for (s of st.sales; track s.id) { <div>{{ s.sold_at | date: 'dd/MM/yy' }} · {{ s.receipt_number }} : {{ s.total | fcfa }}</div> }
                  @empty { <div class="muted">Aucune vente.</div> }</div>
              </div>
            </td></tr>
          }
        } @empty {
          <tr><td colspan="4" class="empty">Aucun client (ou base locale pas encore synchronisée).</td></tr>
        }
      </tbody>
    </table>
  `,
  styleUrl: '../sales/sales-page.scss',
  styles: `
    .form-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); column-gap: 12px; }
    .actions { display: flex; justify-content: flex-end; gap: 8px; align-items: center; }
    .statement { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 12px; font-size: 14px; }
  `,
})
export class CustomersPage {
  private readonly local = inject(LocalDbService);
  private readonly outbox = inject(OutboxService);
  private readonly sync = inject(SyncEngineService);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly snack = inject(MatSnackBar);
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('customers.manage');

  protected readonly customers = signal<SyncedRow[]>([]);
  protected readonly editing = signal<SyncedRow | 'new' | null>(null);
  protected readonly statementFor = signal<string | null>(null);
  protected readonly statement = signal<CustomerStatement | null>(null);
  protected term = '';

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', Validators.required],
    phone: [''],
    email: ['', Validators.email],
    address: [''],
    credit_limit: [0, Validators.min(0)],
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const term = this.term.trim().toLowerCase();
    const rows = await this.local.db.customers.filter((c) => !term || String(c['name']).toLowerCase().includes(term) ||
      String(c['phone'] ?? '').includes(term)).limit(200).toArray();
    this.customers.set(rows.sort((a, b) => String(a['name']).localeCompare(String(b['name']), 'fr')));
  }

  protected edit(customer: SyncedRow | null): void {
    this.editing.set(customer ?? 'new');
    this.form.reset({ name: String(customer?.['name'] ?? ''), phone: String(customer?.['phone'] ?? ''),
      email: String(customer?.['email'] ?? ''), address: String(customer?.['address'] ?? ''),
      credit_limit: Number(customer?.['credit_limit'] ?? 0) });
  }

  protected async save(): Promise<void> {
    const current = this.editing();
    const value = this.form.getRawValue();
    if (current === 'new') {
      const id = crypto.randomUUID();
      await this.outbox.enqueue('customer', 'create', { id, ...value }, { label: `Nouveau client ${value.name}` });
      await this.local.db.customers.put({ id, sync_version: 0, is_deleted: false, ...value, credit_balance: 0,
        loyalty_points: 0, is_active: true });
    } else if (current) {
      await this.outbox.enqueue('customer', 'update', { id: current.id, base_version: current.sync_version,
        changes: value }, { label: `Modification du client ${value.name}` });
      await this.local.db.customers.put({ ...current, ...value });
    }
    this.editing.set(null);
    await this.load();
    await this.sync.refreshCounts();
    void this.sync.syncNow();
    this.snack.open('Client enregistré.');
  }

  protected async showStatement(customer: SyncedRow): Promise<void> {
    if (this.statementFor() === customer.id) {
      this.statementFor.set(null);
      return;
    }
    this.statement.set(await firstValueFrom(this.http.get<CustomerStatement>(
      `${this.api}/customers/customers/${customer.id}/statement/`)));
    this.statementFor.set(customer.id);
  }
}
