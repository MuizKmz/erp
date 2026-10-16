import { Injectable } from '@nestjs/common';
import type { ScopeRule } from './scope.rules';

/**
 * Which tables are scoped and how (CLAUDE.md → Phase 4, module boundaries rule 3). Each module registers rules for its
 * own tables at start-up, the way it registers outbox listeners and record-usage providers; the platform applies them.
 */
@Injectable()
export class ScopeRegistry {
  private readonly rules = new Map<string, ScopeRule>();

  register(rules: readonly ScopeRule[]): void {
    for (const rule of rules) {
      const taken = this.rules.get(rule.model);
      if (taken) throw new Error(`${rule.model} is already scoped by ${taken.module}`);
      this.rules.set(rule.model, rule);
    }
  }

  ruleFor(model: string | undefined): ScopeRule | undefined {
    return model ? this.rules.get(model) : undefined;
  }

  all(): ScopeRule[] {
    return [...this.rules.values()];
  }
}
