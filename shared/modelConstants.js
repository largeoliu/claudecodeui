/**
 * Centralized Model Definitions
 * Single source of truth for all supported AI models
 */

/**
 * Model Context Windows (tokens)
 * Reference: https://platform.openai.com/docs/models
 * Note: Values may change over time; update as needed.
 */
export const MODEL_CONTEXT_WINDOWS = {
  // Claude (Anthropic) models - all Claude 4.x models have 200K context
  // SDK format keys
  'sonnet': 200000,
  'opus': 200000,
  'haiku': 200000,
  'opusplan': 200000,
  'sonnet[1m]': 1050000,

  // Codex (OpenAI) models
  'gpt-5.4': 1050000,
  'gpt-5.3-codex': 400000,
  'gpt-5.2-codex': 400000,
  'gpt-5.2': 400000,
  'gpt-5.1-codex-max': 2000000,
  'o3': 200000,
  'o4-mini': 128000,

  // Gemini models - 2.5+ models have 1M context, 2.0 varies
  'gemini-3.1-pro-preview': 1050000,
  'gemini-3-pro-preview': 1050000,
  'gemini-3-flash-preview': 1050000,
  'gemini-3-pro': 1050000,
  'gemini-2.5-flash': 1050000,
  'gemini-2.5-pro': 1050000,
  'gemini-2.0-flash-lite': 1050000,
  'gemini-2.0-flash': 128000,
  'gemini-2.0-pro-exp': 32000,
  'gemini-2.0-flash-thinking-exp': 1050000,

  // Other
  'grok': 128000,
};

export const DEFAULT_CONTEXT_WINDOW = 200000;

export function getContextWindow(model) {
  return MODEL_CONTEXT_WINDOWS[model] ?? DEFAULT_CONTEXT_WINDOW;
}

/**
 * Claude (Anthropic) Models
 *
 * Note: Claude uses two different formats:
 * - SDK format ('sonnet', 'opus') - used by the UI and claude-sdk.js
 * - API format ('claude-sonnet-4.5') - used by slash commands for display
 */
export const CLAUDE_MODELS = {
  // Models in SDK format (what the actual SDK accepts)
  OPTIONS: [
    { value: "sonnet", label: "Sonnet" },
    { value: "opus", label: "Opus" },
    { value: "haiku", label: "Haiku" },
    { value: "opusplan", label: "Opus Plan" },
    { value: "sonnet[1m]", label: "Sonnet [1M]" },
  ],

  DEFAULT: "sonnet",
};

/**
 * Codex (OpenAI) Models
 */
export const CODEX_MODELS = {
  OPTIONS: [
    { value: "gpt-5.4", label: "GPT-5.4" },
    { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
    { value: "gpt-5.2-codex", label: "GPT-5.2 Codex" },
    { value: "gpt-5.2", label: "GPT-5.2" },
    { value: "gpt-5.1-codex-max", label: "GPT-5.1 Codex Max" },
    { value: "o3", label: "O3" },
    { value: "o4-mini", label: "O4-mini" },
  ],

  DEFAULT: "gpt-5.4",
};

/**
 * Gemini Models
 */
export const GEMINI_MODELS = {
  OPTIONS: [
    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
    { value: "gemini-3-pro-preview", label: "Gemini 3 Pro Preview" },
    { value: "gemini-3-flash-preview", label: "Gemini 3 Flash Preview" },
    { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { value: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite" },
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash" },
    { value: "gemini-2.0-pro-exp", label: "Gemini 2.0 Pro Experimental" },
    {
      value: "gemini-2.0-flash-thinking-exp",
      label: "Gemini 2.0 Flash Thinking",
    },
  ],

  DEFAULT: "gemini-2.5-flash",
};
