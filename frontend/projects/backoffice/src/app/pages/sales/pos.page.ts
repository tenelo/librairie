import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  AuthService,
  CartLine,
  CartPayment,
  FcfaPipe,
  LocalDbService,
  NetworkStatusService,
  OfflineDataService,
  PricedArticle,
  PrinterService,
  SyncedRow,
  apiErrorMessage,
  cartTotals,
  lineTotal,
  parsePickupCode,
  unitPrice,
} from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

import { OrdersApiService } from '../orders/orders-api.service';

import { CashRegisterService } from './cash-register.service';
import { KitComponentView, KitCustomizeDialogComponent, KitCustomizeResult } from './kit-customize-dialog.component';
import { ManagerAuthDialogComponent } from './manager-auth-dialog.component';
import { PaymentDialogComponent } from './payment-dialog.component';
import { PosService } from './pos.service';
import { QuickCustomerDialogComponent } from './quick-customer-dialog.component';

export function toPriced(row: SyncedRow): PricedArticle {
  return {
    id: row.id, code: String(row['code']), name: String(row['name']), type: String(row['type']),
    retail_price: Number(row['retail_price'] ?? 0),
    wholesale_price: row['wholesale_price'] === null || row['wholesale_price'] === undefined ? null
      : Number(row['wholesale_price']),
    wholesale_min_qty: row['wholesale_min_qty'] ? Number(row['wholesale_min_qty']) : null,
    avg_cost: Number(row['avg_cost'] ?? 0),
  };
}

/**
 * Écran de caisse, entièrement utilisable hors connexion : recherche, scan (douchette ou saisie),
 * favoris, kits par niveau, remises, client, paiements multiples, impression immédiate du reçu.
 * Raccourcis : F2 recherche, F4 mise en attente, F8 client, F9 encaisser.
 */
@Component({
  selector: 'bo-pos-page',
  imports: [FormsModule, RouterLink, MatButtonModule, MatIconModule, MatChipsModule, MatMenuModule, MatTooltipModule,
    FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pos.page.html',
  styleUrl: './pos.page.scss',
  host: {
    '(document:keydown.f2)': 'focusSearch($event)',
    '(document:keydown.f4)': 'shortcut($event, "hold")',
    '(document:keydown.f8)': 'shortcut($event, "customer")',
    '(document:keydown.f9)': 'shortcut($event, "pay")',
  },
})
export class PosPage {
  private readonly local = inject(LocalDbService);
  private readonly offline = inject(OfflineDataService);
  private readonly pos = inject(PosService);
  protected readonly register = inject(CashRegisterService);
  private readonly printer = inject(PrinterService);
  private readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly orders = inject(OrdersApiService);
  private readonly network = inject(NetworkStatusService);
  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchBox');
  /** Commande en ligne en cours de retrait (lignes verrouillées, acompte imputable). */
  protected readonly onlineOrder = signal<{ id: string; number: string; deposit: number } | null>(null);

  protected readonly lines = signal<CartLine[]>([]);
  protected readonly customer = signal<SyncedRow | null>(null);
  protected readonly globalDiscount = signal(0);
  protected readonly pointsUsed = signal(0);
  protected readonly authorizedBy = signal<string | null>(null);
  protected readonly results = signal<SyncedRow[]>([]);
  protected readonly favorites = signal<SyncedRow[]>([]);
  protected readonly levels = signal<SyncedRow[]>([]);
  protected readonly levelKits = signal<SyncedRow[]>([]);
  protected readonly selectedLevel = signal<string | null>(null);
  protected readonly customerResults = signal<SyncedRow[]>([]);
  protected readonly stock = signal<Map<string, number>>(new Map());
  protected readonly pointValue = signal(10);
  protected readonly busy = signal(false);
  protected term = '';
  protected customerTerm = '';
  protected readonly maxDiscount = computed(() => this.auth.user()?.is_superuser ? 100
    : this.auth.user()?.role?.max_discount_percent ?? 0);

  protected readonly totals = computed(() => cartTotals(this.lines(), this.globalDiscount(),
    this.pointsUsed() * this.pointValue()));
  protected readonly needsAuthorization = computed(() => this.totals().discountPercent > this.maxDiscount() + 1e-9);
  protected readonly unitPrice = unitPrice;
  protected readonly lineTotal = lineTotal;

  constructor() {
    void this.init();
  }

  private async init(): Promise<void> {
    await this.register.refresh();
    this.pointValue.set(await this.pos.setting('loyalty_point_value', 10));
    this.levels.set((await this.local.db.levels.toArray()).filter((l) => l['is_active'])
      .sort((a, b) => Number(a['sort_order']) - Number(b['sort_order'])));
    await this.loadFavorites();
    const held = this.route.snapshot.queryParamMap.get('attente');
    if (held) {
      await this.resume(held);
    }
    const order = this.route.snapshot.queryParamMap.get('commande');
    if (order) {
      await this.loadOrder(order, true);
    }
    setTimeout(() => this.searchInput()?.nativeElement.focus(), 100);
  }

  /** Articles fréquents : les plus vendus sur ce terminal, à défaut les premiers du catalogue. */
  private async loadFavorites(): Promise<void> {
    const counts = new Map<string, number>();
    for (const sale of await this.local.db.local_sales.orderBy('createdAt').reverse().limit(300).toArray()) {
      for (const line of (sale['payload'] as { lines: { article: string; quantity: number }[] }).lines) {
        counts.set(line.article, (counts.get(line.article) ?? 0) + line.quantity);
      }
    }
    const ids = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
    let rows = (await this.local.db.articles.bulkGet(ids)).filter((r): r is SyncedRow => !!r && !!r['is_active']);
    if (rows.length < 12) {
      const more = await this.local.db.articles.filter((r) => Boolean(r['is_active']) && !ids.includes(r.id))
        .limit(12 - rows.length).toArray();
      rows = [...rows, ...more];
    }
    this.favorites.set(rows);
    await this.refreshStock();
  }

  protected focusSearch(event: Event): void {
    event.preventDefault();
    this.searchInput()?.nativeElement.focus();
  }

  protected shortcut(event: Event, action: 'hold' | 'customer' | 'pay'): void {
    if (this.dialog.openDialogs.length) {
      return;
    }
    event.preventDefault();
    if (action === 'hold') {
      void this.hold();
    } else if (action === 'customer') {
      document.getElementById('pos-customer')?.focus();
    } else {
      void this.pay();
    }
  }

  protected async search(): Promise<void> {
    const term = this.term.trim();
    if (term.length < 2) {
      this.results.set([]);
      return;
    }
    const found = await this.offline.searchLocal(term, false, 24);
    this.results.set((await this.local.db.articles.bulkGet(found.map((a) => a.id))).filter((r): r is SyncedRow => !!r));
  }

  /** Entrée dans la recherche : un code-barres exact ajoute directement l'article (douchette). */
  protected async onEnter(): Promise<void> {
    const term = this.term.trim();
    const exact = await this.offline.findLocalByCode(term);
    if (exact) {
      const row = await this.local.db.articles.get(exact.id);
      if (row) {
        await this.add(row);
        this.term = '';
        this.results.set([]);
        return;
      }
    }
    await this.search();
    if (this.results().length === 1) {
      await this.add(this.results()[0]);
      this.term = '';
      this.results.set([]);
    }
  }

  protected async showLevel(levelId: string): Promise<void> {
    this.selectedLevel.set(this.selectedLevel() === levelId ? null : levelId);
    const kits = await this.local.db.kits.where('level').equals(levelId).toArray();
    const articles = (await this.local.db.articles.bulkGet(kits.map((k) => String(k['article']))))
      .filter((r): r is SyncedRow => !!r && !!r['is_active']);
    this.levelKits.set(articles);
  }

  protected async add(row: SyncedRow): Promise<void> {
    const article = toPriced(row);
    const existing = this.lines().find((l) => l.article.id === article.id && !l.kitAdjustments);
    if (existing) {
      this.setQuantity(existing, existing.quantity + 1);
    } else {
      this.lines.update((lines) => [...lines, { id: crypto.randomUUID(), article, quantity: 1, customPrice: null,
        discount: 0, kitAdjustments: null, description: article.name }]);
    }
    await this.refreshStock();
  }

  protected setQuantity(line: CartLine, quantity: number): void {
    const value = Math.max(1, Math.trunc(Number(quantity) || 1));
    this.lines.update((lines) => lines.map((l) => (l.id === line.id ? { ...l, quantity: value,
      discount: Math.min(l.discount, value * unitPrice({ ...l, quantity: value }).price) } : l)));
  }

  protected setLineDiscount(line: CartLine, discount: number): void {
    const value = Math.min(Math.max(0, Math.trunc(Number(discount) || 0)), line.quantity * unitPrice(line).price);
    this.lines.update((lines) => lines.map((l) => (l.id === line.id ? { ...l, discount: value } : l)));
    this.authorizedBy.set(null);
  }

  protected setGlobalDiscount(value: number): void {
    this.globalDiscount.set(Math.min(Math.max(0, Math.trunc(Number(value) || 0)), this.totals().subtotal));
    this.authorizedBy.set(null);
  }

  protected setPoints(value: number): void {
    const available = Number(this.customer()?.['loyalty_points'] ?? 0);
    this.pointsUsed.set(Math.min(Math.max(0, Math.trunc(Number(value) || 0)), available));
  }

  protected remove(line: CartLine): void {
    this.lines.update((lines) => lines.filter((l) => l.id !== line.id));
  }

  protected async customize(line: CartLine): Promise<void> {
    const kit = await this.local.db.kits.where('article').equals(line.article.id).first();
    if (!kit) {
      return;
    }
    const components = (await this.local.db.kit_components.where('kit').equals(kit.id).toArray())
      .sort((a, b) => Number(a['sort_order']) - Number(b['sort_order']));
    const ids = components.flatMap((c) => [String(c['article']), ...(c['substitutes'] as string[])]);
    const articles = new Map((await this.local.db.articles.bulkGet(ids)).filter((a): a is SyncedRow => !!a)
      .map((a) => [a.id, a]));
    const view: KitComponentView[] = components.map((c) => ({
      id: c.id, name: String(articles.get(String(c['article']))?.['name'] ?? '?'), quantity: Number(c['quantity']),
      unitPrice: Number(articles.get(String(c['article']))?.['retail_price'] ?? 0),
      substitutes: (c['substitutes'] as string[]).filter((s) => articles.has(s)).map((s) => ({
        id: s, name: String(articles.get(s)?.['name']), unitPrice: Number(articles.get(s)?.['retail_price'] ?? 0) })),
    }));
    const result = await firstValueFrom(this.dialog.open(KitCustomizeDialogComponent, {
      data: { kitName: line.article.name, components: view, current: line.kitAdjustments, pricing: {
        pricingMode: kit['pricing_mode'], discountPercent: String(kit['discount_percent']),
        fixedPrice: line.article.retail_price, rounding: await this.pos.setting('price_rounding', 5) } },
      width: '640px', maxWidth: '96vw',
    }).afterClosed()) as KitCustomizeResult | undefined;
    if (!result) {
      return;
    }
    this.lines.update((lines) => lines.map((l) => (l.id === line.id ? { ...l, kitAdjustments: result.adjustments,
      customPrice: result.adjustments ? result.price : null } : l)));
  }

  protected async searchCustomers(): Promise<void> {
    const term = this.customerTerm.trim().toLowerCase();
    if (term.length < 2) {
      this.customerResults.set([]);
      return;
    }
    this.customerResults.set(await this.local.db.customers.filter((c) => Boolean(c['is_active']) &&
      (String(c['name']).toLowerCase().includes(term) || String(c['phone'] ?? '').replace(/\s/g, '').includes(term)))
      .limit(8).toArray());
  }

  protected chooseCustomer(customer: SyncedRow | null): void {
    this.customer.set(customer);
    this.pointsUsed.set(0);
    this.customerTerm = '';
    this.customerResults.set([]);
  }

  protected async createCustomer(): Promise<void> {
    const created = await firstValueFrom(this.dialog.open(QuickCustomerDialogComponent, {
      data: { name: this.customerTerm }, width: '420px', maxWidth: '95vw' }).afterClosed()) as SyncedRow | undefined;
    if (created) {
      this.chooseCustomer(created);
    }
  }

  private async refreshStock(): Promise<void> {
    const lookup = await this.local.stockLookup(this.register.current()?.depot);
    const map = new Map<string, number>();
    for (const row of [...this.favorites(), ...this.lines().map((l) => ({ id: l.article.id }) as SyncedRow)]) {
      const available = await this.offline.availability(row.id, lookup);
      if (available !== null) {
        map.set(row.id, available);
      }
    }
    this.stock.set(map);
  }

  protected stockOf(articleId: string): number | null {
    return this.stock().has(articleId) ? this.stock().get(articleId)! : null;
  }

  protected async hold(): Promise<void> {
    if (!this.lines().length) {
      return;
    }
    const label = `${this.customer()?.['name'] ?? 'Client de passage'} — ${this.totals().total} FCFA`;
    await this.local.db.held_sales.put({ id: crypto.randomUUID(), label, createdAt: Date.now(),
      cashier: this.auth.user()?.full_name ?? '', state: { lines: this.lines(), customer: this.customer(),
        globalDiscount: this.globalDiscount(), pointsUsed: this.pointsUsed() } });
    this.reset();
    this.snack.open('Vente mise en attente.', 'Voir', { duration: 4000 }).onAction()
      .subscribe(() => void this.router.navigate(['/caisse/en-attente']));
  }

  private async resume(id: string): Promise<void> {
    const held = await this.local.db.held_sales.get(id);
    if (!held) {
      return;
    }
    const state = held.state as { lines: CartLine[]; customer: SyncedRow | null; globalDiscount: number;
      pointsUsed: number };
    this.lines.set(state.lines);
    this.customer.set(state.customer);
    this.globalDiscount.set(state.globalDiscount);
    this.pointsUsed.set(state.pointsUsed);
    await this.local.db.held_sales.delete(id);
    await this.refreshStock();
  }

  /** Retrait d'une commande en ligne : QR code, code à 6 chiffres ou numéro (douchette ou saisie). */
  protected async pickup(): Promise<void> {
    const code = prompt('Scannez le QR code de retrait, ou saisissez le code à 6 chiffres ou le numéro de commande :');
    if (code?.trim()) {
      await this.loadOrder(code.trim(), false);
    }
  }

  private async findOrder(value: string, byId: boolean): Promise<SyncedRow | null> {
    if (this.network.online()) {
      try {
        const order = await firstValueFrom(byId ? this.orders.get(value) : this.orders.lookup(value));
        return order as unknown as SyncedRow;
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404) {
          return null;
        }
        if (status && status < 500) {
          throw error;
        }
      }
    }
    // Hors ligne : commandes prêtes téléchargées sur le terminal.
    const { number, code } = parsePickupCode(value);
    const rows = await this.local.db.online_orders.filter((r) => !r.is_deleted && (byId ? r.id === value
      : (!number || r['number'] === number) && (!code || r['pickup_code'] === code))).toArray();
    return rows.length === 1 ? rows[0] : null;
  }

  private async loadOrder(value: string, byId: boolean): Promise<void> {
    let order: SyncedRow | null;
    try {
      order = await this.findOrder(value, byId);
    } catch (error) {
      this.snack.open(apiErrorMessage(error), 'Fermer', { duration: 8000 });
      return;
    }
    if (!order) {
      this.snack.open('Aucune commande prête ne correspond à ce code.', 'Fermer', { duration: 6000 });
      return;
    }
    if (order['status'] !== 'READY') {
      this.snack.open(`La commande ${order['number']} n'est pas prête au retrait (${order['status_label'] ?? order['status']}).`,
        'Fermer', { duration: 8000 });
      return;
    }
    if (this.lines().length && !confirm('Remplacer le panier en cours par la commande à retirer ?')) {
      return;
    }
    this.reset();
    const orderLines = (order['lines'] as { article: string; description: string; quantity: number; unit_price: number }[])
      .filter((l) => l.quantity > 0);
    const lines: CartLine[] = [];
    for (const line of orderLines) {
      const row = await this.local.db.articles.get(line.article);
      const article: PricedArticle = row ? toPriced(row) : { id: line.article, code: '', name: line.description,
        type: 'SIMPLE', retail_price: line.unit_price, wholesale_price: null, wholesale_min_qty: null, avg_cost: 0 };
      lines.push({ id: crypto.randomUUID(), article, quantity: line.quantity, customPrice: line.unit_price, discount: 0,
        kitAdjustments: null, description: line.description });
    }
    this.lines.set(lines);
    const customerId = String(order['customer']);
    this.customer.set((await this.local.db.customers.get(customerId)) ?? { id: customerId, sync_version: 0,
      is_deleted: false, name: order['customer_name'], phone: order['customer_phone'], loyalty_points: 0 });
    this.onlineOrder.set({ id: order.id, number: String(order['number']), deposit: Number(order['deposit_paid'] ?? 0) });
    await this.refreshStock();
  }

  protected reset(): void {
    this.onlineOrder.set(null);
    this.lines.set([]);
    this.customer.set(null);
    this.globalDiscount.set(0);
    this.pointsUsed.set(0);
    this.authorizedBy.set(null);
    this.term = '';
    this.results.set([]);
  }

  protected async pay(): Promise<void> {
    const session = this.register.current();
    if (!session) {
      this.snack.open('Ouvrez la caisse avant de vendre.', 'Ouvrir', { duration: 5000 }).onAction()
        .subscribe(() => void this.router.navigate(['/caisse/sessions']));
      return;
    }
    if (!this.lines().length || this.busy()) {
      return;
    }
    if (this.needsAuthorization() && !this.authorizedBy()) {
      const manager = await firstValueFrom(this.dialog.open(ManagerAuthDialogComponent, { data: {
        title: 'Autorisation de remise', permission: 'sales.authorize', percent: this.totals().discountPercent,
        reason: `Remise de ${this.totals().discountPercent.toFixed(1)} % : votre plafond est de ${this.maxDiscount()} %.`,
      }, width: '420px', maxWidth: '95vw' }).afterClosed()) as string | undefined;
      if (!manager) {
        return;
      }
      this.authorizedBy.set(manager);
    }
    const methods = (await this.local.db.payment_methods.toArray()).filter((m) => m['is_active'])
      .sort((a, b) => Number(a['sort_order']) - Number(b['sort_order']));
    const customer = this.customer();
    const payments = await firstValueFrom(this.dialog.open(PaymentDialogComponent, { data: {
      total: this.totals().total, methods, hasCustomer: !!customer, deposit: this.onlineOrder()?.deposit ?? 0,
      customerCredit: customer ? { balance: Number(customer['credit_balance'] ?? 0),
        limit: Number(customer['credit_limit'] ?? 0) } : null,
    }, width: '720px', maxWidth: '96vw' }).afterClosed()) as CartPayment[] | undefined;
    if (!payments) {
      return;
    }
    this.busy.set(true);
    try {
      const sale = await this.pos.completeSale({
        lines: this.lines(), payments, customer, globalDiscount: this.globalDiscount(),
        loyaltyPointsUsed: this.pointsUsed(), discountAuthorizedBy: this.authorizedBy(),
        notes: this.onlineOrder() ? `Retrait commande ${this.onlineOrder()!.number}` : '',
        onlineOrder: this.onlineOrder()?.id ?? null,
      }, session, new Map(methods.map((m) => [String(m['code']), String(m['label'])])));
      this.reset();
      const change = sale.display.change;
      this.snack.open(`Vente ${sale.receipt_number} enregistrée${change ? ` — rendre ${change} FCFA` : ''}.`, 'OK',
        { duration: 8000 });
      await this.printer.print(await this.pos.receiptOf(sale));
      await this.loadFavorites();
    } catch (error) {
      this.snack.open(error instanceof Error ? error.message : 'Vente non enregistrée.', 'Fermer', { duration: 8000 });
    } finally {
      this.busy.set(false);
      this.searchInput()?.nativeElement.focus();
    }
  }
}
