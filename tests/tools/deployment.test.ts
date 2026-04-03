import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeDeploymentToolCall, getDeploymentToolDefinitions } from '../../src/tools/deployment.js';
import type { ServiceNowClient } from '../../src/servicenow/client.js';

const mockClient = {
  queryRecords: vi.fn(),
  getRecord: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  callNowAssist: vi.fn(),
} as unknown as ServiceNowClient;

describe('getDeploymentToolDefinitions', () => {
  it('returns 10 deployment tool definitions', () => {
    expect(getDeploymentToolDefinitions().length).toBe(10);
  });

  it('all tools have name, description and inputSchema', () => {
    getDeploymentToolDefinitions().forEach(t => {
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.inputSchema).toBeTruthy();
    });
  });
});

describe('executeDeploymentToolCall – find_artifact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('searches by name on sys_metadata when no type given', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, records: [{ sys_id: 'a1' }] });
    const result = await executeDeploymentToolCall(mockClient, 'find_artifact', { name: 'MyRule' });
    expect(result.count).toBe(1);
    const call = (mockClient.queryRecords as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.table).toBe('sys_metadata');
    expect(call.query).toContain('MyRule');
  });

  it('maps type to correct table', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, records: [] });
    await executeDeploymentToolCall(mockClient, 'find_artifact', { name: 'x', type: 'business_rule' });
    const call = (mockClient.queryRecords as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(call.table).toBe('sys_script');
  });

  it('throws when name is missing', async () => {
    await expect(executeDeploymentToolCall(mockClient, 'find_artifact', {})).rejects.toThrow('name is required');
  });
});

describe('executeDeploymentToolCall – validate_artifact', () => {
  beforeEach(() => vi.clearAllMocks());

  it('detects eval() in script', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Bad Rule', script: 'eval("something")', active: 'true' });
    const result = await executeDeploymentToolCall(mockClient, 'validate_artifact', { table: 'sys_script', sys_id: 'abc' });
    expect(result.status).toBe('REVIEW');
    expect(result.issues).toContain('SECURITY: eval() usage detected');
  });

  it('passes clean scripts', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'Good Rule', script: 'var gr = new GlideRecord("x"); gr.addQuery("y", "z"); gr.query();', active: 'true' });
    const result = await executeDeploymentToolCall(mockClient, 'validate_artifact', { table: 'sys_script', sys_id: 'abc' });
    expect(result.status).toBe('PASS');
    expect(result.issues_found).toBe(0);
  });
});

describe('executeDeploymentToolCall – execute_background_script', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.WRITE_ENABLED = 'true';
    process.env.SCRIPTING_ENABLED = 'true';
  });

  it('executes valid scripts', async () => {
    (mockClient.callNowAssist as ReturnType<typeof vi.fn>).mockResolvedValue({ output: 'ok' });
    const result = await executeDeploymentToolCall(mockClient, 'execute_background_script', {
      script: 'gs.info("Hello");',
    });
    expect(result.action).toBe('executed');
  });

  it('blocks eval()', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'var x = eval("code");',
      })
    ).rejects.toThrow('Script validation failed');
  });

  it('blocks new Function()', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'var fn = new Function("return 1");',
      })
    ).rejects.toThrow('Script validation failed');
  });

  it('blocks gs.sleep()', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'gs.sleep(5000);',
      })
    ).rejects.toThrow('Script validation failed');
  });

  it('blocks Glide.db()', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'Glide.db().execute("DROP TABLE");',
      })
    ).rejects.toThrow('Script validation failed');
  });

  it('blocks GlideRecordSecure deleteMultiple', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'var gr = new GlideRecordSecure("incident"); gr.deleteMultiple();',
      })
    ).rejects.toThrow('Script validation failed');
  });

  it('blocks when SCRIPTING_ENABLED is false', async () => {
    process.env.SCRIPTING_ENABLED = 'false';
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {
        script: 'gs.info("test");',
      })
    ).rejects.toThrow('Scripting operations are disabled');
  });

  it('throws when script is missing', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'execute_background_script', {})
    ).rejects.toThrow('script is required');
  });

  it('returns failed status on API error', async () => {
    (mockClient.callNowAssist as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('API timeout'));
    const result = await executeDeploymentToolCall(mockClient, 'execute_background_script', {
      script: 'gs.info("test");',
    });
    expect(result.action).toBe('failed');
    expect(result.error).toContain('API timeout');
  });
});

describe('executeDeploymentToolCall – validate_deployment', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates update set and returns READY when complete', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'My US', state: 'complete' });
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 3, records: [{ sys_id: 'x1' }] });
    const result = await executeDeploymentToolCall(mockClient, 'validate_deployment', { update_set_sys_id: 'us1' });
    expect(result.validation).toBe('READY');
    expect(result.total_changes).toBe(3);
  });

  it('returns NOT_COMPLETE when update set is in progress', async () => {
    (mockClient.getRecord as ReturnType<typeof vi.fn>).mockResolvedValue({ name: 'My US', state: 'in progress' });
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 0, records: [] });
    const result = await executeDeploymentToolCall(mockClient, 'validate_deployment', { update_set_sys_id: 'us1' });
    expect(result.validation).toBe('NOT_COMPLETE');
  });

  it('throws when neither sys_id nor app_sys_id provided', async () => {
    await expect(
      executeDeploymentToolCall(mockClient, 'validate_deployment', {})
    ).rejects.toThrow('update_set_sys_id or app_sys_id required');
  });
});

describe('executeDeploymentToolCall – unknown tool', () => {
  it('returns null for unknown tool names', async () => {
    const result = await executeDeploymentToolCall(mockClient, 'nonexistent_tool', {});
    expect(result).toBeNull();
  });
});
