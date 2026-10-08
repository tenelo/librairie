import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { APP_CONFIG } from '../config/app-config';
import { NotificationService, reconnectDelay, urlBase64ToUint8Array } from './notification.service';

describe('Notifications', () => {
  it('espace les reconnexions WebSocket jusqu’à 60 s', () => {
    expect(reconnectDelay(0)).toBe(1000);
    expect(reconnectDelay(3)).toBe(8000);
    expect(reconnectDelay(20)).toBe(60000);
  });

  it('décode la clé publique VAPID (base64 url)', () => {
    expect(Array.from(urlBase64ToUint8Array('AQID_w'))).toEqual([1, 2, 3, 255]);
  });

  it('marque toutes les notifications comme lues', async () => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: APP_CONFIG, useValue: { apiBaseUrl: '/api', app: 'backoffice', loginPath: '/connexion' } }],
    });
    const service = TestBed.inject(NotificationService);
    const http = TestBed.inject(HttpTestingController);
    service.items.set([{ id: '1', event: 'order_placed', title: 'A', body: '', url: '', data: {}, read_at: null,
      created_at: '2026-10-08T10:00:00Z' }]);
    service.unread.set(1);
    const done = service.markAllRead();
    http.expectOne('/api/notifications/read-all/').flush({ marked: 1, unread: 0 });
    await done;
    expect(service.unread()).toBe(0);
    expect(service.items()[0].read_at).not.toBeNull();
    http.verify();
  });
});
