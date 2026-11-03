import { Directive, TemplateRef, ViewContainerRef, effect, inject, input } from '@angular/core';

import { AuthService } from './auth.service';

/** Affiche le contenu uniquement si l'utilisateur possède la permission : `*libHasPermission="'sales.create'"`. */
@Directive({ selector: '[libHasPermission]' })
export class HasPermissionDirective {
  private readonly auth = inject(AuthService);
  private readonly template = inject(TemplateRef<unknown>);
  private readonly container = inject(ViewContainerRef);
  private shown = false;

  readonly libHasPermission = input<string | null>(null);

  constructor() {
    effect(() => {
      const allowed = this.auth.hasPermission(this.libHasPermission());
      if (allowed && !this.shown) {
        this.container.createEmbeddedView(this.template);
        this.shown = true;
      } else if (!allowed && this.shown) {
        this.container.clear();
        this.shown = false;
      }
    });
  }
}
