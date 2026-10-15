/** Small text helpers for Configuration's messages and card lines. Pure. */

/** "Purchase, Sales, Core and Configuration". */
export function joinAnd(items: readonly string[]): string {
  return items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** "1 user", "2 users". */
export function countOf(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** At most `max` names, then "and 2 more": "Aina Rahman, Hafiz, Nurul and 2 more". */
export function someNames(names: readonly string[], max = 3): string {
  return names.length <= max ? joinAnd(names) : `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
}
