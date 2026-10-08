import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import {
  AssemblyOperation,
  CatalogApiService,
  Depot,
  DeviceService,
  Kit,
  KitAssembly,
  NetworkStatusService,
  StockApiService,
  apiErrorMessage,
  defaultDepotId,
} from '@librairie/shared';

/** Assemblage (préparation de la rentrée) et désassemblage des kits pré-assemblés. */
@Component({
  selector: 'bo-assembly-page',
  imports: [ReactiveFormsModule, DatePipe, MatCardModule, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonToggleModule, MatButtonModule, MatTableModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Assemblage de kits</h1>
    <mat-card appearance="outlined">
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-button-toggle-group formControlName="operation" aria-label="Opération">
            <mat-button-toggle value="ASSEMBLE">Assembler</mat-button-toggle>
            <mat-button-toggle value="DISASSEMBLE">Désassembler</mat-button-toggle>
          </mat-button-toggle-group>
          <div class="form-grid">
            <mat-form-field class="wide">
              <mat-label>Kit pré-assemblé</mat-label>
              <mat-select formControlName="kit">
                @for (k of kits(); track k.id) {
                  <mat-option [value]="k.id">{{ k.name }} — {{ k.level_label }}</mat-option>
                }
              </mat-select>
              @if (!kits().length) {
                <mat-hint>Aucun kit en mode « pré-assemblé » : changez le mode dans la fiche du kit.</mat-hint>
              }
            </mat-form-field>
            <mat-form-field>
              <mat-label>Dépôt</mat-label>
              <mat-select formControlName="depot">
                @for (d of depots(); track d.id) {
                  <mat-option [value]="d.id">{{ d.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field>
              <mat-label>Nombre de kits</mat-label>
              <input matInput type="number" min="1" formControlName="quantity" />
            </mat-form-field>
            <mat-form-field class="wide">
              <mat-label>Note</mat-label>
              <input matInput formControlName="note" />
            </mat-form-field>
          </div>
          @if (selected(); as kit) {
            <p class="muted">
              {{ form.controls.operation.value === 'ASSEMBLE' ? 'Consomme' : 'Restitue' }} par kit :
              @for (c of mandatory(kit); track c.article; let last = $last) {
                {{ c.quantity }} × {{ c.article_name }}{{ last ? '' : ', ' }}
              }
              (articles facultatifs exclus). Stock actuel du kit : {{ kit.availability }}.
            </p>
          }
          <div class="actions">
            <button mat-flat-button type="submit" [disabled]="form.invalid || saving() || !network.online()">Valider</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>

    <h2>Historique</h2>
    <table mat-table [dataSource]="history()">
      <ng-container matColumnDef="number">
        <th mat-header-cell *matHeaderCellDef>N°</th>
        <td mat-cell *matCellDef="let a">{{ a.number }}<br /><small class="muted">{{ a.created_at | date: 'dd/MM/yyyy HH:mm' }}</small></td>
      </ng-container>
      <ng-container matColumnDef="operation">
        <th mat-header-cell *matHeaderCellDef>Opération</th>
        <td mat-cell *matCellDef="let a">{{ a.operation_label }}</td>
      </ng-container>
      <ng-container matColumnDef="kit">
        <th mat-header-cell *matHeaderCellDef>Kit</th>
        <td mat-cell *matCellDef="let a">{{ a.quantity }} × {{ a.kit_name }} ({{ a.depot_code }})</td>
      </ng-container>
      <ng-container matColumnDef="user">
        <th mat-header-cell *matHeaderCellDef>Par</th>
        <td mat-cell *matCellDef="let a">{{ a.user_name }}<br /><small class="muted">{{ a.note }}</small></td>
      </ng-container>
      <tr mat-header-row *matHeaderRowDef="columns"></tr>
      <tr mat-row *matRowDef="let row; columns: columns"></tr>
      <tr class="mat-row" *matNoDataRow><td class="mat-cell empty" [attr.colspan]="columns.length">Aucune opération.</td></tr>
    </table>
  `,
  styleUrl: '../catalog/catalog-page.scss',
})
export class AssemblyPage {
  private readonly api = inject(StockApiService);
  private readonly catalog = inject(CatalogApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly device = inject(DeviceService).device;
  protected readonly network = inject(NetworkStatusService);

  protected readonly columns = ['number', 'operation', 'kit', 'user'];
  protected readonly kits = signal<Kit[]>([]);
  protected readonly depots = signal<Depot[]>([]);
  protected readonly history = signal<KitAssembly[]>([]);
  protected readonly saving = signal(false);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    operation: ['ASSEMBLE' as AssemblyOperation],
    kit: ['', Validators.required],
    depot: ['', Validators.required],
    quantity: [10, [Validators.required, Validators.min(1)]],
    note: [''],
  });
  private readonly kitId = signal('');
  protected readonly selected = computed(() => this.kits().find((k) => k.id === this.kitId()) ?? null);

  constructor() {
    this.form.controls.kit.valueChanges.subscribe((id) => this.kitId.set(id));
    this.api.listDepots().subscribe((depots) => {
      this.depots.set(depots.filter((d) => d.is_active));
      this.form.patchValue({ depot: defaultDepotId(depots, this.device()?.depot) ?? '' });
    });
    this.loadKits();
    this.loadHistory();
  }

  protected mandatory(kit: Kit) {
    return kit.components.filter((c) => !c.is_optional);
  }

  protected submit(): void {
    const value = this.form.getRawValue();
    this.saving.set(true);
    this.api.assemble(value.kit, value.depot, value.operation, Number(value.quantity), value.note).subscribe({
      next: (assembly) => {
        this.saving.set(false);
        this.snack.open(`${assembly.operation_label} de ${assembly.quantity} kit(s) enregistré (${assembly.number}).`);
        this.loadKits();
        this.loadHistory();
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 8000 });
      },
    });
  }

  private loadKits(): void {
    this.catalog.listKits({ stock_mode: 'ASSEMBLED', is_active: true, page_size: 500 })
      .subscribe((page) => this.kits.set(page.results));
  }

  private loadHistory(): void {
    this.api.listAssemblies({ page_size: 50 }).subscribe((page) => this.history.set(page.results));
  }
}
