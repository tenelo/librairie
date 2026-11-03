import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ThemeService, UpdateBannerComponent } from '@librairie/shared';

@Component({
  selector: 'bo-root',
  imports: [RouterOutlet, UpdateBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lib-update-banner />
    <router-outlet />
  `,
})
export class App {
  // Instancié dès le démarrage pour appliquer le thème mémorisé.
  private readonly theme = inject(ThemeService);
}
