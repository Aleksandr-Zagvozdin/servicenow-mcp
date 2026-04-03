/**
 * Safe query builder for ServiceNow encoded queries.
 *
 * Prevents query injection by escaping special characters in user-provided
 * values before they are interpolated into encoded query strings.
 *
 * ServiceNow encoded queries use `^` as AND, `^OR` as OR, and `^NQ` as
 * new-query. If user input contains these operators unescaped, it can alter
 * the intended query logic.
 */

/** Check if a string is a valid ServiceNow sys_id (32-char hex). */
export function isSysId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

/**
 * Resolve a "number_or_sysid" identifier to a record.
 * If the value looks like a sys_id, fetches by sys_id directly.
 * Otherwise queries by number (or a custom lookup query).
 */
export async function resolveIdentifier(
  client: { getRecord: (table: string, sysId: string) => Promise<unknown>; queryRecords: (params: { table: string; query: string; limit: number }) => Promise<{ count: number; records: unknown[] }> },
  table: string,
  identifier: string,
  lookupQuery?: string,
): Promise<unknown> {
  if (isSysId(identifier)) {
    return client.getRecord(table, identifier);
  }
  const query = lookupQuery ?? `number=${identifier}`;
  const resp = await client.queryRecords({ table, query, limit: 1 });
  if (resp.count === 0) {
    throw new Error(`Record not found in ${table}: ${identifier}`);
  }
  return resp.records[0];
}

/**
 * Escape a user-provided value for use in a ServiceNow encoded query.
 * Removes or escapes characters that could be interpreted as query operators.
 */
export function escapeQueryValue(value: string): string {
  return value
    // Remove null bytes
    .replace(/\0/g, '')
    // Escape carets (query operator prefix) by doubling them
    // ServiceNow treats ^^ as a literal caret in encoded queries
    .replace(/\^/g, '^^');
}

/** Condition operators supported by the builder. */
type Operator = '=' | '!=' | 'LIKE' | 'CONTAINS' | 'STARTSWITH' | 'ENDSWITH' | 'IN'
  | '>' | '>=' | '<' | '<=' | 'ISEMPTY' | 'ISNOTEMPTY'
  | 'SAMEAS' | 'NSAMEAS';

interface Condition {
  field: string;
  operator: Operator;
  value?: string;
  join: 'AND' | 'OR';
}

/**
 * Fluent query builder that produces safe ServiceNow encoded query strings.
 *
 * @example
 * ```ts
 * const q = new QueryBuilder()
 *   .where('active', '=', 'true')
 *   .and('priority', '<=', '2')
 *   .and('short_description', 'LIKE', userInput)
 *   .build();
 * // => "active=true^priority<=2^short_descriptionLIKE<escaped_userInput>"
 * ```
 */
export class QueryBuilder {
  private conditions: Condition[] = [];

  /** Add the first condition (or append as AND). */
  where(field: string, operator: Operator, value?: string): this {
    this.conditions.push({ field, operator, value, join: 'AND' });
    return this;
  }

  /** Add an AND condition. */
  and(field: string, operator: Operator, value?: string): this {
    this.conditions.push({ field, operator, value, join: 'AND' });
    return this;
  }

  /** Add an OR condition. */
  or(field: string, operator: Operator, value?: string): this {
    this.conditions.push({ field, operator, value, join: 'OR' });
    return this;
  }

  /** Conditionally add an AND condition (only if `value` is truthy). */
  andIf(field: string, operator: Operator, value: string | undefined | null): this {
    if (value != null && value !== '') {
      this.conditions.push({ field, operator, value, join: 'AND' });
    }
    return this;
  }

  /** Conditionally add an OR condition (only if `value` is truthy). */
  orIf(field: string, operator: Operator, value: string | undefined | null): this {
    if (value != null && value !== '') {
      this.conditions.push({ field, operator, value, join: 'OR' });
    }
    return this;
  }

  /** Build the encoded query string. All values are escaped. */
  build(): string {
    if (this.conditions.length === 0) return '';

    let query = '';
    for (let i = 0; i < this.conditions.length; i++) {
      const cond = this.conditions[i];

      // Add join operator between conditions (not before the first)
      if (i > 0) {
        query += cond.join === 'OR' ? '^OR' : '^';
      }

      // Unary operators (no value needed)
      if (cond.operator === 'ISEMPTY' || cond.operator === 'ISNOTEMPTY') {
        query += `${cond.field}${cond.operator}`;
      } else {
        const escapedValue = escapeQueryValue(cond.value ?? '');
        query += `${cond.field}${cond.operator}${escapedValue}`;
      }
    }

    return query;
  }
}

/**
 * Build a simple query string from optional field=value conditions.
 * Convenience wrapper for the common pattern of chaining optional filters.
 *
 * @example
 * ```ts
 * const query = buildSimpleQuery([
 *   ['active', args.active],
 *   ['collection', args.table],
 *   ['type', args.type],
 * ]);
 * ```
 */
export function buildSimpleQuery(
  conditions: Array<[field: string, value: string | boolean | number | undefined | null]>
): string | undefined {
  const qb = new QueryBuilder();
  for (const [field, value] of conditions) {
    if (value != null && value !== '') {
      qb.and(field, '=', String(value));
    }
  }
  const result = qb.build();
  return result || undefined;
}
