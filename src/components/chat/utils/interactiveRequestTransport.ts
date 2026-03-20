import type { PendingPermissionRequest } from '../types/types';

export type InteractiveDecision = {
  allow?: boolean;
  message?: string;
  rememberEntry?: string | null;
  updatedInput?: unknown;
};

export const INTERACTIVE_REQUEST_SEND_FAILURE_MESSAGE = 'Response was not delivered. Reconnect and try again.';
export const INTERACTIVE_REQUEST_RETRY_MESSAGE = 'Previous submission was not confirmed. Please submit again.';
export const INTERACTIVE_REQUEST_RECEIPT_TIMEOUT_MS = 5_000;
export const INTERACTIVE_REQUEST_COMPLETION_TIMEOUT_MS = 15_000;
export const INTERACTIVE_REQUEST_RECEIPT_TIMEOUT_MESSAGE =
  'Server did not confirm receipt of the response. Please submit again.';
export const INTERACTIVE_REQUEST_COMPLETION_TIMEOUT_MESSAGE =
  'Server received the response, but completion was not confirmed. Please submit again if the request is still pending.';

export function isInteractiveRequestInFlight(
  deliveryState: PendingPermissionRequest['deliveryState'],
): deliveryState is 'submitting' | 'processing' {
  return deliveryState === 'submitting' || deliveryState === 'processing';
}

export function getInteractiveRequestTimeoutMs(
  deliveryState: PendingPermissionRequest['deliveryState'],
): number | null {
  if (deliveryState === 'submitting') {
    return INTERACTIVE_REQUEST_RECEIPT_TIMEOUT_MS;
  }

  if (deliveryState === 'processing') {
    return INTERACTIVE_REQUEST_COMPLETION_TIMEOUT_MS;
  }

  return null;
}

export function getInteractiveRequestTimeoutMessage(
  deliveryState: PendingPermissionRequest['deliveryState'],
): string {
  return deliveryState === 'processing'
    ? INTERACTIVE_REQUEST_COMPLETION_TIMEOUT_MESSAGE
    : INTERACTIVE_REQUEST_RECEIPT_TIMEOUT_MESSAGE;
}

export function createPendingInteractiveRequest(
  request: PendingPermissionRequest,
): PendingPermissionRequest {
  return {
    ...request,
    deliveryState: request.deliveryState || 'idle',
    deliveryError: request.deliveryError || null,
  };
}

export function buildInteractiveResponseMessage(
  request: PendingPermissionRequest,
  decision: InteractiveDecision,
): Record<string, unknown> | null {
  if (request.provider === 'codex') {
    if (request.requestKind === 'user-input') {
      const updatedInput =
        decision?.updatedInput && typeof decision.updatedInput === 'object'
          ? (decision.updatedInput as Record<string, unknown>)
          : null;
      const answers =
        updatedInput?.answers && typeof updatedInput.answers === 'object' && !Array.isArray(updatedInput.answers)
          ? updatedInput.answers
          : {};

      return {
        type: 'codex-user-input-response',
        requestId: request.requestId,
        answers,
      };
    }

    if (request.requestKind === 'terminal-stdin') {
      const updatedInput =
        decision?.updatedInput && typeof decision.updatedInput === 'object'
          ? (decision.updatedInput as Record<string, unknown>)
          : null;
      const text =
        typeof decision?.updatedInput === 'string'
          ? decision.updatedInput
          : typeof updatedInput?.text === 'string'
            ? updatedInput.text
            : '';

      return {
        type: 'codex-command-stdin-response',
        requestId: request.requestId,
        text,
      };
    }

    return {
      type: 'codex-approval-response',
      requestId: request.requestId,
      allow: Boolean(decision?.allow),
      rememberEntry: decision?.rememberEntry,
    };
  }

  return {
    type: 'claude-permission-response',
    requestId: request.requestId,
    allow: Boolean(decision?.allow),
    updatedInput: decision?.updatedInput,
    message: decision?.message,
    rememberEntry: decision?.rememberEntry,
  };
}

export function applyInteractiveRequestDispatchResults(
  requests: PendingPermissionRequest[],
  sendResults: Map<string, boolean>,
): PendingPermissionRequest[] {
  return requests.map((request) => {
    const didSend = sendResults.get(request.requestId);
    if (didSend === undefined) {
      return request;
    }

    return {
      ...request,
      deliveryState: didSend ? 'submitting' : 'failed',
      deliveryError: didSend ? null : INTERACTIVE_REQUEST_SEND_FAILURE_MESSAGE,
    };
  });
}

export function setInteractiveRequestDeliveryState(
  requests: PendingPermissionRequest[],
  requestId: string,
  deliveryState: PendingPermissionRequest['deliveryState'],
  deliveryError: string | null = null,
): PendingPermissionRequest[] {
  return requests.map((request) => (
    request.requestId === requestId
      ? {
          ...request,
          deliveryState,
          deliveryError,
        }
      : request
  ));
}

export function upsertPendingInteractiveRequest(
  requests: PendingPermissionRequest[],
  incomingRequest: PendingPermissionRequest,
): PendingPermissionRequest[] {
  const normalizedRequest = createPendingInteractiveRequest(incomingRequest);
  const existingRequest = requests.find((request) => request.requestId === normalizedRequest.requestId);

  if (!existingRequest) {
    return [...requests, normalizedRequest];
  }

  return requests.map((request) => {
    if (request.requestId !== normalizedRequest.requestId) {
      return request;
    }

    return {
      ...normalizedRequest,
      deliveryState: request.deliveryState || 'idle',
      deliveryError: request.deliveryError || null,
    };
  });
}

export function mergePendingInteractiveRequests(
  previousRequests: PendingPermissionRequest[],
  incomingRequests: PendingPermissionRequest[],
): PendingPermissionRequest[] {
  const previousById = new Map(
    previousRequests.map((request) => [request.requestId, request]),
  );

  return incomingRequests.map((request) => {
    const normalizedRequest = createPendingInteractiveRequest(request);
    const previousRequest = previousById.get(normalizedRequest.requestId);

    if (!previousRequest) {
      return normalizedRequest;
    }

    if (previousRequest.deliveryState === 'submitting') {
      return {
        ...normalizedRequest,
        deliveryState: 'failed',
        deliveryError: INTERACTIVE_REQUEST_RETRY_MESSAGE,
      };
    }

    if (previousRequest.deliveryState === 'processing') {
      return {
        ...normalizedRequest,
        deliveryState: 'processing',
        deliveryError: null,
      };
    }

    if (previousRequest.deliveryState === 'failed') {
      return {
        ...normalizedRequest,
        deliveryState: 'failed',
        deliveryError: previousRequest.deliveryError || INTERACTIVE_REQUEST_SEND_FAILURE_MESSAGE,
      };
    }

    return normalizedRequest;
  });
}
