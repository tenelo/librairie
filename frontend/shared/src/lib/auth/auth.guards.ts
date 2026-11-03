import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';

import { APP_CONFIG } from '../config/app-config';
import { AuthService } from './auth.service';

/** Exige une session ; sinon redirige vers l'écran de connexion en mémorisant la cible. */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) {
    return true;
  }
  return inject(Router).createUrlTree([inject(APP_CONFIG).loginPath], {
    queryParams: { retour: state.url },
  });
};

/** Empêche d'afficher l'écran de connexion à un utilisateur déjà connecté. */
export const guestGuard: CanMatchFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? inject(Router).createUrlTree(['/']) : true;
};

/**
 * Contrôle la permission déclarée dans `data.permission` (chaîne) ou `data.anyPermission`
 * (liste : au moins une). Cohérent avec les permissions DRF côté serveur.
 */
export const permissionGuard: CanActivateFn = (route) => {
  const auth = inject(AuthService);
  const single = route.data['permission'] as string | undefined;
  const any = (route.data['anyPermission'] as string[] | undefined) ?? [];
  const allowed = single ? auth.hasPermission(single) : auth.hasAnyPermission(any);
  return allowed ? true : inject(Router).createUrlTree(['/acces-refuse']);
};
