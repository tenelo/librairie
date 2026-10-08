import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { Router } from '@angular/router';
import {
  AuthService,
  CatalogApiService,
  NetworkStatusService,
  School,
  SchoolCycle,
  SchoolLevel,
  SchoolYear,
  apiErrorMessage,
} from '@librairie/shared';

/** Référentiels scolaires : niveaux (et séries), années scolaires, établissements. */
@Component({
  selector: 'bo-levels-schools-page',
  imports: [
    FormsModule,
    ReactiveFormsModule,
    MatTabsModule,
    MatTableModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatButtonModule,
    MatIconModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './levels-schools.page.html',
  styleUrl: './catalog-page.scss',
})
export class LevelsSchoolsPage {
  private readonly api = inject(CatalogApiService);
  private readonly snack = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder).nonNullable;
  protected readonly network = inject(NetworkStatusService);
  protected readonly canManage = inject(AuthService).hasPermission('catalog.manage');

  /** Depuis le menu Clients › Établissements scolaires, l'onglet établissements s'ouvre directement. */
  protected readonly selectedTab = signal(inject(Router).url.startsWith('/clients/') ? 2 : 0);

  protected readonly levels = signal<SchoolLevel[]>([]);
  protected readonly years = signal<SchoolYear[]>([]);
  protected readonly schools = signal<School[]>([]);
  protected readonly cycles: { value: SchoolCycle; label: string }[] = [
    { value: 'PRIMAIRE', label: 'Primaire' },
    { value: 'COLLEGE', label: 'Collège' },
    { value: 'LYCEE', label: 'Lycée' },
  ];

  protected readonly levelForm = this.fb.group({
    code: ['', [Validators.required, Validators.maxLength(20)]],
    label: ['', Validators.required],
    cycle: ['LYCEE' as SchoolCycle, Validators.required],
    series: [''],
    sort_order: [500],
  });
  protected readonly yearForm = this.fb.group({
    label: ['', [Validators.required, Validators.pattern(/^\d{4}-\d{4}$/)]],
    starts_on: ['', Validators.required],
    ends_on: ['', Validators.required],
    is_current: [false],
  });
  protected readonly schoolForm = this.fb.group({
    name: ['', Validators.required],
    city: ['Abidjan'],
    district: [''],
    phone: [''],
  });
  protected readonly editingSchool = signal<string | null>(null);

  constructor() {
    this.loadAll();
  }

  protected addLevel(): void {
    const value = this.levelForm.getRawValue();
    this.api.saveLevel({ ...value, code: value.code.toUpperCase() }).subscribe({
      next: () => {
        this.levelForm.reset({ code: '', label: '', cycle: 'LYCEE', series: '', sort_order: 500 });
        this.loadAll();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected toggleLevel(level: SchoolLevel): void {
    this.api.saveLevel({ id: level.id, is_active: !level.is_active }).subscribe({
      next: () => this.loadAll(),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected addYear(): void {
    this.api.saveSchoolYear(this.yearForm.getRawValue()).subscribe({
      next: () => {
        this.yearForm.reset({ label: '', starts_on: '', ends_on: '', is_current: false });
        this.loadAll();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected makeCurrent(year: SchoolYear): void {
    this.api.saveSchoolYear({ id: year.id, is_current: true }).subscribe({
      next: () => this.loadAll(),
      error: (err: unknown) => this.fail(err),
    });
  }

  protected editSchool(school: School): void {
    this.editingSchool.set(school.id);
    this.schoolForm.reset({ name: school.name, city: school.city, district: school.district, phone: school.phone });
  }

  protected cancelSchool(): void {
    this.editingSchool.set(null);
    this.schoolForm.reset({ name: '', city: 'Abidjan', district: '', phone: '' });
  }

  protected saveSchool(): void {
    const id = this.editingSchool() ?? undefined;
    this.api.saveSchool({ id, ...this.schoolForm.getRawValue() }).subscribe({
      next: () => {
        this.snack.open(id ? 'Établissement modifié.' : 'Établissement ajouté.');
        this.cancelSchool();
        this.loadAll();
      },
      error: (err: unknown) => this.fail(err),
    });
  }

  protected toggleSchool(school: School): void {
    this.api.saveSchool({ id: school.id, is_active: !school.is_active }).subscribe({
      next: () => this.loadAll(),
      error: (err: unknown) => this.fail(err),
    });
  }

  private loadAll(): void {
    this.api.listLevels().subscribe({ next: (l) => this.levels.set(l), error: (e: unknown) => this.fail(e) });
    this.api.listSchoolYears().subscribe({ next: (y) => this.years.set(y), error: (e: unknown) => this.fail(e) });
    this.api.listSchools().subscribe({ next: (s) => this.schools.set(s.results), error: (e: unknown) => this.fail(e) });
  }

  private fail(err: unknown): void {
    this.snack.open(apiErrorMessage(err), 'Fermer', { duration: 6000 });
  }
}
