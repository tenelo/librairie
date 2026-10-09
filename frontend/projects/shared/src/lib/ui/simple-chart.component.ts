import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';

import { formatFcfa } from '../format/fcfa.pipe';

export interface ChartPoint {
  label: string;
  value: number;
}

/** Points du graphique : valeurs non numériques ignorées, limite facultative (les plus grandes d'abord). */
export function chartPoints(rows: Record<string, unknown>[], x: string, y: string, limit?: number): ChartPoint[] {
  const points = rows.map((r) => ({ label: String(r[x] ?? ''), value: Number(r[y]) }))
    .filter((p) => Number.isFinite(p.value));
  return limit ? points.slice(0, limit) : points;
}

/** « Belles » graduations de l'axe des valeurs (0 inclus). */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const low = Math.min(0, min);
  const high = Math.max(0, max);
  if (low === high) {
    return [0];
  }
  const raw = (high - low) / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = Math.floor(low / step) * step; v <= high + step / 2; v += step) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

const W = 640;
const H = 220;
const PAD = { top: 12, right: 12, bottom: 48, left: 72 };

/**
 * Graphique SVG léger (barres ou courbe, une seule série) : grille discrète, une seule échelle,
 * info-bulle au survol. La série unique est nommée par le titre du tableau : pas de légende.
 */
@Component({
  selector: 'lib-simple-chart',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (points().length) {
      <svg [attr.viewBox]="'0 0 ' + width + ' ' + height" role="img" [attr.aria-label]="label()"
           (mouseleave)="hover.set(null)">
        @for (t of ticks(); track t) {
          <line class="grid" [attr.x1]="pad.left" [attr.x2]="width - pad.right" [attr.y1]="yOf(t)" [attr.y2]="yOf(t)" />
          <text class="axis" [attr.x]="pad.left - 6" [attr.y]="yOf(t) + 4" text-anchor="end">{{ short(t) }}</text>
        }
        @if (type() === 'bar') {
          @for (p of points(); track $index; let i = $index) {
            <path class="bar" [class.active]="hover() === i" [attr.d]="barPath(i, p.value)" />
            <rect class="hit" [attr.x]="pad.left + i * band()" y="0" [attr.width]="band()" [attr.height]="height"
                  (mouseenter)="hover.set(i)" />
          }
        } @else {
          <path class="line" [attr.d]="linePath()" />
          @for (p of points(); track $index; let i = $index) {
            @if (hover() === i || points().length === 1) {
              <circle class="dot" [attr.cx]="xCenter(i)" [attr.cy]="yOf(p.value)" r="4" />
              <line class="cross" [attr.x1]="xCenter(i)" [attr.x2]="xCenter(i)" [attr.y1]="pad.top" [attr.y2]="height - pad.bottom" />
            }
            <rect class="hit" [attr.x]="pad.left + i * band()" y="0" [attr.width]="band()" [attr.height]="height"
                  (mouseenter)="hover.set(i)" />
          }
        }
        @for (p of points(); track $index; let i = $index) {
          @if (showLabel(i)) {
            <text class="axis" [attr.x]="xCenter(i)" [attr.y]="height - pad.bottom + 14" text-anchor="middle">{{ truncate(p.label) }}</text>
          }
        }
        <line class="baseline" [attr.x1]="pad.left" [attr.x2]="width - pad.right" [attr.y1]="yOf(0)" [attr.y2]="yOf(0)" />
      </svg>
      @if (hover() !== null) {
        <div class="tip" role="status">{{ points()[hover()!].label }} : <strong>{{ format(points()[hover()!].value) }}</strong></div>
      } @else {
        <div class="tip muted">Survolez le graphique pour le détail.</div>
      }
    }
  `,
  styles: `
    :host { display: block; }
    svg { width: 100%; height: auto; max-height: 260px; }
    .grid { stroke: var(--mat-sys-outline-variant); stroke-width: 1; opacity: 0.6; }
    .baseline { stroke: var(--mat-sys-outline); stroke-width: 1; }
    .axis { fill: var(--mat-sys-on-surface-variant); font-size: 11px; }
    .bar { fill: var(--mat-sys-primary); opacity: 0.85; }
    .bar.active { opacity: 1; }
    .line { fill: none; stroke: var(--mat-sys-primary); stroke-width: 2; stroke-linejoin: round; }
    .dot { fill: var(--mat-sys-primary); stroke: var(--mat-sys-surface); stroke-width: 2; }
    .cross { stroke: var(--mat-sys-outline); stroke-dasharray: 3 3; }
    .hit { fill: transparent; }
    .tip { font-size: 13px; min-height: 20px; }
    .muted { opacity: 0.6; }
  `,
})
export class SimpleChartComponent {
  readonly rows = input<Record<string, unknown>[]>([]);
  readonly x = input('label');
  readonly y = input('value');
  readonly type = input<'bar' | 'line'>('bar');
  readonly kind = input<string>('int');
  readonly limit = input<number | undefined>(undefined);
  readonly label = input('Graphique');

  protected readonly width = W;
  protected readonly height = H;
  protected readonly pad = PAD;
  protected readonly hover = signal<number | null>(null);
  protected readonly points = computed(() => chartPoints(this.rows(), this.x(), this.y(), this.limit()));
  protected readonly ticks = computed(() => {
    const values = this.points().map((p) => p.value);
    return niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  });
  protected readonly band = computed(() => (W - PAD.left - PAD.right) / Math.max(this.points().length, 1));

  private range(): [number, number] {
    const ticks = this.ticks();
    return [ticks[0], ticks[ticks.length - 1] || 1];
  }

  protected yOf(value: number): number {
    const [low, high] = this.range();
    const span = high - low || 1;
    return PAD.top + (H - PAD.top - PAD.bottom) * (1 - (value - low) / span);
  }

  protected xCenter(i: number): number {
    return PAD.left + (i + 0.5) * this.band();
  }

  /** Barre fine, extrémité arrondie (4 px) côté valeur, ancrée sur la ligne de base. */
  protected barPath(i: number, value: number): string {
    const width = Math.min(this.band() * 0.6, 36);
    const x = this.xCenter(i) - width / 2;
    const y0 = this.yOf(0);
    const y1 = this.yOf(value);
    const r = Math.min(4, width / 2, Math.abs(y0 - y1));
    if (value >= 0) {
      return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + width - r} Q${x + width},${y1} ${x + width},${y1 + r} V${y0} Z`;
    }
    return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + width - r} Q${x + width},${y1} ${x + width},${y1 - r} V${y0} Z`;
  }

  protected linePath(): string {
    return this.points().map((p, i) => `${i ? 'L' : 'M'}${this.xCenter(i)},${this.yOf(p.value)}`).join(' ');
  }

  /** Étiquettes de l'axe horizontal espacées pour ne pas se chevaucher. */
  protected showLabel(i: number): boolean {
    const every = Math.ceil(this.points().length / Math.max(Math.floor((W - PAD.left) / 70), 1));
    return i % Math.max(every, 1) === 0;
  }

  protected truncate(label: string): string {
    return label.length > 12 ? `${label.slice(0, 11)}…` : label;
  }

  protected short(value: number): string {
    const abs = Math.abs(value);
    if (abs >= 1_000_000) {
      return `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`;
    }
    if (abs >= 1000) {
      return `${(value / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`;
    }
    return value.toLocaleString('fr-FR');
  }

  protected format(value: number): string {
    if (this.kind() === 'money') {
      return formatFcfa(value);
    }
    if (this.kind() === 'percent') {
      return `${value.toLocaleString('fr-FR')} %`;
    }
    return value.toLocaleString('fr-FR');
  }
}
