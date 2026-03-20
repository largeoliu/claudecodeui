import express from 'express';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { createRequestAbortController, runCommand } from '../utils/process-runner.js';

const router = express.Router();
const DEFAULT_TIMEOUT_MS = 30_000;

async function runChildProcessWithTransform(args, options, timeoutMs, req, res, onSuccess) {
  const requestAbort = createRequestAbortController(req, res);
  try {
    const result = await runCommand(args[0], args.slice(1), {
      ...options,
      timeoutMs,
      maxStdoutBytes: 256 * 1024,
      maxStderrBytes: 256 * 1024,
      signal: requestAbort.signal,
    });
    onSuccess(result.stdout);
  } catch (error) {
    if (requestAbort.signal.aborted || res.headersSent) {
      return;
    }
    if (error.code === 'ETIMEDOUT') {
      console.warn(`[MCP] Process timed out after ${timeoutMs}ms: ${args.join(' ')}`);
      res.status(504).json({ error: 'Command timed out', details: `Process exceeded ${timeoutMs / 1000}s limit` });
      return;
    }
    res.status(500).json({ error: 'CLI command failed', details: error.stderr || error.message });
  } finally {
    requestAbort.cleanup();
  }
}

// Claude CLI command routes

// GET /api/mcp/cli/list - List MCP servers using Claude CLI
router.get('/cli/list', async (req, res) => {
  try {
    console.log('📋 Listing MCP servers using Claude CLI');
    await runChildProcessWithTransform(
      ['claude', 'mcp', 'list'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
      DEFAULT_TIMEOUT_MS,
      req,
      res,
      (stdout) => res.json({ success: true, output: stdout, servers: parseClaudeListOutput(stdout) })
    );
  } catch (error) {
    console.error('Error listing MCP servers via CLI:', error);
    res.status(500).json({ error: 'Failed to list MCP servers', details: error.message });
  }
});

// POST /api/mcp/cli/add - Add MCP server using Claude CLI
router.post('/cli/add', async (req, res) => {
  try {
    const { name, type = 'stdio', command, args = [], url, headers = {}, env = {}, scope = 'user', projectPath } = req.body;

    console.log(`➕ Adding MCP server using Claude CLI (${scope} scope):`, name);

    let cliArgs = ['mcp', 'add'];

    cliArgs.push('--scope', scope);

    if (type === 'http') {
      cliArgs.push('--transport', 'http', name, url);
      Object.entries(headers).forEach(([key, value]) => {
        cliArgs.push('--header', `${key}: ${value}`);
      });
    } else if (type === 'sse') {
      cliArgs.push('--transport', 'sse', name, url);
      Object.entries(headers).forEach(([key, value]) => {
        cliArgs.push('--header', `${key}: ${value}`);
      });
    } else {
      cliArgs.push(name);
      Object.entries(env).forEach(([key, value]) => {
        cliArgs.push('-e', `${key}=${value}`);
      });
      cliArgs.push(command);
      if (args && args.length > 0) {
        cliArgs.push(...args);
      }
    }

    console.log('🔧 Running Claude CLI command:', 'claude', cliArgs.join(' '));

    const spawnOpts = { stdio: ['pipe', 'pipe', 'pipe'] };
    if (scope === 'local' && projectPath) {
      spawnOpts.cwd = projectPath;
      console.log('📁 Running in project directory:', projectPath);
    }

    await runChildProcessWithTransform(
      ['claude', ...cliArgs],
      spawnOpts,
      DEFAULT_TIMEOUT_MS,
      req,
      res,
      (stdout) => res.json({ success: true, output: stdout, message: `MCP server "${name}" added successfully` })
    );
  } catch (error) {
    console.error('Error adding MCP server via CLI:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// POST /api/mcp/cli/add-json - Add MCP server using JSON format
router.post('/cli/add-json', async (req, res) => {
  try {
    const { name, jsonConfig, scope = 'user', projectPath } = req.body;

    let parsedConfig;
    try {
      parsedConfig = typeof jsonConfig === 'string' ? JSON.parse(jsonConfig) : jsonConfig;
    } catch (parseError) {
      return res.status(400).json({ error: 'Invalid JSON configuration', details: parseError.message });
    }

    if (!parsedConfig.type) {
      return res.status(400).json({ error: 'Invalid configuration', details: 'Missing required field: type' });
    }

    if (parsedConfig.type === 'stdio' && !parsedConfig.command) {
      return res.status(400).json({ error: 'Invalid configuration', details: 'stdio type requires a command field' });
    }

    if ((parsedConfig.type === 'http' || parsedConfig.type === 'sse') && !parsedConfig.url) {
      return res.status(400).json({ error: 'Invalid configuration', details: `${parsedConfig.type} type requires a url field` });
    }

    const cliArgs = ['mcp', 'add-json', '--scope', scope, name];
    cliArgs.push(JSON.stringify(parsedConfig));

    console.log('🔧 Running Claude CLI command: claude', cliArgs.join(' '));

    const spawnOpts = { stdio: ['pipe', 'pipe', 'pipe'] };
    if (scope === 'local' && projectPath) {
      spawnOpts.cwd = projectPath;
    }

    await runChildProcessWithTransform(
      ['claude', ...cliArgs],
      spawnOpts,
      DEFAULT_TIMEOUT_MS,
      req,
      res,
      (stdout) => res.json({ success: true, output: stdout, message: `MCP server "${name}" added successfully via JSON` })
    );
  } catch (error) {
    console.error('Error adding MCP server via JSON:', error);
    res.status(500).json({ error: 'Failed to add MCP server', details: error.message });
  }
});

// DELETE /api/mcp/cli/remove/:name - Remove MCP server using Claude CLI
router.delete('/cli/remove/:name', async (req, res) => {
  try {
    const { name } = req.params;
    const { scope } = req.query;

    let actualName = name;
    let actualScope = scope;

    if (name.includes(':')) {
      const [prefix, serverName] = name.split(':');
      actualName = serverName;
      actualScope = actualScope || prefix;
    }

    console.log('🗑️ Removing MCP server using Claude CLI:', actualName, 'scope:', actualScope);

    let cliArgs = ['mcp', 'remove'];

    if (actualScope === 'local') {
      cliArgs.push('--scope', 'local');
    } else {
      cliArgs.push('--scope', 'user');
    }

    cliArgs.push(actualName);

    console.log('🔧 Running Claude CLI command: claude', cliArgs.join(' '));

    await runChildProcessWithTransform(
      ['claude', ...cliArgs],
      { stdio: ['pipe', 'pipe', 'pipe'] },
      DEFAULT_TIMEOUT_MS,
      req,
      res,
      (stdout) => res.json({ success: true, output: stdout, message: `MCP server "${name}" removed successfully` })
    );
  } catch (error) {
    console.error('Error removing MCP server via CLI:', error);
    res.status(500).json({ error: 'Failed to remove MCP server', details: error.message });
  }
});

// GET /api/mcp/cli/get/:name - Get MCP server details using Claude CLI
router.get('/cli/get/:name', async (req, res) => {
  try {
    const { name } = req.params;
    console.log('📄 Getting MCP server details using Claude CLI:', name);

    await runChildProcessWithTransform(
      ['claude', 'mcp', 'get', name],
      { stdio: ['pipe', 'pipe', 'pipe'] },
      DEFAULT_TIMEOUT_MS,
      req,
      res,
      (stdout) => res.json({ success: true, output: stdout, server: parseClaudeGetOutput(stdout) })
    );
  } catch (error) {
    console.error('Error getting MCP server details via CLI:', error);
    res.status(500).json({ error: 'Failed to get MCP server details', details: error.message });
  }
});

// GET /api/mcp/config/read - Read MCP servers directly from Claude config files
router.get('/config/read', async (req, res) => {
  try {
    console.log('📖 Reading MCP servers from Claude config files');
    
    const homeDir = os.homedir();
    const configPaths = [
      path.join(homeDir, '.claude.json'),
      path.join(homeDir, '.claude', 'settings.json')
    ];
    
    let configData = null;
    let configPath = null;
    
    // Try to read from either config file
    for (const filepath of configPaths) {
      try {
        const fileContent = await fs.readFile(filepath, 'utf8');
        configData = JSON.parse(fileContent);
        configPath = filepath;
        console.log(`✅ Found Claude config at: ${filepath}`);
        break;
      } catch (error) {
        // File doesn't exist or is not valid JSON, try next
        console.log(`ℹ️ Config not found or invalid at: ${filepath}`);
      }
    }
    
    if (!configData) {
      return res.json({ 
        success: false, 
        message: 'No Claude configuration file found',
        servers: [] 
      });
    }
    
    // Extract MCP servers from the config
    const servers = [];
    
    // Check for user-scoped MCP servers (at root level)
    if (configData.mcpServers && typeof configData.mcpServers === 'object' && Object.keys(configData.mcpServers).length > 0) {
      console.log('🔍 Found user-scoped MCP servers:', Object.keys(configData.mcpServers));
      for (const [name, config] of Object.entries(configData.mcpServers)) {
        const server = {
          id: name,
          name: name,
          type: 'stdio', // Default type
          scope: 'user',  // User scope - available across all projects
          config: {},
          raw: config // Include raw config for full details
        };
        
        // Determine transport type and extract config
        if (config.command) {
          server.type = 'stdio';
          server.config.command = config.command;
          server.config.args = config.args || [];
          server.config.env = config.env || {};
        } else if (config.url) {
          server.type = config.transport || 'http';
          server.config.url = config.url;
          server.config.headers = config.headers || {};
        }
        
        servers.push(server);
      }
    }
    
    // Check for local-scoped MCP servers (project-specific)
    const currentProjectPath = process.cwd();
    
    // Check under 'projects' key
    if (configData.projects && configData.projects[currentProjectPath]) {
      const projectConfig = configData.projects[currentProjectPath];
      if (projectConfig.mcpServers && typeof projectConfig.mcpServers === 'object' && Object.keys(projectConfig.mcpServers).length > 0) {
        console.log(`🔍 Found local-scoped MCP servers for ${currentProjectPath}:`, Object.keys(projectConfig.mcpServers));
        for (const [name, config] of Object.entries(projectConfig.mcpServers)) {
          const server = {
            id: `local:${name}`,  // Prefix with scope for uniqueness
            name: name,           // Keep original name
            type: 'stdio', // Default type
            scope: 'local',  // Local scope - only for this project
            projectPath: currentProjectPath,
            config: {},
            raw: config // Include raw config for full details
          };
          
          // Determine transport type and extract config
          if (config.command) {
            server.type = 'stdio';
            server.config.command = config.command;
            server.config.args = config.args || [];
            server.config.env = config.env || {};
          } else if (config.url) {
            server.type = config.transport || 'http';
            server.config.url = config.url;
            server.config.headers = config.headers || {};
          }
          
          servers.push(server);
        }
      }
    }
    
    console.log(`📋 Found ${servers.length} MCP servers in config`);
    
    res.json({ 
      success: true, 
      configPath: configPath,
      servers: servers 
    });
  } catch (error) {
    console.error('Error reading Claude config:', error);
    res.status(500).json({ 
      error: 'Failed to read Claude configuration', 
      details: error.message 
    });
  }
});

// Helper functions to parse Claude CLI output
function parseClaudeListOutput(output) {
  const servers = [];
  const lines = output.split('\n').filter(line => line.trim());
  
  for (const line of lines) {
    // Skip the header line
    if (line.includes('Checking MCP server health')) continue;
    
    // Parse lines like "test: test test - ✗ Failed to connect"
    // or "server-name: command or description - ✓ Connected"
    if (line.includes(':')) {
      const colonIndex = line.indexOf(':');
      const name = line.substring(0, colonIndex).trim();
      
      // Skip empty names
      if (!name) continue;
      
      // Extract the rest after the name
      const rest = line.substring(colonIndex + 1).trim();
      
      // Try to extract description and status
      let description = rest;
      let status = 'unknown';
      let type = 'stdio'; // default type
      
      // Check for status indicators
      if (rest.includes('✓') || rest.includes('✗')) {
        const statusMatch = rest.match(/(.*?)\s*-\s*([✓✗].*)$/);
        if (statusMatch) {
          description = statusMatch[1].trim();
          status = statusMatch[2].includes('✓') ? 'connected' : 'failed';
        }
      }
      
      // Try to determine type from description
      if (description.startsWith('http://') || description.startsWith('https://')) {
        type = 'http';
      }
      
      servers.push({
        name,
        type,
        status: status || 'active',
        description
      });
    }
  }
  
  console.log('🔍 Parsed Claude CLI servers:', servers);
  return servers;
}

function parseClaudeGetOutput(output) {
  // Parse the output from 'claude mcp get <name>' command
  // This is a simple parser - might need adjustment based on actual output format
  try {
    // Try to extract JSON if present
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Otherwise, parse as text
    const server = { raw_output: output };
    const lines = output.split('\n');
    
    for (const line of lines) {
      if (line.includes('Name:')) {
        server.name = line.split(':')[1]?.trim();
      } else if (line.includes('Type:')) {
        server.type = line.split(':')[1]?.trim();
      } else if (line.includes('Command:')) {
        server.command = line.split(':')[1]?.trim();
      } else if (line.includes('URL:')) {
        server.url = line.split(':')[1]?.trim();
      }
    }
    
    return server;
  } catch (error) {
    return { raw_output: output, parse_error: error.message };
  }
}

export default router;
