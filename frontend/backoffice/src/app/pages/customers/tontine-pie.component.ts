import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { FcfaPipe } from '@librairie/shared';

/** Arc SVG d'un anneau (angles en tours, 0 = haut, sens horaire). */
export function ringArc(start: number, end: number, radius: number, center = 50): string {
  const point = (turn: number) => {
    const angle = 2 * Math.PI * turn - Math.PI / 2;
    return `${center + radius * Math.cos(angle)} ${center + radius * Math.sin(angle)}`;
  };
  const large = end - start > 0.5 ? 1 : 0;
  return `M ${point(start)} A ${radius} ${radius} 0 ${large} 1 ${point(end)}`;
}

/** Camembert (anneau) « montant reçu / reste à recevoir » sur le montant total attendu. */
@Component({
  selector: 'bo-tontine-pie',
  imports: [FcfaPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg viewBox="0 0 100 100" role="img"
         [attr.aria-label]="'Reçu ' + percent() + ' % du montant attendu'">
      <circle class="rest" cx="50" cy="50" r="38" />
      @if (share() >= 0.9999) {
        <circle class="received" cx="50" cy="50" r="38" />
      } @else if (share() > 0) {
        <path class="received" [attr.d]="arc()" />
      }
      <text x="50" y="55" text-anchor="middle" class="value">{{ percent() }} %</text>
    </svg>
    <ul class="legend">
      <li><span class="dot received"></span> Reçu <strong>{{ received() | fcfa }}</strong></li>
      <li><span class="dot rest"></span> Reste <strong>{{ rest() | fcfa }}</strong></li>
      <li class="muted">Attendu {{ expected() | fcfa }}</li>
    </ul>
  `,
  styles: `
    :host { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; height: 100%; }
    svg { width: 100%; max-width: 190px; height: auto; }
    circle, path { fill: none; stroke-width: 16; }
    .received { stroke: var(--mat-sys-primary); }
    .rest { stroke: #f5c518; }
    .value { font-size: 15px; font-weight: 700; fill: var(--mat-sys-on-surface); }
    .legend { list-style: none; padding: 0; margin: 0; font-size: 13px; display: grid; gap: 4px; }
    .legend li { display: flex; align-items: center; gap: 6px; }
    .dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; }
    .dot.received { background: var(--mat-sys-primary); }
    .dot.rest { background: #f5c518; }
    .muted { opacity: 0.7; }
  `,
})
export class TontinePieComponent {
  readonly expected = input.required<number>();
  readonly received = input.required<number>();

  protected readonly share = computed(() =>
    this.expected() > 0 ? Math.min(1, Math.max(0, this.received() / this.expected())) : 0);
  protected readonly percent = computed(() => Math.floor(this.share() * 100));
  protected readonly rest = computed(() => Math.max(this.expected() - this.received(), 0));
  protected readonly arc = computed(() => ringArc(0, this.share(), 38));
}
