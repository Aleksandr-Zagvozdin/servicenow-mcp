import { describe, it, expect } from 'vitest';
import { escapeQueryValue, QueryBuilder, buildSimpleQuery } from '../../src/utils/query-builder.js';

describe('escapeQueryValue', () => {
  it('returns plain values unchanged', () => {
    expect(escapeQueryValue('hello')).toBe('hello');
    expect(escapeQueryValue('INC0001234')).toBe('INC0001234');
  });

  it('escapes carets to prevent query injection', () => {
    expect(escapeQueryValue('foo^ORbar=baz')).toBe('foo^^ORbar=baz');
  });

  it('escapes multiple carets', () => {
    expect(escapeQueryValue('a^b^c')).toBe('a^^b^^c');
  });

  it('removes null bytes', () => {
    expect(escapeQueryValue('hello\0world')).toBe('helloworld');
  });

  it('handles empty string', () => {
    expect(escapeQueryValue('')).toBe('');
  });
});

describe('QueryBuilder', () => {
  it('builds a single condition', () => {
    const q = new QueryBuilder().where('active', '=', 'true').build();
    expect(q).toBe('active=true');
  });

  it('chains AND conditions', () => {
    const q = new QueryBuilder()
      .where('active', '=', 'true')
      .and('priority', '<=', '2')
      .build();
    expect(q).toBe('active=true^priority<=2');
  });

  it('chains OR conditions', () => {
    const q = new QueryBuilder()
      .where('state', '=', '1')
      .or('state', '=', '2')
      .build();
    expect(q).toBe('state=1^ORstate=2');
  });

  it('handles LIKE operator', () => {
    const q = new QueryBuilder()
      .where('short_description', 'LIKE', 'network')
      .build();
    expect(q).toBe('short_descriptionLIKEnetwork');
  });

  it('handles unary operators (ISEMPTY, ISNOTEMPTY)', () => {
    const q = new QueryBuilder()
      .where('assigned_to', 'ISEMPTY')
      .build();
    expect(q).toBe('assigned_toISEMPTY');
  });

  it('escapes user input in values', () => {
    const malicious = 'test^ORactive=true^NQpriority=1';
    const q = new QueryBuilder()
      .where('short_description', 'LIKE', malicious)
      .build();
    expect(q).toBe('short_descriptionLIKEtest^^ORactive=true^^NQpriority=1');
    // The ^OR and ^NQ are no longer query operators because ^ is escaped
  });

  it('andIf skips condition when value is undefined', () => {
    const q = new QueryBuilder()
      .where('active', '=', 'true')
      .andIf('table', '=', undefined)
      .build();
    expect(q).toBe('active=true');
  });

  it('andIf includes condition when value is provided', () => {
    const q = new QueryBuilder()
      .where('active', '=', 'true')
      .andIf('table', '=', 'incident')
      .build();
    expect(q).toBe('active=true^table=incident');
  });

  it('orIf skips condition when value is null', () => {
    const q = new QueryBuilder()
      .where('state', '=', '1')
      .orIf('state', '=', null)
      .build();
    expect(q).toBe('state=1');
  });

  it('returns empty string when no conditions', () => {
    expect(new QueryBuilder().build()).toBe('');
  });
});

describe('buildSimpleQuery', () => {
  it('builds query from field-value pairs', () => {
    const q = buildSimpleQuery([
      ['active', true],
      ['collection', 'incident'],
    ]);
    expect(q).toBe('active=true^collection=incident');
  });

  it('skips undefined values', () => {
    const q = buildSimpleQuery([
      ['active', true],
      ['table', undefined],
      ['type', 'onLoad'],
    ]);
    expect(q).toBe('active=true^type=onLoad');
  });

  it('returns undefined when all values are empty', () => {
    const q = buildSimpleQuery([
      ['active', undefined],
      ['table', undefined],
    ]);
    expect(q).toBeUndefined();
  });

  it('handles boolean and number values', () => {
    const q = buildSimpleQuery([
      ['active', false],
      ['priority', 1],
    ]);
    expect(q).toBe('active=false^priority=1');
  });
});
