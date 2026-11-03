/** Règles de la préparation par scan (indépendantes de l'affichage, testées unitairement). */

export interface PrepLine {
  id: string;
  article: string;
  code: string;
  name: string;
  quantity: number;
  location: string;
  barcodes: string[];
}

export interface Shortage {
  /** Quantité réellement disponible (inférieure à la quantité commandée). */
  quantity: number;
  substitute: { id: string; name: string } | null;
}

export type ScanResult =
  | { ok: true; line: PrepLine; prepared: number }
  | { ok: false; error: string };

/** Article scanné : retrouve la ligne (code-barres ou code interne) et contrôle la quantité. */
export function applyScan(lines: PrepLine[], prepared: Record<string, number>, shortages: Record<string, Shortage>,
  raw: string): ScanResult {
  const code = raw.trim().toUpperCase();
  if (!code) {
    return { ok: false, error: 'Code vide.' };
  }
  const matches = lines.filter((l) => l.code.toUpperCase() === code || l.barcodes.some((b) => b.toUpperCase() === code));
  if (!matches.length) {
    return { ok: false, error: `Article ${raw.trim()} absent de la commande : ne pas l'ajouter au colis.` };
  }
  const line = matches.find((l) => (prepared[l.id] ?? 0) < target(l, shortages)) ?? matches[0];
  const done = prepared[line.id] ?? 0;
  if (done >= target(line, shortages)) {
    return { ok: false, error: `${line.name} : quantité déjà complète (${done}/${target(line, shortages)}).` };
  }
  return { ok: true, line, prepared: done + 1 };
}

/** Quantité à préparer d'une ligne (réduite si une rupture est déclarée). */
export function target(line: PrepLine, shortages: Record<string, Shortage>): number {
  return shortages[line.id] ? shortages[line.id].quantity : line.quantity;
}

/** La commande peut passer « prête » (ou être soumise au client) : chaque ligne est complète. */
export function readiness(lines: PrepLine[], prepared: Record<string, number>, shortages: Record<string, Shortage>):
  { complete: boolean; missing: string[] } {
  const missing = lines.filter((l) => (prepared[l.id] ?? 0) < target(l, shortages))
    .map((l) => `${l.name} (${prepared[l.id] ?? 0}/${target(l, shortages)})`);
  return { complete: missing.length === 0, missing };
}

/** Tri de la liste par emplacement (les articles sans emplacement en dernier), puis par nom. */
export function sortByLocation(lines: PrepLine[]): PrepLine[] {
  return [...lines].sort((a, b) => (a.location || '~').localeCompare(b.location || '~', 'fr')
    || a.name.localeCompare(b.name, 'fr'));
}
