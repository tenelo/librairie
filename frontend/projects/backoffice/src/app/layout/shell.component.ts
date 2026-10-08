import { BreakpointObserver } from '@angular/cdk/layout';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import {
  AuthService,
  DeviceService,
  NetworkIndicatorComponent,
  NetworkStatusService,
  OfflineAuthService,
  SyncEngineService,
  SyncStatusService,
  ThemeService,
} from '@librairie/shared';
import { filter, map } from 'rxjs';

import { MENU, MenuSection, visibleMenu } from '../navigation/menu';

@Component({
  selector: 'bo-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatDividerModule,
    NetworkIndicatorComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './shell.component.html',
  styleUrl: './shell.component.scss',
})
export class ShellComponent {
  protected readonly auth = inject(AuthService);
  protected readonly theme = inject(ThemeService);
  protected readonly network = inject(NetworkStatusService);
  protected readonly device = inject(DeviceService).device;
  private readonly router = inject(Router);
  protected readonly sync = inject(SyncEngineService);
  protected readonly syncStatus = inject(SyncStatusService);
  private readonly offlineAuth = inject(OfflineAuthService);

  protected readonly isHandset = toSignal(
    inject(BreakpointObserver)
      .observe('(max-width: 959px)')
      .pipe(map((state) => state.matches)),
    { initialValue: false },
  );

  protected readonly menu = computed(() => visibleMenu(MENU, (permission) => this.auth.hasPermission(permission)));

  /** Sections dépliées dans le menu latéral (la section active est dépliée automatiquement). */
  protected readonly expanded = signal<Set<string>>(new Set([this.currentSection(this.router.url)]));
  protected readonly menuOpen = signal(false);

  constructor() {
    this.sync.start();
    this.router.events.pipe(filter((event) => event instanceof NavigationEnd)).subscribe((event) => {
      const section = this.currentSection(event.urlAfterRedirects);
      this.expanded.update((set) => new Set(set).add(section));
      if (this.isHandset()) {
        this.menuOpen.set(false);
      }
    });
  }

  protected toggleSection(section: MenuSection): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (next.has(section.path)) {
        next.delete(section.path);
      } else {
        next.add(section.path);
      }
      return next;
    });
  }

  /** Déconnexion explicite : la session mémorisée sur le terminal est oubliée (plus de reprise par PIN). */
  protected async logout(): Promise<void> {
    const user = this.auth.user();
    if (user) {
      await this.offlineAuth.forget(user.id);
    }
    this.auth.logout();
  }

  /** Relais de caissier : la session reste mémorisée, un autre utilisateur reprend la main par PIN. */
  protected switchUser(): void {
    void this.router.navigateByUrl('/verrouillage');
  }

  protected syncNow(): void {
    void this.sync.syncNow();
  }

  private currentSection(url: string): string {
    return url.split('?')[0].split('/').filter(Boolean)[0] ?? '';
  }
}
