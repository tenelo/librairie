import { HttpErrorResponse } from '@angular/common/http';

import { apiErrorMessage } from './api-error';

describe('apiErrorMessage', () => {
  it('reprend le détail renvoyé par DRF', () => {
    const error = new HttpErrorResponse({ status: 401, error: { detail: 'Identifiant ou mot de passe incorrect.' } });
    expect(apiErrorMessage(error)).toBe('Identifiant ou mot de passe incorrect.');
  });

  it('assemble les erreurs de validation par champ', () => {
    const error = new HttpErrorResponse({ status: 400, error: { code: ['Ce code terminal est déjà attribué.'] } });
    expect(apiErrorMessage(error)).toBe('code : Ce code terminal est déjà attribué.');
  });

  it('signale un serveur injoignable et la limitation de débit', () => {
    expect(apiErrorMessage(new HttpErrorResponse({ status: 0 }))).toContain('injoignable');
    expect(apiErrorMessage(new HttpErrorResponse({ status: 429 }))).toContain('Trop de tentatives');
  });
});
