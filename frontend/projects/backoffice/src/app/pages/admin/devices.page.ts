import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Device, DeviceKind, DeviceService, apiErrorMessage } from '@librairie/shared';

import { AdminApiService } from '../../services/admin-api.service';

/** Enregistrement des terminaux et association du poste courant à l'un d'eux. */
@Component({
  selector: 'bo-devices-page',
  imports: [
    DatePipe,
    ReactiveFormsModule,
    MatTableModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Terminaux</h1>
    <mat-card appearance="outlined" class="this-device">
      <mat-card-content>
        <mat-icon>computer</mat-icon>
        @if (current(); as d) {
          <span>Ce poste est associé au terminal <strong>{{ d.code }}</strong> ({{ d.name }}).</span>
          <button mat-button type="button" (click)="forgetThisDevice()">Dissocier</button>
        } @else {
          <span>Ce poste n'est associé à aucun terminal. Choisissez « Utiliser sur ce poste » ci-dessous.</span>
        }
      </mat-card-content>
    </mat-card>

    <mat-card appearance="outlined">
      <mat-card-header><mat-card-title>Enregistrer un terminal</mat-card-title></mat-card-header>
      <mat-card-content>
        <form [formGroup]="form" (ngSubmit)="create()" class="form">
          <mat-form-field>
            <mat-label>Code</mat-label>
            <input matInput formControlName="code" maxlength="10" placeholder="C02" />
            <mat-hint>Préfixe des reçus hors ligne (ex. C02-20261008-0047)</mat-hint>
          </mat-form-field>
          <mat-form-field>
            <mat-label>Nom</mat-label>
            <input matInput formControlName="name" placeholder="Caisse 2 — entrée" />
          </mat-form-field>
          <mat-form-field>
            <mat-label>Type</mat-label>
            <mat-select formControlName="kind">
              <mat-option value="CAISSE">Caisse</mat-option>
              <mat-option value="TABLETTE">Tablette</mat-option>
              <mat-option value="POSTE">Poste de travail</mat-option>
            </mat-select>
          </mat-form-field>
          <button mat-flat-button type="submit" [disabled]="form.invalid">Enregistrer</button>
        </form>
      </mat-card-content>
    </mat-card>

    <div class="table-wrapper">
      <table mat-table [dataSource]="devices()">
        <ng-container matColumnDef="code">
          <th mat-header-cell *matHeaderCellDef>Code</th>
          <td mat-cell *matCellDef="let d"><strong>{{ d.code }}</strong></td>
        </ng-container>
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Nom</th>
          <td mat-cell *matCellDef="let d">{{ d.name }}</td>
        </ng-container>
        <ng-container matColumnDef="kind">
          <th mat-header-cell *matHeaderCellDef>Type</th>
          <td mat-cell *matCellDef="let d">{{ kindLabel(d.kind) }}</td>
        </ng-container>
        <ng-container matColumnDef="seen">
          <th mat-header-cell *matHeaderCellDef>Dernière activité</th>
          <td mat-cell *matCellDef="let d">{{ d.last_seen_at ? (d.last_seen_at | date) : '—' }}</td>
        </ng-container>
        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>Statut</th>
          <td mat-cell *matCellDef="let d">
            <mat-chip-set><mat-chip [highlighted]="d.is_active">{{ d.is_active ? 'Actif' : 'Désactivé' }}</mat-chip></mat-chip-set>
          </td>
        </ng-container>
        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef></th>
          <td mat-cell *matCellDef="let d" class="actions">
            @if (d.is_active) {
              <button mat-stroked-button type="button" (click)="useOnThisDevice(d)" [disabled]="current()?.code === d.code">
                Utiliser sur ce poste
              </button>
            }
            <button
              mat-icon-button
              type="button"
              (click)="toggleActive(d)"
              [matTooltip]="d.is_active ? 'Désactiver' : 'Réactiver'"
            >
              <mat-icon>{{ d.is_active ? 'block' : 'check_circle' }}</mat-icon>
            </button>
          </td>
        </ng-container>
        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns" [class.inactive]="!row.is_active"></tr>
        <tr class="mat-row" *matNoDataRow>
          <td class="mat-cell empty" [attr.colspan]="columns.length">Aucun terminal enregistré.</td>
        </tr>
      </table>
    </div>
  `,
  styleUrl: './admin-page.scss',
  styles: `
    mat-card {
      margin-bottom: 16px;
    }
    .this-device mat-card-content {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    .form {
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: baseline;
      margin-top: 12px;
    }
    .actions {
      white-space: nowrap;
    }
  `,
})
export class DevicesPage {
  private readonly api = inject(AdminApiService);
  private readonly deviceService = inject(DeviceService);
  private readonly snack = inject(MatSnackBar);

  protected readonly current = this.deviceService.device;
  protected readonly devices = signal<Device[]>([]);
  protected readonly columns = ['code', 'name', 'kind', 'seen', 'status', 'actions'];

  protected readonly form = inject(FormBuilder).nonNullable.group({
    code: ['', [Validators.required, Validators.pattern(/^[A-Za-z0-9]{2,10}$/)]],
    name: ['', Validators.required],
    kind: ['CAISSE' as DeviceKind, Validators.required],
  });

  constructor() {
    this.load();
  }

  protected kindLabel(kind: DeviceKind): string {
    return { CAISSE: 'Caisse', TABLETTE: 'Tablette', POSTE: 'Poste de travail' }[kind];
  }

  protected create(): void {
    this.api.createDevice(this.form.getRawValue()).subscribe({
      next: (device) => {
        this.snack.open(`Terminal ${device.code} enregistré.`);
        this.form.reset({ code: '', name: '', kind: 'CAISSE' });
        this.load();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected useOnThisDevice(device: Device): void {
    this.deviceService.register({ code: device.code, name: device.name });
    this.snack.open(`Ce poste utilise désormais le terminal ${device.code}.`);
  }

  protected forgetThisDevice(): void {
    this.deviceService.forget();
  }

  protected toggleActive(device: Device): void {
    this.api.updateDevice(device.id, { is_active: !device.is_active }).subscribe({
      next: () => this.load(),
      error: (err: unknown) => this.fail(err),
    });
  }

  private load(): void {
    this.api.listDevices().subscribe({
      next: (page) => this.devices.set(page.results),
      error: (err: unknown) => this.fail(err),
    });
  }

  private fail(err: unknown): void {
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
