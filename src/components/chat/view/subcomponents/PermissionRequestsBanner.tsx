import React from 'react';
import { useTranslation } from 'react-i18next';
import type { PendingPermissionRequest } from '../../types/types';
import { buildClaudeToolPermissionEntry, formatToolInputForDisplay } from '../../utils/chatPermissions';
import { getClaudeSettings } from '../../utils/chatStorage';
import { getPermissionPanel, registerPermissionPanel } from '../../tools/configs/permissionPanelRegistry';
import {
  AskUserQuestionPanel,
  CodexTerminalInputPanel,
} from '../../tools/components/InteractiveRenderers';

registerPermissionPanel('AskUserQuestion', AskUserQuestionPanel);
registerPermissionPanel('CodexTerminalInput', CodexTerminalInputPanel);

interface PermissionRequestsBannerProps {
  pendingPermissionRequests: PendingPermissionRequest[];
  handlePermissionDecision: (
    requestIds: string | string[],
    decision: { allow?: boolean; message?: string; rememberEntry?: string | null; updatedInput?: unknown },
  ) => void;
  handleGrantToolPermission: (suggestion: { entry: string; toolName: string }) => { success: boolean };
}

export default function PermissionRequestsBanner({
  pendingPermissionRequests,
  handlePermissionDecision,
  handleGrantToolPermission,
}: PermissionRequestsBannerProps) {
  const { t } = useTranslation('chat');

  if (!pendingPermissionRequests.length) {
    return null;
  }

  return (
    <div className="mb-3 space-y-3">
      {pendingPermissionRequests.map((request) => {
        const CustomPanel = getPermissionPanel(request.toolName);
        if (CustomPanel) {
          return (
            <CustomPanel
              key={request.requestId}
              request={request}
              onDecision={handlePermissionDecision}
            />
          );
        }

        const rawInput = formatToolInputForDisplay(request.input);
        const permissionEntry = buildClaudeToolPermissionEntry(request.toolName, rawInput);
        const isClaudeRequest = request.provider === 'claude' || !request.provider;
        const isCodexApproval = request.provider === 'codex' && request.requestKind === 'approval';
        const settings = getClaudeSettings();
        const alreadyAllowed = isClaudeRequest && permissionEntry
          ? settings.allowedTools.includes(permissionEntry)
          : false;

        const matchingRequestIds = permissionEntry
          ? pendingPermissionRequests
              .filter(
                (item) =>
                  item.provider === request.provider &&
                  buildClaudeToolPermissionEntry(item.toolName, formatToolInputForDisplay(item.input)) === permissionEntry,
              )
              .map((item) => item.requestId)
          : [request.requestId];
        const canRemember = Boolean(permissionEntry) && (isClaudeRequest || isCodexApproval);

        // Parse human-readable action description
        let actionDescription = rawInput;
        try {
          // If rawInput is a stringified JSON, we try to parse it
          const parsedArgs = JSON.parse(rawInput || '{}');
          if (request.toolName === 'Bash' || request.toolName === 'run_command') {
            actionDescription = parsedArgs.command || rawInput;
          } else if (['Read', 'View', 'view_file'].includes(request.toolName)) {
            actionDescription = `${t('permissions.actions.read', { defaultValue: '阅读文件' })}: ${parsedArgs.path || parsedArgs.file_path || parsedArgs.AbsolutePath || ''}`;
          } else if (['Write', 'Edit', 'replace_file_content', 'multi_replace_file_content', 'write_to_file'].includes(request.toolName)) {
            actionDescription = `${t('permissions.actions.write', { defaultValue: '修改/写入文件' })}: ${parsedArgs.path || parsedArgs.file_path || parsedArgs.TargetFile || ''}`;
          } else if (request.toolName === 'ApplyPatch') {
            actionDescription = `${t('permissions.actions.patch', { defaultValue: '应用补丁' })}: ${parsedArgs.path || parsedArgs.file_path || ''}`;
          } else if (request.toolName === 'search_web') {
            actionDescription = `${t('permissions.actions.search', { defaultValue: '网络搜索' })}: ${parsedArgs.query || ''}`;
          }
        } catch (e) {
           actionDescription = rawInput; // fallback
        }

        return (
          <div
            key={request.requestId}
            className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 shadow-sm backdrop-blur-md dark:bg-amber-500/5 transition-all animate-in slide-in-from-bottom-2"
          >
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-xs text-amber-600 dark:text-amber-400">
                  🛡️
                </span>
                <span className="font-semibold text-amber-900 dark:text-amber-100">
                  {t('permissions.title', { defaultValue: '需要您的授权' })}
                </span>
                <span className="rounded-md bg-amber-500/15 px-2 py-0.5 font-mono text-xs font-semibold text-amber-700 dark:text-amber-300">
                  {request.toolName}
                </span>
              </div>

              {/* Human-readable parsed content */}
              <div className="ml-8 rounded-xl border border-amber-500/20 bg-background/60 p-3 font-mono text-xs text-foreground shadow-sm dark:bg-background/40 max-h-40 overflow-auto">
                <div className="whitespace-pre-wrap break-all leading-relaxed">
                  {actionDescription}
                </div>
              </div>

              {/* Actions */}
              <div className="mt-2 ml-8 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: true })}
                  className="inline-flex min-w-[100px] items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:bg-amber-600 focus:outline-none focus:ring-2 focus:ring-amber-500/30 active:scale-95"
                >
                  {t('permissions.allowOnceButton', { defaultValue: '允许单次' })}
                </button>
                
                <button
                  type="button"
                  onClick={() => {
                    if (isClaudeRequest && permissionEntry && !alreadyAllowed) {
                      handleGrantToolPermission({ entry: permissionEntry, toolName: request.toolName });
                    }
                    handlePermissionDecision(matchingRequestIds, { allow: true, rememberEntry: permissionEntry });
                  }}
                  className={`inline-flex min-w-[100px] items-center justify-center gap-2 rounded-xl border border-amber-500/30 bg-background/50 px-4 py-2 text-xs font-bold shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-amber-500/20 active:scale-95 ${
                    canRemember
                      ? 'text-amber-700 hover:bg-amber-500/10 dark:text-amber-300'
                      : 'cursor-not-allowed opacity-50 dark:opacity-40 text-amber-900 dark:text-amber-100'
                  }`}
                  disabled={!canRemember}
                >
                  {isCodexApproval 
                    ? t('permissions.allowSessionButton', { defaultValue: '本会话允许' }) 
                    : alreadyAllowed 
                      ? t('permissions.allowSavedButton', { defaultValue: '允许 (已存)' }) 
                      : t('permissions.allowAlwaysButton', { defaultValue: '始终允许' })}
                </button>

                <button
                  type="button"
                  onClick={() => handlePermissionDecision(request.requestId, { allow: false, message: 'User denied tool use' })}
                  className="inline-flex min-w-[80px] items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-background/50 px-4 py-2 text-xs font-bold text-red-600 shadow-sm transition-all hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500/30 active:scale-95 dark:text-red-400"
                >
                  {t('permissions.denyButton', { defaultValue: '拒绝' })}
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
