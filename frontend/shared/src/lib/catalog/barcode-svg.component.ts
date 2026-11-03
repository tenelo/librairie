import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import { BarRect, ean13Bars, isValidEan13 } from './ean13';

/** Code-barres EAN-13 vectoriel (net à l'impression, quelle que soit la taille). */
@Component({
  selector: 'lib-barcode-svg',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (bars(); as list) {
      <svg [attr.viewBox]="'0 0 113 ' + (height() + 10)" preserveAspectRatio="xMidYMid meet"
           role="img" [attr.aria-label]="'Code-barres ' + code()">
        <rect x="0" y="0" width="113" [attr.height]="height() + 10" fill="#fff" />
        @for (bar of list; track bar.x) {
          <rect [attr.x]="bar.x + 9" y="0" [attr.width]="bar.width"
                [attr.height]="bar.guard ? height() + 5 : height()" fill="#000" />
        }
        <text x="4" [attr.y]="height() + 9" font-size="9" font-family="monospace">{{ code()[0] }}</text>
        <text x="33" [attr.y]="height() + 9" font-size="9" font-family="monospace" text-anchor="middle"
              letter-spacing="1.2">{{ code().slice(1, 7) }}</text>
        <text x="80" [attr.y]="height() + 9" font-size="9" font-family="monospace" text-anchor="middle"
              letter-spacing="1.2">{{ code().slice(7) }}</text>
      </svg>
    } @else {
      <span class="plain">{{ code() }}</span>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    svg {
      width: 100%;
      height: 100%;
    }
    .plain {
      font-family: monospace;
    }
  `,
})
export class BarcodeSvgComponent {
  readonly code = input.required<string>();
  readonly height = input(40);

  protected readonly bars = computed<BarRect[] | null>(() =>
    isValidEan13(this.code()) ? ean13Bars(this.code()) : null,
  );
}
