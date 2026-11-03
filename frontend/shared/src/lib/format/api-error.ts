import { HttpErrorResponse } from '@angular/common/http';

/** Convertit une erreur HTTP / DRF en message lisible en français. */
export function apiErrorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) {
    return 'Une erreur inattendue est survenue.';
  }
  if (error.status === 0) {
    return 'Serveur injoignable. Vérifiez votre connexion.';
  }
  if (error.status === 429) {
    return 'Trop de tentatives. Patientez quelques instants avant de réessayer.';
  }
  const body = error.error as unknown;
  if (body && typeof body === 'object') {
    const record = body as Record<string, unknown>;
    if (typeof record['detail'] === 'string') {
      return record['detail'];
    }
    const messages = Object.entries(record).flatMap(([field, value]) => {
      const list = Array.isArray(value) ? value : [value];
      return list.map((message) => (field === 'non_field_errors' ? `${message}` : `${field} : ${message}`));
    });
    if (messages.length) {
      return messages.join(' ');
    }
  }
  if (error.status === 403) {
    return "Vous n'avez pas l'autorisation d'effectuer cette action.";
  }
  return `Erreur ${error.status}.`;
}
