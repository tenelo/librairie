/**
 * Recherche pendant la saisie : relance la recherche quand l'utilisateur s'arrête de taper
 * (300 ms par défaut), pour ne pas interroger le serveur à chaque lettre.
 *
 * Usage dans un composant :
 *   protected readonly onSearchInput = liveSearch(() => this.reload(0));
 *   <input … (input)="onSearchInput()" />
 */
export function liveSearch(run: () => void, delayMs = 300): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(run, delayMs);
  };
}
