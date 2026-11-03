import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { AuthService } from './auth.service';
import { DeviceService } from './device.service';

const PUBLIC_AUTH_ENDPOINTS = ['/auth/login/', '/auth/refresh/', '/auth/register/'];

function isApiRequest(url: string, apiBaseUrl: string): boolean {
  return url.startsWith(apiBaseUrl);
}

function isPublicAuthEndpoint(url: string): boolean {
  return PUBLIC_AUTH_ENDPOINTS.some((endpoint) => url.includes(endpoint));
}

function withHeaders(req: HttpRequest<unknown>, token: string | null, deviceCode: string | null) {
  const headers: Record<string, string> = { 'X-Client-Timestamp': new Date().toISOString() };
  if (token && !req.headers.has('Authorization')) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (deviceCode) {
    headers['X-Device-Code'] = deviceCode;
  }
  return req.clone({ setHeaders: headers });
}

/**
 * Ajoute le jeton JWT, le code terminal et la date client aux appels API.
 * Sur une réponse 401, tente un unique renouvellement du jeton puis rejoue la requête ;
 * en cas d'échec, la session est fermée et l'utilisateur renvoyé à l'écran de connexion.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const config = inject(APP_CONFIG);
  const auth = inject(AuthService);
  const devices = inject(DeviceService);

  if (!isApiRequest(req.url, config.apiBaseUrl)) {
    return next(req);
  }
  const deviceCode = devices.device()?.code ?? null;
  const publicEndpoint = isPublicAuthEndpoint(req.url);
  const request = withHeaders(req, publicEndpoint ? null : auth.accessToken, deviceCode);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401 || publicEndpoint || !auth.accessToken) {
        return throwError(() => error);
      }
      return auth.refreshAccessToken().pipe(
        catchError((refreshError: unknown) => {
          auth.logout();
          return throwError(() => refreshError);
        }),
        switchMap((token) => next(withHeaders(req, token, deviceCode))),
      );
    }),
  );
};
