import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject } from '@angular/core';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';

import { AppNotification, NotificationService } from './notification.service';

/** Cloche des notifications : compteur, liste, « tout marquer comme lu », alerte à l'arrivée. */
@Component({
  selector: 'lib-notification-bell',
  imports: [DatePipe, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button mat-icon-button type="button" [matMenuTriggerFor]="menu" (menuOpened)="notifications.refresh()"
            [attr.aria-label]="'Notifications, ' + notifications.unread() + ' non lue(s)'">
      <mat-icon [matBadge]="notifications.unread() || null" matBadgeColor="warn" matBadgeSize="small"
                aria-hidden="false">notifications</mat-icon>
    </button>
    <mat-menu #menu="matMenu" xPosition="before" class="notification-menu">
      <div class="head" (click)="$event.stopPropagation()">
        <strong>Notifications</strong>
        @if (notifications.unread()) {
          <button mat-button type="button" (click)="notifications.markAllRead()">Tout marquer comme lu</button>
        }
      </div>
      @for (n of notifications.items(); track n.id) {
        <button mat-menu-item type="button" class="item" [class.unread]="!n.read_at" (click)="open(n)">
          <span class="title">{{ n.title }}</span>
          @if (n.body) { <span class="body">{{ n.body }}</span> }
          <span class="date">{{ n.created_at | date: 'dd/MM HH:mm' }}</span>
        </button>
      } @empty {
        <p class="empty">Aucune notification.</p>
      }
    </mat-menu>
  `,
  styles: `
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 4px 16px; }
    .item { height: auto !important; min-height: 48px; line-height: 1.3; padding-top: 8px; padding-bottom: 8px; }
    .item ::ng-deep .mat-mdc-menu-item-text { display: flex; flex-direction: column; white-space: normal; }
    .item.unread .title { font-weight: 600; }
    .item.unread { border-left: 3px solid var(--mat-sys-primary); }
    .body { font-size: 13px; opacity: 0.8; }
    .date { font-size: 11px; opacity: 0.6; }
    .empty { padding: 8px 16px; opacity: 0.7; }
  `,
})
export class NotificationBellComponent {
  protected readonly notifications = inject(NotificationService);
  private readonly router = inject(Router);
  private readonly snack = inject(MatSnackBar);

  constructor() {
    this.notifications.start();
    effect(() => {
      const incoming = this.notifications.incoming();
      if (incoming) {
        this.snack.open(incoming.title, incoming.url ? 'Voir' : 'OK', { duration: 6000 }).onAction()
          .subscribe(() => this.open(incoming));
      }
    });
  }

  protected open(notification: AppNotification): void {
    void this.notifications.markRead(notification);
    if (notification.url) {
      void this.router.navigateByUrl(notification.url);
    }
  }
}
