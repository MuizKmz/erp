import { Injectable } from '@nestjs/common';
import { catalogueError, type ModulePermissions } from './permission.rules';

/**
 * Every permission the modules declare (SRS FR-SEC-010). Each module registers its own at start-up; Configuration reads
 * the whole catalogue for the role editor and the starter roles. A role may only hold keys from here (Phase 4, rule 5).
 */
@Injectable()
export class PermissionCatalogue {
  private readonly declared: ModulePermissions[] = [];

  register(module: ModulePermissions): void {
    const error = catalogueError(this.declared, module);
    if (error) throw new Error(`Permission catalogue: ${error}`);
    this.declared.push(module);
  }

  /** In the order the modules registered: Purchase, Sales, Core, Configuration. */
  modules(): readonly ModulePermissions[] {
    return this.declared;
  }

  keys(): Set<string> {
    return new Set(this.declared.flatMap((m) => m.permissions.map((p) => p.key)));
  }
}
