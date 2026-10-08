import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CatalogApiService, Kit, School, SchoolLevel, SchoolYear, apiErrorMessage } from '@librairie/shared';

export interface KitDuplicateDialogData {
  kit: Kit;
  levels: SchoolLevel[];
  schools: School[];
  years: SchoolYear[];
}

/** Duplication d'un kit vers une autre année, un autre niveau ou un autre établissement. */
@Component({
  selector: 'bo-kit-duplicate-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Dupliquer « {{ data.kit.name }} »</h2>
    <form [formGroup]="form" (ngSubmit)="submit()">
      <mat-dialog-content class="fields">
        <mat-form-field>
          <mat-label>Nom du nouveau kit</mat-label>
          <input matInput formControlName="name" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>Niveau</mat-label>
          <mat-select formControlName="level">
            @for (l of data.levels; track l.id) {
              <mat-option [value]="l.id">{{ l.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Établissement</mat-label>
          <mat-select formControlName="school">
            <mat-option [value]="null">Liste générique</mat-option>
            @for (s of data.schools; track s.id) {
              <mat-option [value]="s.id">{{ s.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Année scolaire</mat-label>
          <mat-select formControlName="school_year">
            @for (y of data.years; track y.id) {
              <mat-option [value]="y.id">{{ y.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Annuler</button>
        <button mat-flat-button type="submit" [disabled]="form.invalid || saving()">Dupliquer</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .fields {
      display: flex;
      flex-direction: column;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class KitDuplicateDialogComponent {
  protected readonly data = inject<KitDuplicateDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<KitDuplicateDialogComponent, Kit>);
  private readonly api = inject(CatalogApiService);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).group({
    name: [`${this.data.kit.name} (copie)`, Validators.required],
    level: [this.data.kit.level, Validators.required],
    school: [this.data.kit.school],
    school_year: [this.data.kit.school_year ?? this.data.years.find((y) => y.is_current)?.id ?? null],
  });

  submit(): void {
    const raw = this.form.getRawValue();
    this.saving.set(true);
    this.api
      .duplicateKit(this.data.kit.id, {
        name: raw.name ?? undefined,
        level: raw.level ?? undefined,
        school: raw.school,
        school_year: raw.school_year ?? undefined,
      })
      .subscribe({
        next: (copy) => this.ref.close(copy),
        error: (err: unknown) => {
          this.saving.set(false);
          this.error.set(apiErrorMessage(err));
        },
      });
  }
}
