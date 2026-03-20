import {
  applyInteractiveRequestDispatchResults,
  buildInteractiveResponseMessage,
  getInteractiveRequestTimeoutMessage,
  getInteractiveRequestTimeoutMs,
  isInteractiveRequestInFlight,
  mergePendingInteractiveRequests,
} from '../../src/components/chat/utils/interactiveRequestTransport';

describe('interactiveRequestTransport', () => {
  it('builds Codex user-input responses from collected answers', () => {
    expect(buildInteractiveResponseMessage(
      {
        requestId: 'req-1',
        provider: 'codex',
        requestKind: 'user-input',
        toolName: 'AskUserQuestion',
      },
      {
        updatedInput: {
          answers: {
            scope: 'Session',
            modes: ['edit', 'plan'],
          },
        },
      },
    )).toEqual({
      type: 'codex-user-input-response',
      requestId: 'req-1',
      answers: {
        scope: 'Session',
        modes: ['edit', 'plan'],
      },
    });
  });

  it('keeps requests in state and marks failed sends explicitly', () => {
    const requests = [
      { requestId: 'req-success', provider: 'codex', requestKind: 'approval', toolName: 'Bash' },
      { requestId: 'req-failed', provider: 'codex', requestKind: 'user-input', toolName: 'AskUserQuestion' },
    ];

    const next = applyInteractiveRequestDispatchResults(requests, new Map([
      ['req-success', true],
      ['req-failed', false],
    ]));

    expect(next).toEqual([
      expect.objectContaining({ requestId: 'req-success', deliveryState: 'submitting', deliveryError: null }),
      expect.objectContaining({ requestId: 'req-failed', deliveryState: 'failed' }),
    ]);
  });

  it('turns stale submitting requests into retryable failures after a refresh', () => {
    const next = mergePendingInteractiveRequests(
      [
        {
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'user-input',
          toolName: 'AskUserQuestion',
          deliveryState: 'submitting',
        },
      ],
      [
        {
          requestId: 'req-1',
          provider: 'codex',
          requestKind: 'user-input',
          toolName: 'AskUserQuestion',
        },
      ],
    );

    expect(next).toEqual([
      expect.objectContaining({
        requestId: 'req-1',
        deliveryState: 'failed',
        deliveryError: 'Previous submission was not confirmed. Please submit again.',
      }),
    ]);
  });

  it('keeps processing requests busy while the backend still reports them pending', () => {
    const next = mergePendingInteractiveRequests(
      [
        {
          requestId: 'req-2',
          provider: 'codex',
          requestKind: 'approval',
          toolName: 'Bash',
          deliveryState: 'processing',
        },
      ],
      [
        {
          requestId: 'req-2',
          provider: 'codex',
          requestKind: 'approval',
          toolName: 'Bash',
        },
      ],
    );

    expect(next).toEqual([
      expect.objectContaining({
        requestId: 'req-2',
        deliveryState: 'processing',
        deliveryError: null,
      }),
    ]);
  });

  it('tracks interactive requests through receipt and completion windows', () => {
    expect(isInteractiveRequestInFlight('submitting')).toBe(true);
    expect(isInteractiveRequestInFlight('processing')).toBe(true);
    expect(isInteractiveRequestInFlight('failed')).toBe(false);
    expect(getInteractiveRequestTimeoutMs('submitting')).toBe(5000);
    expect(getInteractiveRequestTimeoutMs('processing')).toBe(15000);
    expect(getInteractiveRequestTimeoutMessage('submitting')).toBe(
      'Server did not confirm receipt of the response. Please submit again.',
    );
    expect(getInteractiveRequestTimeoutMessage('processing')).toBe(
      'Server received the response, but completion was not confirmed. Please submit again if the request is still pending.',
    );
  });
});
