import { DATE_PIPE_DEFAULT_OPTIONS, registerLocaleData } from '@angular/common';
import localeFrCi from '@angular/common/locales/fr-CI';
import { EnvironmentProviders, LOCALE_ID, makeEnvironmentProviders } from '@angular/core';

/** Locale de l'application : français de Côte d'Ivoire. */
export const APP_LOCALE = 'fr-CI';
/** Africa/Abidjan est à UTC+0 toute l'année (pas d'heure d'été). */
export const APP_TIMEZONE = 'Africa/Abidjan';
export const APP_TIMEZONE_OFFSET = '+0000';

/** Enregistre la locale fr-CI et le fuseau d'Abidjan pour les pipes Angular. */
export function provideLibrairieLocale(): EnvironmentProviders {
  registerLocaleData(localeFrCi, APP_LOCALE);
  return makeEnvironmentProviders([
    { provide: LOCALE_ID, useValue: APP_LOCALE },
    { provide: DATE_PIPE_DEFAULT_OPTIONS, useValue: { timezone: APP_TIMEZONE_OFFSET, dateFormat: 'dd/MM/yyyy HH:mm' } },
  ]);
}
