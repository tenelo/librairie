import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { APP_CONFIG, OfflineAuthService } from '@librairie/shared';
import { firstValueFrom } from 'rxjs';

export interface PinCaptureData {
  userId: string;
  username: string;
}

/**
 * Après une connexion en ligne : l'utilisateur saisit son PIN une fois sur ce terminal.
 * Le PIN est vérifié par le serveur puis seul son hachage est conservé localement,
 * pour permettre la reprise de session hors connexion.
 */
@Component({
  selector: 'bo-pin-capture-dialog',
  imports: [FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>Activer le mode hors connexion</h2>
    <form (ngSubmit)="submit()">
      <mat-dialog-content>
        <p>Saisissez votre code PIN pour pouvoir reprendre la main sur ce terminal sans connexion internet.</p>
        <mat-form-field>
          <mat-label>Code PIN</mat-label>
          <input matInput type="password" inputmode="numeric" maxlength="6" name="pin" [(ngModel)]="pin" autofocus />
        </mat-form-field>
        @if (error()) {
          <p class="error" role="alert">{{ error() }}</p>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Plus tard</button>
        <button mat-flat-button type="submit" [disabled]="pin.length < 4 || busy()">Valider</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: `
    .error {
      color: var(--mat-sys-error);
    }
  `,
})
export class PinCaptureDialogComponent {
  private readonly data = inject<PinCaptureData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<PinCaptureDialogComponent, boolean>);
  private readonly http = inject(HttpClient);
  private readonly api = inject(APP_CONFIG).apiBaseUrl;
  private readonly offlineAuth = inject(OfflineAuthService);
  protected readonly error = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected pin = '';

  protected async submit(): Promise<void> {
    this.busy.set(true);
    try {
      const result = await firstValueFrom(this.http.post<{ valid: boolean }>(`${this.api}/auth/pin/verify/`,
        { username: this.data.username, pin: this.pin }));
      if (!result.valid) {
        this.error.set('Code PIN incorrect.');
        return;
      }
      await this.offlineAuth.setLocalPin(this.data.userId, this.pin);
      this.ref.close(true);
    } catch {
      this.error.set('Vérification impossible pour le moment.');
    } finally {
      this.busy.set(false);
    }
  }
}
