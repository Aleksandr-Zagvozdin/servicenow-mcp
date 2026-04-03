import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeScriptToolCall, getScriptToolDefinitions } from '../../src/tools/script.js';
import type { ServiceNowClient } from '../../src/servicenow/client.js';

const mockClient = {
  queryRecords: vi.fn(),
  getRecord: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
} as unknown as ServiceNowClient;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WRITE_ENABLED = 'true';
  process.env.SCRIPTING_ENABLED = 'true';
});

describe('getScriptToolDefinitions', () => {
  it('returns tool definitions with required fields', () => {
    const tools = getScriptToolDefinitions();
    expect(tools.length).toBeGreaterThan(0);
    tools.forEach(t => {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
    });
  });
});

describe('executeScriptToolCall – requires scripting permission', () => {
  it('throws when SCRIPTING_ENABLED is false', async () => {
    process.env.SCRIPTING_ENABLED = 'false';
    await expect(
      executeScriptToolCall(mockClient, 'list_business_rules', {})
    ).rejects.toThrow('Scripting operations are disabled');
  });

  it('throws when WRITE_ENABLED is false', async () => {
    process.env.WRITE_ENABLED = 'false';
    await expect(
      executeScriptToolCall(mockClient, 'list_business_rules', {})
    ).rejects.toThrow('Write operations are disabled');
  });
});

describe('executeScriptToolCall – list_business_rules', () => {
  it('returns business rules', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 2, records: [{ sys_id: 'br1', name: 'Rule1' }, { sys_id: 'br2', name: 'Rule2' }],
    });
    const result = await executeScriptToolCall(mockClient, 'list_business_rules', {});
    expect(result.count).toBe(2);
    expect(result.business_rules).toHaveLength(2);
  });

  it('filters by table and active', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, records: [{ sys_id: 'br1' }] });
    await executeScriptToolCall(mockClient, 'list_business_rules', { table: 'incident', active: true });
    const call = (mockClient.queryRecords as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.query).toContain('active=true');
    expect(call.query).toContain('collection=incident');
  });
});

describe('executeScriptToolCall – get_business_rule', () => {
  it('returns rule by sys_id', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ sys_id: 'br1', name: 'Test Rule' });
    const result = await executeScriptToolCall(mockClient, 'get_business_rule', { sys_id: 'br1' });
    expect(result.name).toBe('Test Rule');
  });

  it('throws when sys_id is missing', async () => {
    await expect(
      executeScriptToolCall(mockClient, 'get_business_rule', {})
    ).rejects.toThrow('sys_id is required');
  });
});

describe('executeScriptToolCall – create_business_rule', () => {
  it('creates a rule with required fields', async () => {
    (mockClient.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ sys_id: 'br_new' });
    const result = await executeScriptToolCall(mockClient, 'create_business_rule', {
      name: 'New Rule', table: 'incident', when: 'before', script: 'current.update();',
    });
    expect(result.summary).toContain('Created business rule New Rule');
    const call = (mockClient.createRecord as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe('sys_script');
    expect(call[1].collection).toBe('incident');
  });

  it('throws when required fields are missing', async () => {
    await expect(
      executeScriptToolCall(mockClient, 'create_business_rule', { name: 'x' })
    ).rejects.toThrow('name, table, when, and script are required');
  });
});

describe('executeScriptToolCall – commit_changeset', () => {
  it('sets state to complete', async () => {
    (mockClient.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ sys_id: 'us1', state: 'complete' });
    const result = await executeScriptToolCall(mockClient, 'commit_changeset', { sys_id: 'us1' });
    expect(result.summary).toContain('Committed changeset');
    const call = (mockClient.updateRecord as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[2].state).toBe('complete');
  });
});

describe('executeScriptToolCall – publish_changeset', () => {
  it('retrieves XML entries for export', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'My Update Set', state: 'complete' });
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 5, records: [] });
    const result = await executeScriptToolCall(mockClient, 'publish_changeset', { sys_id: 'us1' });
    expect(result.action).toBe('published');
    expect(result.entries).toBe(5);
    expect(result.summary).toContain('5 entries');
  });

  it('completes update set if not already complete', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Draft US', state: 'in progress' });
    (mockClient.updateRecord as ReturnType<typeof vi.fn>).mockResolvedValue({});
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, records: [] });
    await executeScriptToolCall(mockClient, 'publish_changeset', { sys_id: 'us1' });
    expect(mockClient.updateRecord).toHaveBeenCalledWith('sys_update_set', 'us1', { state: 'complete' });
  });

  it('skips update if already complete', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Done US', state: 'complete' });
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, records: [] });
    await executeScriptToolCall(mockClient, 'publish_changeset', { sys_id: 'us1' });
    expect(mockClient.updateRecord).not.toHaveBeenCalled();
  });
});

describe('executeScriptToolCall – get_script_include', () => {
  it('fetches by sys_id when 32 hex chars', async () => {
    const sysId = 'a'.repeat(32);
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ sys_id: sysId, name: 'MyUtils' });
    const result = await executeScriptToolCall(mockClient, 'get_script_include', { sys_id_or_name: sysId });
    expect(result.name).toBe('MyUtils');
    expect(mockClient.getRecord).toHaveBeenCalledWith('sys_script_include', sysId);
  });

  it('fetches by name using queryRecords', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({
      count: 1, records: [{ sys_id: 'si1', name: 'MyUtils' }],
    });
    const result = await executeScriptToolCall(mockClient, 'get_script_include', { sys_id_or_name: 'MyUtils' });
    expect(result.name).toBe('MyUtils');
  });

  it('throws NOT_FOUND when name not found', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, records: [] });
    await expect(
      executeScriptToolCall(mockClient, 'get_script_include', { sys_id_or_name: 'NonExistent' })
    ).rejects.toThrow('Script include not found');
  });
});

describe('executeScriptToolCall – create_acl', () => {
  it('creates an ACL with required fields', async () => {
    (mockClient.createRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ sys_id: 'acl1' });
    const result = await executeScriptToolCall(mockClient, 'create_acl', {
      name: 'incident.*', operation: 'read',
    });
    expect(result.summary).toContain('Created ACL');
  });

  it('throws when required fields are missing', async () => {
    await expect(
      executeScriptToolCall(mockClient, 'create_acl', { name: 'x' })
    ).rejects.toThrow('name and operation are required');
  });
});

describe('executeScriptToolCall – unknown tool', () => {
  it('returns null for unknown tool names', async () => {
    const result = await executeScriptToolCall(mockClient, 'nonexistent_tool', {});
    expect(result).toBeNull();
  });
});
