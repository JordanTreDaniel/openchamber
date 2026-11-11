# Live voice

## Ownership

The context panel's `voice` surface and its client, in `packages/ui/src/lib/voice/live`.
The panel draws; `live-voice-client.ts` owns the WebRTC session, the delegation
queue and the narration policy; `realtime-protocol.ts` owns every constant and
every string that leaves the browser.

The voice session is minted by OpenCode, through this instance's own `/api`
proxy (`POST /api/experimental/voice/session`), which adds the credential. The
browser never holds one, and this module never mints on its own authority: the
proxy's auth is the gate, which is why there is no separate server route.

The work itself runs in a real OpenCode session the panel is bound to, through
the app's own send path (`useSessionUIStore.sendMessage`) and its own sync layer
(`subscribeDirectorySessionMessages`, `subscribeSessionStatusTransitions`). No
second WebSocket, no raw prompt proxy, no local text-to-speech.

## Invariants

- **One client for the whole app, one session for the whole client.** The client
  is a module-level singleton, never effect-scoped: a mount/unmount (or Strict
  Mode's double invoke) must not mint a second voice session or drop the one the
  user is talking through. `start()` is idempotent on `running`.
- **Teardown is the only exit, and it is idempotent.** `dc.onclose`,
  `pc.onconnectionstatechange` and `pc.oniceconnectionstatechange` all call it,
  and it stops every microphone track before anything else. A live mic track
  outliving a dead transport leaves `running` true, swallows the next Start and
  keeps the microphone open — the defect this ordering exists to prevent.
- **`commentary.append` is the only path to the user's ear.** Everything heard
  is the voice model paraphrasing our text. Nothing is synthesised locally.
- **A turn ends on the execution, never on a step.** The engine's equivalent of
  `session.execution.succeeded` is the session status leaving `busy` after this
  job's own start; `subscribeSessionStatusTransitions` supplies it. A prompt
  ends a step after every tool call, so anything keyed on a step closes the job
  on an empty step and loses the answer. `sawStart` is why a completion from a
  previous run cannot end this one, and a quiescence fallback covers a start
  that was never observed.
- **The status always settles.** Every exit from a job — answer, empty answer,
  refusal, timeout, interrupt — leaves the panel at `listening`, never stuck in
  `working`.
- **An empty delegation prompts nothing.** An empty, whitespace or
  punctuation-only task would send an empty prompt, which re-runs the previous
  request.
- **One ask, one job.** Identical tasks inside `DUPLICATE_WINDOW_MS` while a job
  is in flight are ignored; jobs run one at a time, in order. There is no
  cancel, no supersede and no documented timeout in the protocol, so none is
  invented. Barge-in does not cancel work.
- **Every append is paced and clamped.** Appends leave through one queue at
  least `APPEND_GAP_MS` apart, clamped on characters *and* UTF-8 bytes: the cap
  is 500 tokens, and a character count is a lie for any non-ASCII text.
- **`error` events are surfaced, never dropped.** A rejected append arrives
  exactly that way and is the only report of it.
- **A final answer is spoken whatever its length.** `MIN_SPOKEN_CHARS` filters
  progress fragments only: "main" and "4" are real answers.
- **The panel binds to an existing session.** Voice work runs in the session the
  chat is showing; the panel never creates a session, because one created
  without a working directory runs in `$HOME` and deadlocks.

## Decisions

### Why a second start path instead of a second server route

The reference implementation minted through its own Node process, holding the
OpenCode password. Here the proxy already injects the credential for the logged-in
browser, so the same request works from the page. Keeping it client-side removes
a route, a credential holder and a trust boundary.

### Why `session.thinking.append` is context, not a mute button

It is sent immediately on every delegation, and across live runs the model still
says "on it" first. Treating it as silence would build on behaviour the protocol
does not promise.

### Why progress commentary is throttled to ten seconds

Spoken progress is expensive attention and it collides with the model's own
speech. The final answer is never throttled; only the fragments are.

### Why a pending form is surfaced instead of answered

An agent blocked on the `question` tool produces silence forever. The panel shows
the question, offers the chat, and `interruptForQuestion()` uses the one verb
that cuts speech (`instructions.append`) plus an abort, so the job ends honestly
instead of holding a question nobody can answer.

### Why the panel's agent picker does not write the composer's selection

The picked agent is passed as `sendMessage`'s `agent` argument. Writing
`pickSessionAgent` would also change what the chat composer sends next, which is
not what a voice panel is being asked to do.
