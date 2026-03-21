import { promises as fs } from 'fs';

function createTurnCompletionState() {
  return {
    completionTimestamp: null,
    hasTaskComplete: false,
    lastAgentMessage: undefined,
    missingFinalSummary: false,
  };
}

function getOrCreateTurnCompletionState(completionStates, turnId) {
  if (!turnId) {
    return null;
  }

  if (!completionStates.has(turnId)) {
    completionStates.set(turnId, createTurnCompletionState());
  }

  return completionStates.get(turnId);
}

function normalizeLastAgentMessage(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export async function extractCodexTurnCompletionStatesFromRollout(rolloutPath) {
  const completionStates = new Map();

  if (!rolloutPath) {
    return completionStates;
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
          continue;
        }

        if (entry.type === 'turn_context' && payload.turn_id) {
          currentTurnId = payload.turn_id;
          continue;
        }

        if (entry.type !== 'event_msg' || payload.type !== 'task_complete') {
          continue;
        }

        const turnId = payload.turn_id || currentTurnId;
        const completionState = getOrCreateTurnCompletionState(completionStates, turnId);

        if (!completionState) {
          continue;
        }

        completionState.completionTimestamp = timestamp;
        completionState.hasTaskComplete = true;

        if (Object.prototype.hasOwnProperty.call(payload, 'last_agent_message')) {
          completionState.lastAgentMessage = normalizeLastAgentMessage(payload.last_agent_message);
          completionState.missingFinalSummary = completionState.lastAgentMessage === null;
        }
      } catch {
        // Skip malformed rollout entries.
      }
    }
  } catch {
    return completionStates;
  }

  return completionStates;
}
