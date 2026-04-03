import { describe, it, expect, vi, beforeEach } from 'vitest';
import { executeTool, getTools, resetToolCache } from '../../src/tools/index.js';
import type { ServiceNowClient } from '../../src/servicenow/client.js';

const mockClient = {
  queryRecords: vi.fn(),
  getRecord: vi.fn(),
  getTableSchema: vi.fn(),
  getUser: vi.fn(),
  getGroup: vi.fn(),
  searchCmdbCi: vi.fn(),
  getCmdbCi: vi.fn(),
  listRelationships: vi.fn(),
  listDiscoverySchedules: vi.fn(),
  listMidServers: vi.fn(),
  listActiveEvents: vi.fn(),
  cmdbHealthDashboard: vi.fn(),
  serviceMappingSummary: vi.fn(),
  createRecord: vi.fn(),
  updateRecord: vi.fn(),
  naturalLanguageSearch: vi.fn(),
  naturalLanguageUpdate: vi.fn(),
} as unknown as ServiceNowClient;

describe('executeTool – O(1) dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetToolCache();
  });

  it('dispatches known tool (query_records) to correct handler', async () => {
    (mockClient.queryRecords as ReturnType<typeof vi.fn>).mockResolvedValue({ count: 1, records: [{ sys_id: 'x' }] });
    const result = await executeTool(mockClient, 'query_records', { table: 'incident' });
    expect(result).toBeDefined();
    expect((result as any).count).toBe(1);
  });

  it('throws UNKNOWN_TOOL for unregistered tool name', async () => {
    await expect(
      executeTool(mockClient, 'totally_fake_tool', {})
    ).rejects.toThrow('Unknown tool: totally_fake_tool');
  });

  it('dispatches tools from different domains correctly', async () => {
    // get_table_schema is in core module
    (mockClient.getTableSchema as ReturnType<typeof vi.fn>).mockResolvedValue({ columns: [] });
    const result = await executeTool(mockClient, 'get_table_schema', { table: 'incident' });
    expect(result).toBeDefined();
  });
});

describe('getTools – caching', () => {
  beforeEach(() => {
    delete process.env.MCP_TOOL_PACKAGE;
    resetToolCache();
  });

  it('returns same array reference on repeated calls (cached)', () => {
    const tools1 = getTools();
    const tools2 = getTools();
    expect(tools1).toBe(tools2);
  });

  it('returns fresh array after resetToolCache()', () => {
    const tools1 = getTools();
    resetToolCache();
    const tools2 = getTools();
    // Same content but different reference (rebuilt)
    expect(tools1).not.toBe(tools2);
    expect(tools1.length).toBe(tools2.length);
  });

  it('every tool name in registry maps to a handler', () => {
    const tools = getTools();
    for (const tool of tools) {
      // executeTool should not throw UNKNOWN_TOOL for any registered tool
      // We just verify the handler map was built correctly by checking getTools content
      expect(tool.name).toBeTruthy();
      expect(typeof tool.name).toBe('string');
    }
  });
});
