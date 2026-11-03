/**
 * Interrupteurs de fonctionnalités du backoffice.
 *
 * Vente en ligne (commandes clients, retrait en librairie, acompte, boutique) : désactivée pour l'instant.
 * Passer à true réaffiche le menu « Commandes en ligne », le bouton « Retrait commande » de la caisse,
 * les statistiques des commandes et les options liées (dépôts, articles, kits, paramètres, rôles, notifications).
 * Le code et les données restent en place : rien n'est supprimé.
 */
export const ONLINE_SALES_ENABLED = false;

/**
 * Nom affiché de la tontine scolaire (menu, écrans, reçus de versement).
 * Pour le renommer : changer ce texte, `TONTINE_LABEL` dans backend/apps/sales/tontines.py,
 * et le libellé du moyen de paiement dans Administration › Moyens de paiement.
 */
export const TONTINE_LABEL = 'Tontine scolaire';

/** Permissions propres à la vente en ligne (masquées dans l'écran des rôles quand elle est désactivée). */
export function isOnlineSalesPermission(code: string): boolean {
  return code.startsWith('orders.') || code.startsWith('shop.');
}
