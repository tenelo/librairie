import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { UpdateBannerComponent } from '@librairie/shared';

@Component({
  selector: 'bt-root',
  imports: [RouterOutlet, UpdateBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <lib-update-banner />
    <router-outlet />
  `,
})
export class App {}
