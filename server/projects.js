/**
 * PROJECT DISCOVERY AND MANAGEMENT SYSTEM
 * ========================================
 * 
 * This module manages project discovery for Claude CLI sessions.
 * 
 * ## Architecture Overview
 * 
 * 1. **Claude Projects** (stored in ~/.claude/projects/)
 *    - Each project is a directory named with the project path encoded (/ replaced with -)
 *    - Contains .jsonl files with conversation history including 'cwd' field
 *    - Project metadata stored in ~/.claude/project-config.json
 * 
 * ## Project Discovery Strategy
 * 
 * 1. **Claude Projects Discovery**:
 *    - Scan ~/.claude/projects/ directory for Claude project folders
 *    - Extract actual project path from .jsonl files (cwd field)
 *    - Fall back to decoded directory name if no sessions exist
 * 
 * 2. **Manual Project Addition**:
 *    - Users can manually add project paths via UI
 *    - Stored in ~/.claude/project-config.json with 'manuallyAdded' flag
 * 
 * ## Error Handling
 * 
 * - Missing ~/.claude directory is handled gracefully with automatic creation
 * - ENOENT errors are caught and handled without crashing
 * - Empty arrays returned when no projects/sessions exist
 * 
 * ## Caching Strategy
 * 
 * - Project directory extraction is cached to minimize file I/O
 * - Cache is cleared when project configuration changes
 * - Session data is fetched on-demand, not cached
 */

import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import crypto from 'crypto';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import os from 'os';
import sessionManager from './sessionManager.js';
import { applyCustomSessionNames } from './database/db.js';
import {
  deleteCodexThreadHard,
  getCodexThreadTokenUsage,
  listCodexThreads,
  readCodexThread,
} from './openai-codex.js';
import { extractCodexTurnCompletionStatesFromRollout } from './services/codex-rollout.js';
import { CODEX_MISSING_FINAL_SUMMARY_MESSAGE } from '../shared/codexCompletion.js';

const PROJECTS_CACHE_TTL_MS = 30000;
const CODEX_THREADS_INDEX_TTL_MS = 1000;
const CODEX_SESSION_MESSAGES_TTL_MS = 1000;
const projectsCache = new Map();
const inFlightProjectsRequests = new Map();
let codexThreadsIndexCache = {
  expiresAt: 0,
  value: null,
  promise: null,
};
const codexSessionMessagesCache = new Map();

function invalidateProjectsCache() {
  projectsCache.clear();
  inFlightProjectsRequests.clear();
}

function getCodexSessionMessagesCacheKey(sessionId, limit, offset) {
  const normalizedLimit = limit === null ? 'all' : Number(limit);
  const normalizedOffset = Number(offset) || 0;
  return `${sessionId}:${normalizedLimit}:${normalizedOffset}`;
}

function getCachedCodexSessionMessages(cacheKey) {
  const entry = codexSessionMessagesCache.get(cacheKey);
  if (!entry) {
    return null;
  }

  if (entry.expiresAt > Date.now()) {
    return entry.value;
  }

  if (!entry.promise) {
    codexSessionMessagesCache.delete(cacheKey);
  }
  return null;
}

function setCachedCodexSessionMessages(cacheKey, value, promise = null) {
  codexSessionMessagesCache.set(cacheKey, {
    value,
    promise,
    expiresAt: Date.now() + CODEX_SESSION_MESSAGES_TTL_MS,
  });
}

function isRetryableCodexMetadataError(error) {
  const message = typeof error?.message === 'string' ? error.message : '';
  return (
    error?.code === -32001
    || /server overloaded|retry later|temporar(?:y|ily) unavailable|busy/i.test(message)
    || /missing rollout path|state db missing rollout path/i.test(message)
  );
}

function getProjectsCacheKey(options = {}) {
  return options.lightweight ? 'light' : 'full';
}

function getFallbackDisplayName(projectName, actualProjectDir = null) {
  const projectPath = actualProjectDir || projectName.replace(/-/g, '/');
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/, '');

  if (!normalized) {
    return projectName;
  }

  const segments = normalized.split('/').filter(Boolean);
  return segments[segments.length - 1] || projectName;
}

function toTimestampMs(value) {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return 0;
}

function toIsoTimestamp(value) {
  const timestampMs = toTimestampMs(value);
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : null;
}

function getLatestTimestamp(timestamps) {
  return timestamps.reduce((latest, value) => Math.max(latest, toTimestampMs(value)), 0);
}

// Import TaskMaster detection functions
async function detectTaskMasterFolder(projectPath) {
  try {
    const taskMasterPath = path.join(projectPath, '.taskmaster');

    // Check if .taskmaster directory exists
    try {
      const stats = await fs.stat(taskMasterPath);
      if (!stats.isDirectory()) {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster exists but is not a directory'
        };
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return {
          hasTaskmaster: false,
          reason: '.taskmaster directory not found'
        };
      }
      throw error;
    }

    // Check for key TaskMaster files
    const keyFiles = [
      'tasks/tasks.json',
      'config.json'
    ];

    const fileStatus = {};
    let hasEssentialFiles = true;

    for (const file of keyFiles) {
      const filePath = path.join(taskMasterPath, file);
      try {
        await fs.access(filePath);
        fileStatus[file] = true;
      } catch (error) {
        fileStatus[file] = false;
        if (file === 'tasks/tasks.json') {
          hasEssentialFiles = false;
        }
      }
    }

    // Parse tasks.json if it exists for metadata
    let taskMetadata = null;
    if (fileStatus['tasks/tasks.json']) {
      try {
        const tasksPath = path.join(taskMasterPath, 'tasks/tasks.json');
        const tasksContent = await fs.readFile(tasksPath, 'utf8');
        const tasksData = JSON.parse(tasksContent);

        // Handle both tagged and legacy formats
        let tasks = [];
        if (tasksData.tasks) {
          // Legacy format
          tasks = tasksData.tasks;
        } else {
          // Tagged format - get tasks from all tags
          Object.values(tasksData).forEach(tagData => {
            if (tagData.tasks) {
              tasks = tasks.concat(tagData.tasks);
            }
          });
        }

        // Calculate task statistics
        const stats = tasks.reduce((acc, task) => {
          acc.total++;
          acc[task.status] = (acc[task.status] || 0) + 1;

          // Count subtasks
          if (task.subtasks) {
            task.subtasks.forEach(subtask => {
              acc.subtotalTasks++;
              acc.subtasks = acc.subtasks || {};
              acc.subtasks[subtask.status] = (acc.subtasks[subtask.status] || 0) + 1;
            });
          }

          return acc;
        }, {
          total: 0,
          subtotalTasks: 0,
          pending: 0,
          'in-progress': 0,
          done: 0,
          review: 0,
          deferred: 0,
          cancelled: 0,
          subtasks: {}
        });

        taskMetadata = {
          taskCount: stats.total,
          subtaskCount: stats.subtotalTasks,
          completed: stats.done || 0,
          pending: stats.pending || 0,
          inProgress: stats['in-progress'] || 0,
          review: stats.review || 0,
          completionPercentage: stats.total > 0 ? Math.round((stats.done / stats.total) * 100) : 0,
          lastModified: (await fs.stat(tasksPath)).mtime.toISOString()
        };
      } catch (parseError) {
        console.warn('Failed to parse tasks.json:', parseError.message);
        taskMetadata = { error: 'Failed to parse tasks.json' };
      }
    }

    return {
      hasTaskmaster: true,
      hasEssentialFiles,
      files: fileStatus,
      metadata: taskMetadata,
      path: taskMasterPath
    };

  } catch (error) {
    console.error('Error detecting TaskMaster folder:', error);
    return {
      hasTaskmaster: false,
      reason: `Error checking directory: ${error.message}`
    };
  }
}

// Cache for extracted project directories
const projectDirectoryCache = new Map();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  invalidateProjectsCache();
}

// Load project configuration file
async function loadProjectConfig() {
  const configPath = path.join(os.homedir(), '.claude', 'project-config.json');
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(config) {
  const claudeDir = path.join(os.homedir(), '.claude');
  const configPath = path.join(claudeDir, 'project-config.json');

  // Ensure the .claude directory exists
  try {
    await fs.mkdir(claudeDir, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') {
      throw error;
    }
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  invalidateProjectsCache();
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir || projectName.replace(/-/g, '/');

  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);

    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }

  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    // Return only the last folder name
    return parts[parts.length - 1] || projectPath;
  }

  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }

  // Check project config for originalPath (manually added projects via UI or platform)
  // This handles projects with dashes in their directory names correctly
  const config = await loadProjectConfig();
  if (config[projectName]?.originalPath) {
    const originalPath = config[projectName].originalPath;
    projectDirectoryCache.set(projectName, originalPath);
    return originalPath;
  }

  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;

  try {
    // Check if the project directory exists
    await fs.access(projectDir);

    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);

              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);

                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }

      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name
        extractedPath = projectName.replace(/-/g, '/');
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());

        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }

        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          extractedPath = latestCwd || projectName.replace(/-/g, '/');
        }
      }
    }

    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;

  } catch (error) {
    if (error.code === 'ENOENT') {
      extractedPath = projectName.replace(/-/g, '/');
    } else {
      console.error(`Error extracting project directory for ${projectName}:`, error);
      extractedPath = projectName.replace(/-/g, '/');
    }

    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);

    return extractedPath;
  }
}

async function getClaudeProjectLastActivity(projectName) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter((file) => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return null;
    }

    const timestamps = await Promise.all(
      jsonlFiles.map(async (file) => {
        try {
          const stats = await fs.stat(path.join(projectDir, file));
          return stats.mtimeMs;
        } catch {
          return 0;
        }
      })
    );

    return toIsoTimestamp(getLatestTimestamp(timestamps));
  } catch {
    return null;
  }
}

async function getProjectLastActivity(projectName, projectPath, options = {}) {
  const { codexIndexRef = null, geminiIndexRef = null } = options;
  const timestamps = await Promise.all([
    getClaudeProjectLastActivity(projectName),
    getCodexProjectLastActivity(projectPath, codexIndexRef),
    getGeminiProjectLastActivity(projectPath, geminiIndexRef),
  ]);

  return toIsoTimestamp(getLatestTimestamp(timestamps));
}

async function buildProjects(progressCallback = null, options = {}) {
  const { lightweight = false } = options;
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const projects = [];
  const existingProjects = new Set();
  const codexThreadsIndexRef = { threadsIndex: null };
  const geminiCliActivityIndexRef = { activityByProject: null };
  let totalProjects = 0;
  let processedProjects = 0;
  let directories = [];

  try {
    // Check if the .claude/projects directory exists
    await fs.access(claudeDir);

    // First, get existing Claude projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    directories = entries.filter(e => e.isDirectory());

    // Build set of existing project names for later
    directories.forEach(e => existingProjects.add(e.name));

    // Count manual projects not already in directories
    const manualProjectsCount = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded && !existingProjects.has(name))
      .length;

    totalProjects = directories.length + manualProjectsCount;

    for (const entry of directories) {
      processedProjects++;

      // Emit progress
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: entry.name
        });
      }

      // Extract actual project directory from JSONL sessions
      const actualProjectDir = await extractProjectDirectory(entry.name);

      // Get display name from config or generate one
      const customName = config[entry.name]?.displayName;
      const autoDisplayName = lightweight
        ? getFallbackDisplayName(entry.name, actualProjectDir)
        : await generateDisplayName(entry.name, actualProjectDir);
      const fullPath = actualProjectDir;
      const lastActivity = await getProjectLastActivity(entry.name, actualProjectDir, {
        codexIndexRef: codexThreadsIndexRef,
        geminiIndexRef: geminiCliActivityIndexRef,
      });

      const project = {
        name: entry.name,
        path: actualProjectDir,
        displayName: customName || autoDisplayName,
        fullPath: fullPath,
        isCustomName: !!customName,
        lastActivity,
        ...(lightweight ? {} : {
          sessions: [],
          codexSessions: [],
          geminiSessions: [],
          sessionMeta: {
            hasMore: false,
            total: 0
          }
        })
      };

      if (!lightweight) {
        // Try to get sessions for this project (just first 5 for performance)
        try {
          const sessionResult = await getSessions(entry.name, 5, 0);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: sessionResult.hasMore,
            total: sessionResult.total
          };
        } catch (e) {
          console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
          project.sessionMeta = {
            hasMore: false,
            total: 0
          };
        }
        applyCustomSessionNames(project.sessions, 'claude');

        // Also fetch Codex sessions for this project
        try {
          project.codexSessions = await getCodexSessions(actualProjectDir, {
            indexRef: codexThreadsIndexRef,
          });
        } catch (e) {
          console.warn(`Could not load Codex sessions for project ${entry.name}:`, e.message);
          project.codexSessions = [];
        }
        applyCustomSessionNames(project.codexSessions, 'codex');

        // Also fetch Gemini sessions for this project (UI + CLI)
        try {
          const uiSessions = sessionManager.getProjectSessions(actualProjectDir) || [];
          const cliSessions = await getGeminiCliSessions(actualProjectDir);
          const uiIds = new Set(uiSessions.map(s => s.id));
          const mergedGemini = [...uiSessions, ...cliSessions.filter(s => !uiIds.has(s.id))];
          project.geminiSessions = mergedGemini;
        } catch (e) {
          console.warn(`Could not load Gemini sessions for project ${entry.name}:`, e.message);
          project.geminiSessions = [];
        }
        applyCustomSessionNames(project.geminiSessions, 'gemini');

        // Add TaskMaster detection
        try {
          const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);
          project.taskmaster = {
            hasTaskmaster: taskMasterResult.hasTaskmaster,
            hasEssentialFiles: taskMasterResult.hasEssentialFiles,
            metadata: taskMasterResult.metadata,
            status: taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles ? 'configured' : 'not-configured'
          };
        } catch (e) {
          console.warn(`Could not detect TaskMaster for project ${entry.name}:`, e.message);
          project.taskmaster = {
            hasTaskmaster: false,
            hasEssentialFiles: false,
            metadata: null,
            status: 'error'
          };
        }
      }

      projects.push(project);
    }
  } catch (error) {
    // If the directory doesn't exist (ENOENT), that's okay - just continue with empty projects
    if (error.code !== 'ENOENT') {
      console.error('Error reading projects directory:', error);
    }
    // Calculate total for manual projects only (no directories exist)
    totalProjects = Object.entries(config)
      .filter(([name, cfg]) => cfg.manuallyAdded)
      .length;
  }

  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      processedProjects++;

      // Emit progress for manual projects
      if (progressCallback) {
        progressCallback({
          phase: 'loading',
          current: processedProjects,
          total: totalProjects,
          currentProject: projectName
        });
      }

      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;

      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(projectName);
        } catch (error) {
          // Fall back to decoded project name
          actualProjectDir = projectName.replace(/-/g, '/');
        }
      }

      const project = {
        name: projectName,
        path: actualProjectDir,
        displayName: projectConfig.displayName || (
          lightweight
            ? getFallbackDisplayName(projectName, actualProjectDir)
            : await generateDisplayName(projectName, actualProjectDir)
        ),
        fullPath: actualProjectDir,
        isCustomName: !!projectConfig.displayName,
        isManuallyAdded: true,
        lastActivity: await getProjectLastActivity(projectName, actualProjectDir, {
          codexIndexRef: codexThreadsIndexRef,
          geminiIndexRef: geminiCliActivityIndexRef,
        }),
        ...(lightweight ? {} : {
          sessions: [],
          geminiSessions: [],
          sessionMeta: {
            hasMore: false,
            total: 0
          },
          codexSessions: []
        })
      };

      if (!lightweight) {
        try {
          const sessionResult = await getSessions(projectName, 5, 0);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: sessionResult.hasMore,
            total: sessionResult.total
          };
        } catch (e) {
          console.warn(`Could not load sessions for manual project ${projectName}:`, e.message);
          project.sessionMeta = {
            hasMore: false,
            total: 0
          };
        }
        applyCustomSessionNames(project.sessions, 'claude');

        // Try to fetch Codex sessions for manual projects too
        try {
          project.codexSessions = await getCodexSessions(actualProjectDir, {
            indexRef: codexThreadsIndexRef,
          });
        } catch (e) {
          console.warn(`Could not load Codex sessions for manual project ${projectName}:`, e.message);
        }
        applyCustomSessionNames(project.codexSessions, 'codex');

        // Try to fetch Gemini sessions for manual projects too (UI + CLI)
        try {
          const uiSessions = sessionManager.getProjectSessions(actualProjectDir) || [];
          const cliSessions = await getGeminiCliSessions(actualProjectDir);
          const uiIds = new Set(uiSessions.map(s => s.id));
          project.geminiSessions = [...uiSessions, ...cliSessions.filter(s => !uiIds.has(s.id))];
        } catch (e) {
          console.warn(`Could not load Gemini sessions for manual project ${projectName}:`, e.message);
        }
        applyCustomSessionNames(project.geminiSessions, 'gemini');

        // Add TaskMaster detection for manual projects
        try {
          const taskMasterResult = await detectTaskMasterFolder(actualProjectDir);

          // Determine TaskMaster status
          let taskMasterStatus = 'not-configured';
          if (taskMasterResult.hasTaskmaster && taskMasterResult.hasEssentialFiles) {
            taskMasterStatus = 'taskmaster-only'; // We don't check MCP for manual projects in bulk
          }

          project.taskmaster = {
            status: taskMasterStatus,
            hasTaskmaster: taskMasterResult.hasTaskmaster,
            hasEssentialFiles: taskMasterResult.hasEssentialFiles,
            metadata: taskMasterResult.metadata
          };
        } catch (error) {
          console.warn(`TaskMaster detection failed for manual project ${projectName}:`, error.message);
          project.taskmaster = {
            status: 'error',
            hasTaskmaster: false,
            hasEssentialFiles: false,
            error: error.message
          };
        }
      }

      projects.push(project);
    }
  }

  // Emit completion after all projects (including manual) are processed
  if (progressCallback) {
    progressCallback({
      phase: 'complete',
      current: totalProjects,
      total: totalProjects
    });
  }

  return projects;
}

async function getProjects(progressCallback = null, options = {}) {
  const cacheKey = getProjectsCacheKey(options);
  const cached = projectsCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    if (progressCallback) {
      progressCallback({
        phase: 'complete',
        current: cached.value.length,
        total: cached.value.length
      });
    }
    return cached.value;
  }

  if (inFlightProjectsRequests.has(cacheKey)) {
    return inFlightProjectsRequests.get(cacheKey);
  }

  const request = buildProjects(progressCallback, options)
    .then((projects) => {
      projectsCache.set(cacheKey, {
        value: projects,
        expiresAt: Date.now() + PROJECTS_CACHE_TTL_MS,
      });
      return projects;
    })
    .finally(() => {
      inFlightProjectsRequests.delete(cacheKey);
    });

  inFlightProjectsRequests.set(cacheKey, request);
  return request;
}

async function getSessions(projectName, limit = 5, offset = 0) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain session start data at this point. This needs to be revisited
    // periodically to make sure only accurate data is there and no new functionality is added there
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }

    // Sort files by modification time (newest first)
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    filesWithStats.sort((a, b) => b.mtime - a.mtime);

    const allSessions = new Map();
    const allEntries = [];
    const uuidToSessionMap = new Map();

    // Collect all sessions and entries from all files
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const result = await parseJsonlSessions(jsonlFile);

      result.sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });

      allEntries.push(...result.entries);

      // Early exit optimization for large projects
      if (allSessions.size >= (limit + offset) * 2 && allEntries.length >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }

    // Build UUID-to-session mapping for timeline detection
    allEntries.forEach(entry => {
      if (entry.uuid && entry.sessionId) {
        uuidToSessionMap.set(entry.uuid, entry.sessionId);
      }
    });

    // Group sessions by first user message ID
    const sessionGroups = new Map(); // firstUserMsgId -> { latestSession, allSessions[] }
    const sessionToFirstUserMsgId = new Map(); // sessionId -> firstUserMsgId

    // Find the first user message for each session
    allEntries.forEach(entry => {
      if (entry.sessionId && entry.type === 'user' && entry.parentUuid === null && entry.uuid) {
        // This is a first user message in a session (parentUuid is null)
        const firstUserMsgId = entry.uuid;

        if (!sessionToFirstUserMsgId.has(entry.sessionId)) {
          sessionToFirstUserMsgId.set(entry.sessionId, firstUserMsgId);

          const session = allSessions.get(entry.sessionId);
          if (session) {
            if (!sessionGroups.has(firstUserMsgId)) {
              sessionGroups.set(firstUserMsgId, {
                latestSession: session,
                allSessions: [session]
              });
            } else {
              const group = sessionGroups.get(firstUserMsgId);
              group.allSessions.push(session);

              // Update latest session if this one is more recent
              if (new Date(session.lastActivity) > new Date(group.latestSession.lastActivity)) {
                group.latestSession = session;
              }
            }
          }
        }
      }
    });

    // Collect all sessions that don't belong to any group (standalone sessions)
    const groupedSessionIds = new Set();
    sessionGroups.forEach(group => {
      group.allSessions.forEach(session => groupedSessionIds.add(session.id));
    });

    const standaloneSessionsArray = Array.from(allSessions.values())
      .filter(session => !groupedSessionIds.has(session.id));

    // Combine grouped sessions (only show latest from each group) + standalone sessions
    const latestFromGroups = Array.from(sessionGroups.values()).map(group => {
      const session = { ...group.latestSession };
      // Add metadata about grouping
      if (group.allSessions.length > 1) {
        session.isGrouped = true;
        session.groupSize = group.allSessions.length;
        session.groupSessions = group.allSessions.map(s => s.id);
      }
      return session;
    });
    const visibleSessions = [...latestFromGroups, ...standaloneSessionsArray]
      .filter(session => !session.summary.startsWith('{ "'))
      .sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));

    const total = visibleSessions.length;
    const paginatedSessions = visibleSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;

    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Error reading sessions for project ${projectName}:`, error);
    }
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  const entries = [];
  const pendingSummaries = new Map(); // leafUuid -> summary for entries without sessionId

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          entries.push(entry);

          // Handle summary entries that don't have sessionId yet
          if (entry.type === 'summary' && entry.summary && !entry.sessionId && entry.leafUuid) {
            pendingSummaries.set(entry.leafUuid, entry.summary);
          }

          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || '',
                lastUserMessage: null,
                lastAssistantMessage: null
              });
            }

            const session = sessions.get(entry.sessionId);

            // Apply pending summary if this entry has a parentUuid that matches a pending summary
            if (session.summary === 'New Session' && entry.parentUuid && pendingSummaries.has(entry.parentUuid)) {
              session.summary = pendingSummaries.get(entry.parentUuid);
            }

            // Update summary from summary entries with sessionId
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            }

            // Track last user and assistant messages (skip system messages)
            if (entry.message?.role === 'user' && entry.message?.content) {
              const content = entry.message.content;

              // Extract text from array format if needed
              let textContent = content;
              if (Array.isArray(content) && content.length > 0 && content[0].type === 'text') {
                textContent = content[0].text;
              }

              const isSystemMessage = typeof textContent === 'string' && (
                textContent.startsWith('<command-name>') ||
                textContent.startsWith('<command-message>') ||
                textContent.startsWith('<command-args>') ||
                textContent.startsWith('<local-command-stdout>') ||
                textContent.startsWith('<system-reminder>') ||
                textContent.startsWith('Caveat:') ||
                textContent.startsWith('This session is being continued from a previous') ||
                textContent.startsWith('Invalid API key') ||
                textContent.includes('{"subtasks":') || // Filter Task Master prompts
                textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') || // Filter Task Master system prompts
                textContent === 'Warmup' // Explicitly filter out "Warmup"
              );

              if (typeof textContent === 'string' && textContent.length > 0 && !isSystemMessage) {
                session.lastUserMessage = textContent;
              }
            } else if (entry.message?.role === 'assistant' && entry.message?.content) {
              // Skip API error messages using the isApiErrorMessage flag
              if (entry.isApiErrorMessage === true) {
                // Skip this message entirely
              } else {
                // Track last assistant text message
                let assistantText = null;

                if (Array.isArray(entry.message.content)) {
                  for (const part of entry.message.content) {
                    if (part.type === 'text' && part.text) {
                      assistantText = part.text;
                    }
                  }
                } else if (typeof entry.message.content === 'string') {
                  assistantText = entry.message.content;
                }

                // Additional filter for assistant messages with system content
                const isSystemAssistantMessage = typeof assistantText === 'string' && (
                  assistantText.startsWith('Invalid API key') ||
                  assistantText.includes('{"subtasks":') ||
                  assistantText.includes('CRITICAL: You MUST respond with ONLY a JSON')
                );

                if (assistantText && !isSystemAssistantMessage) {
                  session.lastAssistantMessage = assistantText;
                }
              }
            }

            session.messageCount++;

            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          // Skip malformed lines silently
        }
      }
    }

    // After processing all entries, set final summary based on last message if no summary exists
    for (const session of sessions.values()) {
      if (session.summary === 'New Session') {
        // Prefer last user message, fall back to last assistant message
        const lastMessage = session.lastUserMessage || session.lastAssistantMessage;
        if (lastMessage) {
          session.summary = lastMessage.length > 50 ? lastMessage.substring(0, 50) + '...' : lastMessage;
        }
      }
    }

    // Filter out sessions that contain JSON responses (Task Master errors)
    const allSessions = Array.from(sessions.values());
    const filteredSessions = allSessions.filter(session => {
      const shouldFilter = session.summary.startsWith('{ "');
      if (shouldFilter) {
      }
      // Log a sample of summaries to debug
      if (Math.random() < 0.01) { // Log 1% of sessions
      }
      return !shouldFilter;
    });


    return {
      sessions: filteredSessions,
      entries: entries
    };

  } catch (error) {
    console.error('Error reading JSONL file:', error);
    return { sessions: [], entries: [] };
  }
}

// Parse an agent JSONL file and extract tool uses
async function parseAgentTools(filePath) {
  const tools = [];

  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);
          // Look for assistant messages with tool_use
          if (entry.message?.role === 'assistant' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_use') {
                tools.push({
                  toolId: part.id,
                  toolName: part.name,
                  toolInput: part.input,
                  timestamp: entry.timestamp
                });
              }
            }
          }
          // Look for tool results
          if (entry.message?.role === 'user' && Array.isArray(entry.message?.content)) {
            for (const part of entry.message.content) {
              if (part.type === 'tool_result') {
                // Find the matching tool and add result
                const tool = tools.find(t => t.toolId === part.tool_use_id);
                if (tool) {
                  tool.toolResult = {
                    content: typeof part.content === 'string' ? part.content :
                      Array.isArray(part.content) ? part.content.map(c => c.text || '').join('\n') :
                        JSON.stringify(part.content),
                    isError: Boolean(part.is_error)
                  };
                }
              }
            }
          }
        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }
  } catch (error) {
    console.warn(`Error parsing agent file ${filePath}:`, error.message);
  }

  return tools;
}

// Get messages for a specific session with pagination support
async function getSessionMessages(projectName, sessionId, limit = null, offset = 0) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    // agent-*.jsonl files contain subagent tool history - we'll process them separately
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl') && !file.startsWith('agent-'));
    const agentFiles = files.filter(file => file.endsWith('.jsonl') && file.startsWith('agent-'));

    if (jsonlFiles.length === 0) {
      return { messages: [], total: 0, hasMore: false };
    }

    const messages = [];
    // Map of agentId -> tools for subagent tool grouping
    const agentToolsCache = new Map();

    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });

      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }

    // Collect agentIds from Task tool results
    const agentIds = new Set();
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        agentIds.add(message.toolUseResult.agentId);
      }
    }

    // Load agent tools for each agentId found
    for (const agentId of agentIds) {
      const agentFileName = `agent-${agentId}.jsonl`;
      if (agentFiles.includes(agentFileName)) {
        const agentFilePath = path.join(projectDir, agentFileName);
        const tools = await parseAgentTools(agentFilePath);
        agentToolsCache.set(agentId, tools);
      }
    }

    // Attach agent tools to their parent Task messages
    for (const message of messages) {
      if (message.toolUseResult?.agentId) {
        const agentId = message.toolUseResult.agentId;
        const agentTools = agentToolsCache.get(agentId);
        if (agentTools && agentTools.length > 0) {
          message.subagentTools = agentTools;
        }
      }
    }
    // Sort messages by timestamp
    const sortedMessages = messages.sort((a, b) =>
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );

    const total = sortedMessages.length;

    // If no limit is specified, return all messages (backward compatibility)
    if (limit === null) {
      return sortedMessages;
    }

    // Apply pagination - for recent messages, we need to slice from the end
    // offset 0 should give us the most recent messages
    const startIndex = Math.max(0, total - offset - limit);
    const endIndex = total - offset;
    const paginatedMessages = sortedMessages.slice(startIndex, endIndex);
    const hasMore = startIndex > 0;

    return {
      messages: paginatedMessages,
      total,
      hasMore,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return limit === null ? [] : { messages: [], total: 0, hasMore: false };
  }
}

// Rename a project's display name
async function renameProject(projectName, newDisplayName) {
  const config = await loadProjectConfig();

  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    if (config[projectName]) {
      delete config[projectName].displayName;
    }
  } else {
    // Set custom display name, preserving other properties (manuallyAdded, originalPath)
    config[projectName] = {
      ...config[projectName],
      displayName: newDisplayName.trim()
    };
  }

  await saveProjectConfig(config);
  return true;
}

// Delete a session from a project
async function deleteSession(projectName, sessionId) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));

    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }

    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());

      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });

      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });

        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }

    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(projectName) {
  try {
    const sessionsResult = await getSessions(projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Delete a project (force=true to delete even with sessions)
async function deleteProject(projectName, force = false) {
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  try {
    const isEmpty = await isProjectEmpty(projectName);
    if (!isEmpty && !force) {
      throw new Error('Cannot delete project with existing sessions');
    }

    const config = await loadProjectConfig();
    let projectPath = config[projectName]?.path || config[projectName]?.originalPath;

    // Fallback to extractProjectDirectory if projectPath is not in config
    if (!projectPath) {
      projectPath = await extractProjectDirectory(projectName);
    }

    // Remove the project directory (includes all Claude sessions)
    await fs.rm(projectDir, { recursive: true, force: true });

    // Delete all Codex sessions associated with this project
    if (projectPath) {
      try {
        const codexSessions = await getCodexSessions(projectPath, { limit: 0 });
        for (const session of codexSessions) {
          try {
            await deleteCodexSession(session.id);
          } catch (err) {
            console.warn(`Failed to delete Codex session ${session.id}:`, err.message);
          }
        }
      } catch (err) {
        console.warn('Failed to delete Codex sessions:', err.message);
      }

    }

    // Remove from project config
    delete config[projectName];
    await saveProjectConfig(config);

    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);

  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  // Generate project name (encode path for use as directory name)
  const projectName = absolutePath.replace(/[\\/:\s~_]/g, '-');

  // Check if project already exists in config
  const config = await loadProjectConfig();
  const projectDir = path.join(os.homedir(), '.claude', 'projects', projectName);

  if (config[projectName]) {
    throw new Error(`Project already configured for path: ${absolutePath}`);
  }

  // Allow adding projects even if the directory exists - this enables tracking
  // existing Claude Code projects in the UI

  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };

  if (displayName) {
    config[projectName].displayName = displayName;
  }

  await saveProjectConfig(config);


  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    lastActivity: null,
    isManuallyAdded: true,
    sessions: []
  };
}



function normalizeComparablePath(inputPath) {
  if (!inputPath || typeof inputPath !== 'string') {
    return '';
  }

  const withoutLongPathPrefix = inputPath.startsWith('\\\\?\\')
    ? inputPath.slice(4)
    : inputPath;
  const normalized = path.normalize(withoutLongPathPrefix.trim());

  if (!normalized) {
    return '';
  }

  const resolved = path.resolve(normalized);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

async function findCodexJsonlFiles(dir) {
  const files = [];

  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...await findCodexJsonlFiles(fullPath));
      } else if (entry.name.endsWith('.jsonl')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    // Skip directories we can't read
  }

  return files;
}

async function buildCodexThreadsIndex() {
  if (codexThreadsIndexCache.value && codexThreadsIndexCache.expiresAt > Date.now()) {
    return codexThreadsIndexCache.value;
  }

  if (codexThreadsIndexCache.promise) {
    return codexThreadsIndexCache.promise;
  }

  const loadPromise = (async () => {
  const sessionsByProject = new Map();
  const lastActivityByProject = new Map();

  try {
    const { data: threads } = await listCodexThreads({ pageSize: 200 });

    for (const thread of threads || []) {
      const normalizedProjectPath = normalizeComparablePath(thread?.cwd);
      if (!normalizedProjectPath) {
        continue;
      }

      const preview = typeof thread?.preview === 'string' ? thread.preview.trim() : '';
      const summary = preview
        ? (preview.length > 80 ? `${preview.slice(0, 80)}...` : preview)
        : 'Codex Session';
      const lastActivityMs = (thread.updatedAt || thread.createdAt || Date.now() / 1000) * 1000;
      const session = {
        id: thread.id,
        summary,
        messageCount: 0,
        lastActivity: new Date(lastActivityMs),
        cwd: thread.cwd,
        model: thread.modelProvider,
        filePath: thread.path,
        provider: 'codex',
        source: thread.source,
      };

      if (!sessionsByProject.has(normalizedProjectPath)) {
        sessionsByProject.set(normalizedProjectPath, []);
      }

      sessionsByProject.get(normalizedProjectPath).push(session);

      const existingLastActivity = lastActivityByProject.get(normalizedProjectPath) || 0;
      if (lastActivityMs > existingLastActivity) {
        lastActivityByProject.set(normalizedProjectPath, lastActivityMs);
      }
    }
  } catch (error) {
    console.warn('Could not build Codex interactive sessions index:', error.message);
  }

  for (const sessions of sessionsByProject.values()) {
    sessions.sort((a, b) => new Date(b.lastActivity) - new Date(a.lastActivity));
  }

    const result = { sessionsByProject, lastActivityByProject };
    codexThreadsIndexCache = {
      value: result,
      promise: null,
      expiresAt: Date.now() + CODEX_THREADS_INDEX_TTL_MS,
    };
    return result;
  })().finally(() => {
    if (codexThreadsIndexCache.promise === loadPromise) {
      codexThreadsIndexCache.promise = null;
    }
  });

  codexThreadsIndexCache.promise = loadPromise;
  return loadPromise;
}

// Fetch Codex sessions for a given project path
async function getCodexSessions(projectPath, options = {}) {
  const { limit = 5, indexRef = null } = options;
  try {
    const normalizedProjectPath = normalizeComparablePath(projectPath);
    if (!normalizedProjectPath) {
      return [];
    }

    if (indexRef && !indexRef.threadsIndex) {
      indexRef.threadsIndex = await buildCodexThreadsIndex();
    }

    const threadsIndex = indexRef?.threadsIndex || await buildCodexThreadsIndex();
    const sessions = threadsIndex.sessionsByProject.get(normalizedProjectPath) || [];

    // Return limited sessions for performance (0 = unlimited for deletion)
    return limit > 0 ? sessions.slice(0, limit) : [...sessions];

  } catch (error) {
    console.error('Error fetching Codex sessions:', error);
    return [];
  }
}

async function getCodexProjectLastActivity(projectPath, indexRef = null) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return null;
  }

  try {
    if (indexRef && !indexRef.threadsIndex) {
      indexRef.threadsIndex = await buildCodexThreadsIndex();
    }

    const threadsIndex = indexRef?.threadsIndex || await buildCodexThreadsIndex();
    return toIsoTimestamp(threadsIndex.lastActivityByProject.get(normalizedProjectPath) || 0);
  } catch (error) {
    console.warn('Could not determine Codex project activity:', error.message);
    return null;
  }
}

function isVisibleCodexUserMessage(payload) {
  if (!payload || payload.type !== 'user_message') {
    return false;
  }

  // Codex logs internal context (environment, instructions) as non-plain user_message kinds.
  if (payload.kind && payload.kind !== 'plain') {
    return false;
  }

  if (typeof payload.message !== 'string' || payload.message.trim().length === 0) {
    return false;
  }
  
  return true;
}

// Parse a Codex session JSONL file to extract metadata
async function parseCodexSessionFile(filePath) {
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });

    let sessionMeta = null;
    let lastTimestamp = null;
    let lastUserMessage = null;
    let messageCount = 0;

    for await (const line of rl) {
      if (line.trim()) {
        try {
          const entry = JSON.parse(line);

          // Track timestamp
          if (entry.timestamp) {
            lastTimestamp = entry.timestamp;
          }

          // Extract session metadata
          if (entry.type === 'session_meta' && entry.payload) {
            sessionMeta = {
              id: entry.payload.id,
              cwd: entry.payload.cwd,
              model: entry.payload.model || entry.payload.model_provider,
              timestamp: entry.timestamp,
              git: entry.payload.git
            };
          }

          // Count visible user messages and extract summary from the latest plain user input.
          if (entry.type === 'event_msg' && isVisibleCodexUserMessage(entry.payload)) {
            messageCount++;
            if (entry.payload.message) {
              lastUserMessage = entry.payload.message;
            }
          }

          if (entry.type === 'response_item' && entry.payload?.type === 'message' && entry.payload.role === 'assistant') {
            messageCount++;
          }

        } catch (parseError) {
          // Skip malformed lines
        }
      }
    }

    if (sessionMeta) {
      return {
        ...sessionMeta,
        timestamp: lastTimestamp || sessionMeta.timestamp,
        summary: lastUserMessage ?
          (lastUserMessage.length > 50 ? lastUserMessage.substring(0, 50) + '...' : lastUserMessage) :
          'Codex Session',
        messageCount
      };
    }

    return null;

  } catch (error) {
    console.error('Error parsing Codex session file:', error);
    return null;
  }
}

function createCodexTurnTimeline() {
  return {
    startTimestamp: null,
    userTimestamps: [],
    assistantTimestamps: [],
    reasoningTimestamps: [],
  };
}

function getOrCreateCodexTurnTimeline(turnTimelines, turnId) {
  if (!turnId) {
    return null;
  }

  if (!turnTimelines.has(turnId)) {
    turnTimelines.set(turnId, createCodexTurnTimeline());
  }

  return turnTimelines.get(turnId);
}

async function extractCodexTurnTimelinesFromRollout(rolloutPath) {
  const turnTimelines = new Map();

  if (!rolloutPath) {
    return turnTimelines;
  }

  try {
    const content = await fs.readFile(rolloutPath, 'utf8');
    let currentTurnId = null;

    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const entry = JSON.parse(trimmed);
        const timestamp = entry.timestamp;
        const payload = entry.payload;
        if (!timestamp || !payload) {
          continue;
        }

        if (entry.type === 'event_msg' && payload.type === 'task_started' && payload.turn_id) {
          currentTurnId = payload.turn_id;
          const turnTimeline = getOrCreateCodexTurnTimeline(turnTimelines, currentTurnId);
          if (turnTimeline && !turnTimeline.startTimestamp) {
            turnTimeline.startTimestamp = timestamp;
          }
          continue;
        }

        if (entry.type === 'turn_context' && payload.turn_id) {
          currentTurnId = payload.turn_id;
          const turnTimeline = getOrCreateCodexTurnTimeline(turnTimelines, currentTurnId);
          if (turnTimeline && !turnTimeline.startTimestamp) {
            turnTimeline.startTimestamp = timestamp;
          }
          continue;
        }

        if (!currentTurnId) {
          continue;
        }

        const turnTimeline = getOrCreateCodexTurnTimeline(turnTimelines, currentTurnId);
        if (!turnTimeline) {
          continue;
        }

        if (entry.type === 'event_msg' && isVisibleCodexUserMessage(payload)) {
          turnTimeline.userTimestamps.push(timestamp);
          continue;
        }

        if (entry.type === 'event_msg' && payload.type === 'agent_message') {
          turnTimeline.assistantTimestamps.push(timestamp);
          continue;
        }

        if (entry.type === 'response_item' && payload.type === 'reasoning') {
          turnTimeline.reasoningTimestamps.push(timestamp);
        }
      } catch {
        // Skip malformed rollout entries.
      }
    }

    return turnTimelines;
  } catch {
    return turnTimelines;
  }
}

function createCodexTurnTimestampCursor(turnTimeline) {
  const userTimestamps = [...(turnTimeline?.userTimestamps || [])];
  const assistantTimestamps = [...(turnTimeline?.assistantTimestamps || [])];
  const reasoningTimestamps = [...(turnTimeline?.reasoningTimestamps || [])];
  const startTimestamp = turnTimeline?.startTimestamp || null;
  let lastTimestamp = startTimestamp;

  const consumeTimestamp = (timestamps) => {
    const nextTimestamp = timestamps.shift() || lastTimestamp || startTimestamp;
    if (nextTimestamp) {
      lastTimestamp = nextTimestamp;
    }
    return nextTimestamp;
  };

  return {
    nextUserTimestamp: () => consumeTimestamp(userTimestamps),
    nextAssistantTimestamp: () => consumeTimestamp(assistantTimestamps),
    nextReasoningTimestamp: () => consumeTimestamp(reasoningTimestamps),
    currentTimestamp: () => lastTimestamp || startTimestamp,
  };
}
// Get messages for a specific Codex session
async function getCodexSessionMessages(sessionId, limit = null, offset = 0) {
  const cacheKey = getCodexSessionMessagesCacheKey(sessionId, limit, offset);
  const cached = getCachedCodexSessionMessages(cacheKey);
  if (cached) {
    return cached;
  }

  const cachedEntry = codexSessionMessagesCache.get(cacheKey);
  if (cachedEntry?.promise) {
    return cachedEntry.promise;
  }

  const loadPromise = (async () => {
  try {
    const thread = await readCodexThread(sessionId, true);
    const messages = [];
    const turnTimelines = await extractCodexTurnTimelinesFromRollout(thread.path);
    const completionStates = await extractCodexTurnCompletionStatesFromRollout(thread.path);
    let sequence = 0;
    const baseTimestamp = (thread.createdAt || Math.floor(Date.now() / 1000)) * 1000;
    const makeFallbackTimestamp = () =>
      new Date(baseTimestamp + (sequence++) * 1000).toISOString();

    const pushMessage = (payload, timestampOverride) => {
      messages.push({
        timestamp: timestampOverride || makeFallbackTimestamp(),
        ...payload,
      });
    };

    for (const turn of thread.turns || []) {
      const timestampCursor = createCodexTurnTimestampCursor(turnTimelines.get(turn.id));
      let lastAssistantText = null;

      for (const item of turn.items || []) {
        if (item.type === 'userMessage') {
          const text = (item.content || [])
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
            .trim();

          if (text) {
            pushMessage({
              type: 'user',
              message: {
                role: 'user',
                content: text,
              },
            }, timestampCursor.nextUserTimestamp());
          }
          continue;
        }

        if (item.type === 'agentMessage') {
          if (item.text?.trim()) {
            lastAssistantText = item.text.trim();
            pushMessage({
              type: 'assistant',
              message: {
                role: 'assistant',
                content: item.text,
              },
            }, timestampCursor.nextAssistantTimestamp());
          }
          continue;
        }

        if (item.type === 'plan') {
          if (item.text?.trim()) {
            lastAssistantText = item.text.trim();
            pushMessage({
              type: 'assistant',
              message: {
                role: 'assistant',
                content: item.text,
              },
            }, timestampCursor.nextAssistantTimestamp());
          }
          continue;
        }

        if (item.type === 'reasoning') {
          const reasoningText = [...(item.summary || []), ...(item.content || [])]
            .filter(Boolean)
            .join('\n\n')
            .trim();
          if (reasoningText) {
            pushMessage({
              type: 'thinking',
              message: {
                role: 'assistant',
                content: reasoningText,
              },
            }, timestampCursor.nextReasoningTimestamp());
          }
          continue;
        }

        if (item.type === 'commandExecution') {
          pushMessage({
            type: 'tool_use',
            toolName: 'Bash',
            toolInput: JSON.stringify({ command: item.command, cwd: item.cwd }),
            toolCallId: item.id,
          });

          if (item.aggregatedOutput || item.exitCode !== null) {
            pushMessage({
              type: 'tool_result',
              toolCallId: item.id,
              output: item.aggregatedOutput || `Exit code: ${item.exitCode}`,
            });
          }
          continue;
        }

        if (item.type === 'fileChange') {
          const toolInput = item.changes
            .map((change) => `${change.kind?.type || 'update'}: ${change.path}`)
            .join('\n');
          pushMessage({
            type: 'tool_use',
            toolName: 'Edit',
            toolInput,
            toolCallId: item.id,
          });
          pushMessage({
            type: 'tool_result',
            toolCallId: item.id,
            output: `Status: ${item.status}`,
          });
          continue;
        }

        if (item.type === 'mcpToolCall') {
          pushMessage({
            type: 'tool_use',
            toolName: `${item.server}:${item.tool}`,
            toolInput: JSON.stringify(item.arguments, null, 2),
            toolCallId: item.id,
          });
          pushMessage({
            type: 'tool_result',
            toolCallId: item.id,
            output: item.result
              ? JSON.stringify(item.result, null, 2)
              : item.error?.message || `Status: ${item.status}`,
          });
          continue;
        }

        if (item.type === 'dynamicToolCall') {
          pushMessage({
            type: 'tool_use',
            toolName: item.tool || 'DynamicTool',
            toolInput: JSON.stringify(item.arguments, null, 2),
            toolCallId: item.id,
          });
          pushMessage({
            type: 'tool_result',
            toolCallId: item.id,
            output: item.contentItems?.length
              ? JSON.stringify(item.contentItems, null, 2)
              : `Status: ${item.status}`,
          });
          continue;
        }

        if (item.type === 'collabAgentToolCall') {
          pushMessage({
            type: 'tool_use',
            toolName: item.tool || 'Task',
            toolInput: JSON.stringify({
              prompt: item.prompt,
              model: item.model,
              reasoningEffort: item.reasoningEffort,
              receiverThreadIds: item.receiverThreadIds,
            }, null, 2),
            toolCallId: item.id,
          });
          pushMessage({
            type: 'tool_result',
            toolCallId: item.id,
            output: JSON.stringify(item.agentsStates || {}, null, 2),
          });
          continue;
        }

        if (item.type === 'webSearch') {
          pushMessage({
            type: 'tool_use',
            toolName: 'web_search',
            toolInput: JSON.stringify({ query: item.query, action: item.action }, null, 2),
            toolCallId: item.id,
          });
        }
      }

      const completionState = completionStates.get(turn.id);
      if (completionState?.lastAgentMessage && completionState.lastAgentMessage !== lastAssistantText) {
        pushMessage({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: completionState.lastAgentMessage,
          },
        }, completionState.completionTimestamp || timestampCursor.currentTimestamp());
      } else if (completionState?.missingFinalSummary) {
        pushMessage({
          type: 'assistant',
          message: {
            role: 'assistant',
            content: CODEX_MISSING_FINAL_SUMMARY_MESSAGE,
          },
        }, completionState.completionTimestamp || timestampCursor.currentTimestamp());
      }
    }

    const tokenUsage = getCodexThreadTokenUsage(sessionId);

    // Sort by timestamp
    messages.sort((a, b) => new Date(a.timestamp || 0) - new Date(b.timestamp || 0));

    const total = messages.length;

    // Apply pagination if limit is specified
    if (limit !== null) {
      let startIndex = Math.max(0, total - offset - limit);
      let endIndex = total - offset;
      let paginatedMessages = messages.slice(startIndex, endIndex);

      // Preserve tool_use/tool_result pairs across page boundaries so refreshed views
      // do not hide a tool card just because the initial page cut between the pair.
      if (paginatedMessages.length > 0 && startIndex > 0) {
        const firstMessage = paginatedMessages[0];
        const previousMessage = messages[startIndex - 1];
        if (
          firstMessage?.type === 'tool_result'
          && previousMessage?.type === 'tool_use'
          && firstMessage.toolCallId
          && previousMessage.toolCallId === firstMessage.toolCallId
        ) {
          paginatedMessages = [previousMessage, ...paginatedMessages];
          startIndex -= 1;
        }
      }

      if (paginatedMessages.length > 0 && endIndex < total) {
        const lastMessage = paginatedMessages[paginatedMessages.length - 1];
        const nextMessage = messages[endIndex];
        if (
          lastMessage?.type === 'tool_use'
          && nextMessage?.type === 'tool_result'
          && lastMessage.toolCallId
          && nextMessage.toolCallId === lastMessage.toolCallId
        ) {
          paginatedMessages = [...paginatedMessages, nextMessage];
          endIndex += 1;
        }
      }

      const hasMore = startIndex > 0;

      const result = {
        messages: paginatedMessages,
        total,
        hasMore,
        offset,
        limit,
        tokenUsage
      };
      setCachedCodexSessionMessages(cacheKey, result);
      return result;
    }

    const result = { messages, tokenUsage };
    setCachedCodexSessionMessages(cacheKey, result);
    return result;

  } catch (error) {
    if (error?.code === 'CODEX_THREAD_UNSUPPORTED' || error?.code === 'CODEX_THREAD_NOT_FOUND') {
      throw error;
    }
    if (cachedEntry?.value) {
      console.warn(`Using cached Codex session messages for ${sessionId} after read failure:`, error.message);
      setCachedCodexSessionMessages(cacheKey, cachedEntry.value);
      return cachedEntry.value;
    }

    const log = isRetryableCodexMetadataError(error) ? console.warn : console.error;
    log(`Error reading Codex session messages for ${sessionId}:`, error);
    const fallback = { messages: [], total: 0, hasMore: false };
    setCachedCodexSessionMessages(cacheKey, fallback);
    return fallback;
  }
  })().finally(() => {
    const latestEntry = codexSessionMessagesCache.get(cacheKey);
    if (latestEntry?.promise === loadPromise) {
      codexSessionMessagesCache.set(cacheKey, {
        value: latestEntry.value || null,
        promise: null,
        expiresAt: latestEntry.expiresAt,
      });
    }
  });

  setCachedCodexSessionMessages(cacheKey, cachedEntry?.value || null, loadPromise);
  return loadPromise;
}

async function deleteCodexSession(sessionId) {
  return deleteCodexThreadHard(sessionId);
}

async function searchConversations(query, limit = 50, onProjectResult = null, signal = null) {
  const safeQuery = typeof query === 'string' ? query.trim() : '';
  const safeLimit = Math.max(1, Math.min(Number.isFinite(limit) ? limit : 50, 200));
  const claudeDir = path.join(os.homedir(), '.claude', 'projects');
  const config = await loadProjectConfig();
  const results = [];
  let totalMatches = 0;
  const words = safeQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
  if (words.length === 0) return { results: [], totalMatches: 0, query: safeQuery };

  const isAborted = () => signal?.aborted === true;

  const isSystemMessage = (textContent) => {
    return typeof textContent === 'string' && (
      textContent.startsWith('<command-name>') ||
      textContent.startsWith('<command-message>') ||
      textContent.startsWith('<command-args>') ||
      textContent.startsWith('<local-command-stdout>') ||
      textContent.startsWith('<system-reminder>') ||
      textContent.startsWith('Caveat:') ||
      textContent.startsWith('This session is being continued from a previous') ||
      textContent.startsWith('Invalid API key') ||
      textContent.includes('{"subtasks":') ||
      textContent.includes('CRITICAL: You MUST respond with ONLY a JSON') ||
      textContent === 'Warmup'
    );
  };

  const extractText = (content) => {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
      return content
        .filter(part => part.type === 'text' && part.text)
        .map(part => part.text)
        .join(' ');
    }
    return '';
  };

  const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const wordPatterns = words.map(w => new RegExp(`(?<!\\p{L})${escapeRegex(w)}(?!\\p{L})`, 'u'));
  const allWordsMatch = (textLower) => {
    return wordPatterns.every(p => p.test(textLower));
  };

  const buildSnippet = (text, textLower, snippetLen = 150) => {
    let firstIndex = -1;
    let firstWordLen = 0;
    for (const w of words) {
      const re = new RegExp(`(?<!\\p{L})${escapeRegex(w)}(?!\\p{L})`, 'u');
      const m = re.exec(textLower);
      if (m && (firstIndex === -1 || m.index < firstIndex)) {
        firstIndex = m.index;
        firstWordLen = w.length;
      }
    }
    if (firstIndex === -1) firstIndex = 0;
    const halfLen = Math.floor(snippetLen / 2);
    let start = Math.max(0, firstIndex - halfLen);
    let end = Math.min(text.length, firstIndex + halfLen + firstWordLen);
    let snippet = text.slice(start, end).replace(/\n/g, ' ');
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    snippet = prefix + snippet + suffix;
    const snippetLower = snippet.toLowerCase();
    const highlights = [];
    for (const word of words) {
      const re = new RegExp(`(?<!\\p{L})${escapeRegex(word)}(?!\\p{L})`, 'gu');
      let match;
      while ((match = re.exec(snippetLower)) !== null) {
        highlights.push({ start: match.index, end: match.index + word.length });
      }
    }
    highlights.sort((a, b) => a.start - b.start);
    const merged = [];
    for (const h of highlights) {
      const last = merged[merged.length - 1];
      if (last && h.start <= last.end) {
        last.end = Math.max(last.end, h.end);
      } else {
        merged.push({ ...h });
      }
    }
    return { snippet, highlights: merged };
  };

  try {
    await fs.access(claudeDir);
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    const projectDirs = entries.filter(e => e.isDirectory());
    let scannedProjects = 0;
    const totalProjects = projectDirs.length;

    for (const projectEntry of projectDirs) {
      if (totalMatches >= safeLimit || isAborted()) break;

      const projectName = projectEntry.name;
      const projectDir = path.join(claudeDir, projectName);
      const displayName = config[projectName]?.displayName
        || await generateDisplayName(projectName);

      let files;
      try {
        files = await fs.readdir(projectDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter(
        file => file.endsWith('.jsonl') && !file.startsWith('agent-')
      );

      const projectResult = {
        projectName,
        projectDisplayName: displayName,
        sessions: []
      };

      for (const file of jsonlFiles) {
        if (totalMatches >= safeLimit || isAborted()) break;

        const filePath = path.join(projectDir, file);
        const sessionMatches = new Map();
        const sessionSummaries = new Map();
        const pendingSummaries = new Map();
        const sessionLastMessages = new Map();
        let currentSessionId = null;

        try {
          const fileStream = fsSync.createReadStream(filePath);
          const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
          });

          for await (const line of rl) {
            if (totalMatches >= safeLimit || isAborted()) break;
            if (!line.trim()) continue;

            let entry;
            try {
              entry = JSON.parse(line);
            } catch {
              continue;
            }

            if (entry.sessionId) {
              currentSessionId = entry.sessionId;
            }
            if (entry.type === 'summary' && entry.summary) {
              const sid = entry.sessionId || currentSessionId;
              if (sid) {
                sessionSummaries.set(sid, entry.summary);
              } else if (entry.leafUuid) {
                pendingSummaries.set(entry.leafUuid, entry.summary);
              }
            }

            // Apply pending summary via parentUuid
            if (entry.parentUuid && currentSessionId && !sessionSummaries.has(currentSessionId)) {
              const pending = pendingSummaries.get(entry.parentUuid);
              if (pending) sessionSummaries.set(currentSessionId, pending);
            }

            // Track last user/assistant message for fallback title
            if (entry.message?.content && currentSessionId && !entry.isApiErrorMessage) {
              const role = entry.message.role;
              if (role === 'user' || role === 'assistant') {
                const text = extractText(entry.message.content);
                if (text && !isSystemMessage(text)) {
                  if (!sessionLastMessages.has(currentSessionId)) {
                    sessionLastMessages.set(currentSessionId, {});
                  }
                  const msgs = sessionLastMessages.get(currentSessionId);
                  if (role === 'user') msgs.user = text;
                  else msgs.assistant = text;
                }
              }
            }

            if (!entry.message?.content) continue;
            if (entry.message.role !== 'user' && entry.message.role !== 'assistant') continue;
            if (entry.isApiErrorMessage) continue;

            const text = extractText(entry.message.content);
            if (!text || isSystemMessage(text)) continue;

            const textLower = text.toLowerCase();
            if (!allWordsMatch(textLower)) continue;

            const sessionId = entry.sessionId || currentSessionId || file.replace('.jsonl', '');
            if (!sessionMatches.has(sessionId)) {
              sessionMatches.set(sessionId, []);
            }

            const matches = sessionMatches.get(sessionId);
            if (matches.length < 2) {
              const { snippet, highlights } = buildSnippet(text, textLower);
              matches.push({
                role: entry.message.role,
                snippet,
                highlights,
                timestamp: entry.timestamp || null,
                provider: 'claude',
                messageUuid: entry.uuid || null
              });
              totalMatches++;
            }
          }
        } catch {
          continue;
        }

        for (const [sessionId, matches] of sessionMatches) {
          projectResult.sessions.push({
            sessionId,
            provider: 'claude',
            sessionSummary: sessionSummaries.get(sessionId) || (() => {
              const msgs = sessionLastMessages.get(sessionId);
              const lastMsg = msgs?.user || msgs?.assistant;
              return lastMsg ? (lastMsg.length > 50 ? lastMsg.substring(0, 50) + '...' : lastMsg) : 'New Session';
            })(),
            matches
          });
        }
      }

      // Search Codex sessions for this project
      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchCodexSessionsForProject(
            actualProjectDir, projectResult, words, allWordsMatch, extractText, isSystemMessage,
            buildSnippet, safeLimit, () => totalMatches, (n) => { totalMatches += n; }, isAborted
          );
        }
      } catch {
        // Skip codex search errors
      }

      // Search Gemini sessions for this project
      try {
        const actualProjectDir = await extractProjectDirectory(projectName);
        if (actualProjectDir && !isAborted() && totalMatches < safeLimit) {
          await searchGeminiSessionsForProject(
            actualProjectDir, projectResult, words, allWordsMatch,
            buildSnippet, safeLimit, () => totalMatches, (n) => { totalMatches += n; }
          );
        }
      } catch {
        // Skip gemini search errors
      }

      scannedProjects++;
      if (projectResult.sessions.length > 0) {
        results.push(projectResult);
        if (onProjectResult) {
          onProjectResult({ projectResult, totalMatches, scannedProjects, totalProjects });
        }
      } else if (onProjectResult && scannedProjects % 10 === 0) {
        onProjectResult({ projectResult: null, totalMatches, scannedProjects, totalProjects });
      }
    }
  } catch {
    // claudeDir doesn't exist
  }

  return { results, totalMatches, query: safeQuery };
}

async function searchCodexSessionsForProject(
  projectPath, projectResult, words, allWordsMatch, extractText, isSystemMessage,
  buildSnippet, limit, getTotalMatches, addMatches, isAborted
) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) return;
  let threads = [];

  try {
    const listed = await listCodexThreads({ pageSize: 200 });
    threads = listed?.data || [];
  } catch {
    return;
  }

  const maybeAddMatch = (matches, role, text, timestamp, messageUuid = null) => {
    const normalizedText = typeof text === 'string' ? text.trim() : '';
    if (!normalizedText || matches.length >= 2) {
      return false;
    }

    const textLower = normalizedText.toLowerCase();
    if (!allWordsMatch(textLower)) {
      return false;
    }

    const { snippet, highlights } = buildSnippet(normalizedText, textLower);
    matches.push({
      role,
      snippet,
      highlights,
      timestamp: timestamp || null,
      provider: 'codex',
      messageUuid,
    });
    addMatches(1);
    return true;
  };

  for (const thread of threads) {
    if (getTotalMatches() >= limit || isAborted()) break;
    if (normalizeComparablePath(thread?.cwd) !== normalizedProjectPath) continue;

    let fullThread;
    try {
      fullThread = await readCodexThread(thread.id, true);
    } catch {
      continue;
    }

    const matches = [];
    const sessionTimestamp = new Date(
      ((fullThread?.updatedAt || fullThread?.createdAt || thread?.updatedAt || thread?.createdAt || Date.now() / 1000) * 1000),
    ).toISOString();
    let lastUserMessage = typeof thread?.preview === 'string' ? thread.preview.trim() : '';

    for (const turn of fullThread?.turns || []) {
      if (getTotalMatches() >= limit || isAborted() || matches.length >= 2) {
        break;
      }

      for (const item of turn.items || []) {
        if (getTotalMatches() >= limit || isAborted() || matches.length >= 2) {
          break;
        }

        if (item.type === 'userMessage') {
          const text = (item.content || [])
            .filter((part) => part?.type === 'text' && typeof part.text === 'string')
            .map((part) => part.text)
            .join('\n')
            .trim();

          if (text) {
            lastUserMessage = text;
            maybeAddMatch(matches, 'user', text, sessionTimestamp, item.id || null);
          }
          continue;
        }

        if (item.type === 'agentMessage') {
          maybeAddMatch(matches, 'assistant', item.text, sessionTimestamp, item.id || null);
          continue;
        }

        if (item.type === 'plan') {
          maybeAddMatch(matches, 'assistant', item.text, sessionTimestamp, item.id || null);
          continue;
        }

        if (item.type === 'reasoning') {
          const reasoningText = [...(item.summary || []), ...(item.content || [])]
            .filter(Boolean)
            .join('\n\n')
            .trim();
          maybeAddMatch(matches, 'assistant', reasoningText, sessionTimestamp, item.id || null);
        }
      }
    }

    if (matches.length > 0) {
      projectResult.sessions.push({
        sessionId: thread.id,
        provider: 'codex',
        sessionSummary: lastUserMessage
          ? (lastUserMessage.length > 50 ? `${lastUserMessage.substring(0, 50)}...` : lastUserMessage)
          : 'Codex Session',
        matches,
      });
    }
  }
}

async function searchGeminiSessionsForProject(
  projectPath, projectResult, words, allWordsMatch,
  buildSnippet, limit, getTotalMatches, addMatches
) {
  // 1) Search in-memory sessions (created via UI)
  for (const [sessionId, session] of sessionManager.sessions) {
    if (getTotalMatches() >= limit) break;
    if (session.projectPath !== projectPath) continue;

    const matches = [];
    for (const msg of session.messages) {
      if (getTotalMatches() >= limit) break;
      if (msg.role !== 'user' && msg.role !== 'assistant') continue;

      const text = typeof msg.content === 'string' ? msg.content
        : Array.isArray(msg.content) ? msg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
        : '';
      if (!text) continue;

      const textLower = text.toLowerCase();
      if (!allWordsMatch(textLower)) continue;

      if (matches.length < 2) {
        const { snippet, highlights } = buildSnippet(text, textLower);
        matches.push({
          role: msg.role, snippet, highlights,
          timestamp: msg.timestamp ? msg.timestamp.toISOString() : null,
          provider: 'gemini'
        });
        addMatches(1);
      }
    }

    if (matches.length > 0) {
      const firstUserMsg = session.messages.find(m => m.role === 'user');
      const summary = firstUserMsg?.content
        ? (typeof firstUserMsg.content === 'string'
          ? (firstUserMsg.content.length > 50 ? firstUserMsg.content.substring(0, 50) + '...' : firstUserMsg.content)
          : 'Gemini Session')
        : 'Gemini Session';

      projectResult.sessions.push({
        sessionId,
        provider: 'gemini',
        sessionSummary: summary,
        matches
      });
    }
  }

  // 2) Search Gemini CLI sessions on disk (~/.gemini/tmp/<project>/chats/*.json)
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) return;

  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  try {
    await fs.access(geminiTmpDir);
  } catch {
    return;
  }

  const trackedSessionIds = new Set();
  for (const [sid] of sessionManager.sessions) {
    trackedSessionIds.add(sid);
  }

  let projectDirs;
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return;
  }

  for (const projectDir of projectDirs) {
    if (getTotalMatches() >= limit) break;

    const projectRootFile = path.join(geminiTmpDir, projectDir, '.project_root');
    let projectRoot;
    try {
      projectRoot = (await fs.readFile(projectRootFile, 'utf8')).trim();
    } catch {
      continue;
    }

    if (normalizeComparablePath(projectRoot) !== normalizedProjectPath) continue;

    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles;
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (getTotalMatches() >= limit) break;
      if (!chatFile.endsWith('.json')) continue;

      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data);
        if (!session.messages || !Array.isArray(session.messages)) continue;

        const cliSessionId = session.sessionId || chatFile.replace('.json', '');
        if (trackedSessionIds.has(cliSessionId)) continue;

        const matches = [];
        let firstUserText = null;

        for (const msg of session.messages) {
          if (getTotalMatches() >= limit) break;

          const role = msg.type === 'user' ? 'user'
            : (msg.type === 'gemini' || msg.type === 'assistant') ? 'assistant'
            : null;
          if (!role) continue;

          let text = '';
          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            text = msg.content
              .filter(p => p.text)
              .map(p => p.text)
              .join(' ');
          }
          if (!text) continue;

          if (role === 'user' && !firstUserText) firstUserText = text;

          const textLower = text.toLowerCase();
          if (!allWordsMatch(textLower)) continue;

          if (matches.length < 2) {
            const { snippet, highlights } = buildSnippet(text, textLower);
            matches.push({
              role, snippet, highlights,
              timestamp: msg.timestamp || null,
              provider: 'gemini'
            });
            addMatches(1);
          }
        }

        if (matches.length > 0) {
          const summary = firstUserText
            ? (firstUserText.length > 50 ? firstUserText.substring(0, 50) + '...' : firstUserText)
            : 'Gemini CLI Session';

          projectResult.sessions.push({
            sessionId: cliSessionId,
            provider: 'gemini',
            sessionSummary: summary,
            matches
          });
        }
      } catch {
        continue;
      }
    }
  }
}

async function getGeminiCliSessions(projectPath) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) return [];

  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  try {
    await fs.access(geminiTmpDir);
  } catch {
    return [];
  }

  const sessions = [];
  let projectDirs;
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const projectRootFile = path.join(geminiTmpDir, projectDir, '.project_root');
    let projectRoot;
    try {
      projectRoot = (await fs.readFile(projectRootFile, 'utf8')).trim();
    } catch {
      continue;
    }

    if (normalizeComparablePath(projectRoot) !== normalizedProjectPath) continue;

    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles;
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (!chatFile.endsWith('.json')) continue;
      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data);
        if (!session.messages || !Array.isArray(session.messages)) continue;

        const sessionId = session.sessionId || chatFile.replace('.json', '');
        const firstUserMsg = session.messages.find(m => m.type === 'user');
        let summary = 'Gemini CLI Session';
        if (firstUserMsg) {
          const text = Array.isArray(firstUserMsg.content)
            ? firstUserMsg.content.filter(p => p.text).map(p => p.text).join(' ')
            : (typeof firstUserMsg.content === 'string' ? firstUserMsg.content : '');
          if (text) {
            summary = text.length > 50 ? text.substring(0, 50) + '...' : text;
          }
        }

        sessions.push({
          id: sessionId,
          summary,
          messageCount: session.messages.length,
          lastActivity: session.lastUpdated || session.startTime || null,
          provider: 'gemini'
        });
      } catch {
        continue;
      }
    }
  }

  return sessions.sort((a, b) =>
    new Date(b.lastActivity || 0) - new Date(a.lastActivity || 0)
  );
}

async function buildGeminiCliActivityIndex() {
  const activityByProject = new Map();
  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');

  try {
    const projectDirs = await fs.readdir(geminiTmpDir);

    for (const projectDir of projectDirs) {
      const projectRootFile = path.join(geminiTmpDir, projectDir, '.project_root');
      let projectRoot;
      try {
        projectRoot = (await fs.readFile(projectRootFile, 'utf8')).trim();
      } catch {
        continue;
      }

      const normalizedProjectPath = normalizeComparablePath(projectRoot);
      if (!normalizedProjectPath) {
        continue;
      }

      const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
      let chatFiles;
      try {
        chatFiles = await fs.readdir(chatsDir);
      } catch {
        continue;
      }

      const timestamps = await Promise.all(
        chatFiles
          .filter((chatFile) => chatFile.endsWith('.json'))
          .map(async (chatFile) => {
            try {
              const stats = await fs.stat(path.join(chatsDir, chatFile));
              return stats.mtimeMs;
            } catch {
              return 0;
            }
          })
      );

      const latestChatActivity = getLatestTimestamp(timestamps);
      const existingActivity = activityByProject.get(normalizedProjectPath) || 0;
      if (latestChatActivity > existingActivity) {
        activityByProject.set(normalizedProjectPath, latestChatActivity);
      }
    }
  } catch {
    return activityByProject;
  }

  return activityByProject;
}

async function getGeminiProjectLastActivity(projectPath, indexRef = null) {
  const normalizedProjectPath = normalizeComparablePath(projectPath);
  if (!normalizedProjectPath) {
    return null;
  }

  const uiSessions = sessionManager.getProjectSessions(projectPath) || [];
  const uiLastActivity = uiSessions.length > 0 ? uiSessions[0].lastActivity : null;

  try {
    if (indexRef && !indexRef.activityByProject) {
      indexRef.activityByProject = await buildGeminiCliActivityIndex();
    }

    const activityByProject = indexRef?.activityByProject || await buildGeminiCliActivityIndex();
    const cliLastActivity = activityByProject.get(normalizedProjectPath) || 0;
    return toIsoTimestamp(getLatestTimestamp([uiLastActivity, cliLastActivity]));
  } catch (error) {
    console.warn('Could not determine Gemini project activity:', error.message);
    return toIsoTimestamp(uiLastActivity);
  }
}

async function getGeminiCliSessionMessages(sessionId) {
  const geminiTmpDir = path.join(os.homedir(), '.gemini', 'tmp');
  let projectDirs;
  try {
    projectDirs = await fs.readdir(geminiTmpDir);
  } catch {
    return [];
  }

  for (const projectDir of projectDirs) {
    const chatsDir = path.join(geminiTmpDir, projectDir, 'chats');
    let chatFiles;
    try {
      chatFiles = await fs.readdir(chatsDir);
    } catch {
      continue;
    }

    for (const chatFile of chatFiles) {
      if (!chatFile.endsWith('.json')) continue;
      try {
        const filePath = path.join(chatsDir, chatFile);
        const data = await fs.readFile(filePath, 'utf8');
        const session = JSON.parse(data);
        const fileSessionId = session.sessionId || chatFile.replace('.json', '');
        if (fileSessionId !== sessionId) continue;

        return (session.messages || []).map(msg => {
          const role = msg.type === 'user' ? 'user'
            : (msg.type === 'gemini' || msg.type === 'assistant') ? 'assistant'
            : msg.type;

          let content = '';
          if (typeof msg.content === 'string') {
            content = msg.content;
          } else if (Array.isArray(msg.content)) {
            content = msg.content.filter(p => p.text).map(p => p.text).join('\n');
          }

          return {
            type: 'message',
            message: { role, content },
            timestamp: msg.timestamp || null
          };
        });
      } catch {
        continue;
      }
    }
  }

  return [];
}

export {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getCodexSessions,
  getCodexSessionMessages,
  deleteCodexSession,
  getGeminiCliSessions,
  getGeminiCliSessionMessages,
  searchConversations
};
