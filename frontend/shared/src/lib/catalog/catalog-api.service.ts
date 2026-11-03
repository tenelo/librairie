import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

import { APP_CONFIG } from '../config/app-config';
import { Paginated } from '../models/auth.models';
import {
  Article,
  ArticleImage,
  ArticleInput,
  ArticleLookup,
  Barcode,
  Brand,
  Category,
  ImportResult,
  Kit,
  KitInput,
  PriceHistoryEntry,
  School,
  SchoolLevel,
  SchoolYear,
  Unit,
} from '../models/catalog.models';

export type CatalogQuery = Record<string, string | number | boolean | readonly string[] | null | undefined>;

export function toHttpParams(query: CatalogQuery): HttpParams {
  let params = new HttpParams();
  for (const [key, value] of Object.entries(query)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params = params.append(key, item);
      }
    } else if (value !== null && value !== undefined && value !== '') {
      params = params.set(key, String(value));
    }
  }
  return params;
}

/** Accès aux API du catalogue, des kits et des référentiels scolaires. */
@Injectable({ providedIn: 'root' })
export class CatalogApiService {
  private readonly http = inject(HttpClient);
  private readonly api = `${inject(APP_CONFIG).apiBaseUrl}/catalog`;
  private readonly customersApi = `${inject(APP_CONFIG).apiBaseUrl}/customers`;

  // Articles
  listArticles(query: CatalogQuery): Observable<Paginated<Article>> {
    return this.http.get<Paginated<Article>>(`${this.api}/articles/`, { params: toHttpParams(query) });
  }
  getArticle(id: string): Observable<Article> {
    return this.http.get<Article>(`${this.api}/articles/${id}/`);
  }
  createArticle(article: ArticleInput): Observable<Article> {
    return this.http.post<Article>(`${this.api}/articles/`, article);
  }
  updateArticle(id: string, changes: ArticleInput): Observable<Article> {
    return this.http.patch<Article>(`${this.api}/articles/${id}/`, changes);
  }
  deleteArticle(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/articles/${id}/`);
  }
  lookupArticles(search: string, excludeKits = false): Observable<ArticleLookup[]> {
    return this.http.get<ArticleLookup[]>(`${this.api}/articles/lookup/`, {
      params: toHttpParams({ search, exclude_kits: excludeKits || null, is_active: true }),
    });
  }
  articleByBarcode(code: string): Observable<Article> {
    return this.http.get<Article>(`${this.api}/articles/by-barcode/`, { params: { code } });
  }
  generateBarcode(id: string): Observable<Barcode> {
    return this.http.post<Barcode>(`${this.api}/articles/${id}/generate-barcode/`, {});
  }
  priceHistory(id: string): Observable<PriceHistoryEntry[]> {
    return this.http.get<PriceHistoryEntry[]>(`${this.api}/articles/${id}/price-history/`);
  }
  uploadImage(id: string, file: File): Observable<ArticleImage> {
    const form = new FormData();
    form.append('image', file);
    return this.http.post<ArticleImage>(`${this.api}/articles/${id}/images/`, form);
  }
  deleteImage(id: string, imageId: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/articles/${id}/images/${imageId}/`);
  }

  // Référentiels
  listCategories(): Observable<Category[]> {
    return this.http.get<Category[]>(`${this.api}/categories/`);
  }
  saveCategory(category: Partial<Category>): Observable<Category> {
    return category.id
      ? this.http.patch<Category>(`${this.api}/categories/${category.id}/`, category)
      : this.http.post<Category>(`${this.api}/categories/`, category);
  }
  deleteCategory(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/categories/${id}/`);
  }
  listBrands(): Observable<Brand[]> {
    return this.http.get<Brand[]>(`${this.api}/brands/`);
  }
  createBrand(name: string): Observable<Brand> {
    return this.http.post<Brand>(`${this.api}/brands/`, { name });
  }
  listUnits(): Observable<Unit[]> {
    return this.http.get<Unit[]>(`${this.api}/units/`);
  }
  listLevels(): Observable<SchoolLevel[]> {
    return this.http.get<SchoolLevel[]>(`${this.api}/levels/`);
  }
  saveLevel(level: Partial<SchoolLevel>): Observable<SchoolLevel> {
    return level.id
      ? this.http.patch<SchoolLevel>(`${this.api}/levels/${level.id}/`, level)
      : this.http.post<SchoolLevel>(`${this.api}/levels/`, level);
  }
  listSchoolYears(): Observable<SchoolYear[]> {
    return this.http.get<SchoolYear[]>(`${this.api}/school-years/`);
  }
  saveSchoolYear(year: Partial<SchoolYear>): Observable<SchoolYear> {
    return year.id
      ? this.http.patch<SchoolYear>(`${this.api}/school-years/${year.id}/`, year)
      : this.http.post<SchoolYear>(`${this.api}/school-years/`, year);
  }
  listSchools(query: CatalogQuery = {}): Observable<Paginated<School>> {
    return this.http.get<Paginated<School>>(`${this.customersApi}/schools/`, {
      params: toHttpParams({ page_size: 500, ...query }),
    });
  }
  saveSchool(school: Partial<School>): Observable<School> {
    return school.id
      ? this.http.patch<School>(`${this.customersApi}/schools/${school.id}/`, school)
      : this.http.post<School>(`${this.customersApi}/schools/`, school);
  }

  // Kits
  listKits(query: CatalogQuery): Observable<Paginated<Kit>> {
    return this.http.get<Paginated<Kit>>(`${this.api}/kits/`, { params: toHttpParams(query) });
  }
  getKit(id: string): Observable<Kit> {
    return this.http.get<Kit>(`${this.api}/kits/${id}/`);
  }
  createKit(kit: KitInput): Observable<Kit> {
    return this.http.post<Kit>(`${this.api}/kits/`, kit);
  }
  updateKit(id: string, kit: KitInput): Observable<Kit> {
    return this.http.put<Kit>(`${this.api}/kits/${id}/`, kit);
  }
  deleteKit(id: string): Observable<void> {
    return this.http.delete<void>(`${this.api}/kits/${id}/`);
  }
  duplicateKit(id: string, target: { name?: string; level?: string; school?: string | null; school_year?: string }) {
    return this.http.post<Kit>(`${this.api}/kits/${id}/duplicate/`, target);
  }

  // Excel
  downloadArticles(query: CatalogQuery = {}): Observable<Blob> {
    return this.http.get(`${this.api}/articles/export/`, { params: toHttpParams(query), responseType: 'blob' });
  }
  downloadKits(query: CatalogQuery = {}): Observable<Blob> {
    return this.http.get(`${this.api}/kits/export/`, { params: toHttpParams(query), responseType: 'blob' });
  }
  downloadTemplate(kind: 'articles' | 'kits'): Observable<Blob> {
    return this.http.get(`${this.api}/templates/${kind}/`, { responseType: 'blob' });
  }
  importFile(kind: 'articles' | 'kits', file: File, dryRun: boolean): Observable<ImportResult> {
    const form = new FormData();
    form.append('file', file);
    form.append('dry_run', String(dryRun));
    return this.http.post<ImportResult>(`${this.api}/import/${kind}/`, form);
  }
}

/** Déclenche le téléchargement d'un fichier reçu de l'API. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
