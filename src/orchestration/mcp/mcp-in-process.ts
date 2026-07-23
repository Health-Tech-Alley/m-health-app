/**
 * In-process MCP server and client.
 *
 * The official @modelcontextprotocol/sdk is designed for Node.js stdio/SSE
 * transports and does not bundle cleanly in React Native. For v1 we therefore
 * implement a lightweight in-process protocol that preserves the MCP shape
 * (tool schemas + callTool) without a network transport.
 *
 * If a future desktop/CLI consumer needs stdio/SSE, this server can be wrapped
 * with the official SDK without changing the tool handlers.
 */

import type { RegisteredTool, ToolResult, ToolSchema } from './tool-registry';
import { ToolRegistry } from './tool-registry';

export type McpServerConfig = {
  tools: RegisteredTool[];
};

export class InProcessMcpServer {
  private registry = new ToolRegistry();

  constructor(config: McpServerConfig) {
    for (const tool of config.tools) {
      this.registry.register(tool);
    }
  }

  listTools(): ToolSchema[] {
    return this.registry.schemas();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.registry.get(name);
    if (!tool) {
      return { ok: false, error: `Unknown tool: ${name}` };
    }
    try {
      return await tool.handler(args);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export class InProcessMcpClient {
  constructor(private server: InProcessMcpServer) {}

  async listTools(): Promise<ToolSchema[]> {
    return this.server.listTools();
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    return this.server.callTool(name, args);
  }
}

export function createInProcessMcp(config: McpServerConfig): {
  server: InProcessMcpServer;
  client: InProcessMcpClient;
} {
  const server = new InProcessMcpServer(config);
  const client = new InProcessMcpClient(server);
  return { server, client };
}
