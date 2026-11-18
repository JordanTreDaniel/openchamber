import { useState } from 'react';
import type { FC } from 'react';
import { VQ, hostTheme, type Answer } from 'vq-react';

// A developer tool, mounted only in development builds and never shipped, so
// its labels stay out of the translated dictionaries — same rule as
// MotionTuningPanel.
//
// Purpose: prove that a third-party React component library (vq-react, consumed
// as raw TypeScript source) mounts inside this app with the host's design
// tokens, exactly one copy of React, and a working callback. The panel renders
// a three-card deck plus the Answer JSON it got back, so a screenshot shows
// both directions of the wiring.
const SPEC = {
    type: 'assign',
    id: 'vq-mount-proof',
    skin: 'deck',
    title: 'Mount proof',
    prompt: 'Sort these refactors. Swipe a card or use the buttons.',
    items: [
        {
            id: 'chunk-split',
            label: 'Split the markdown renderer into its own lazy chunk',
            detail: 'KaTeX and Shiki are only needed once a message renders.',
        },
        {
            id: 'theme-tokens',
            label: 'Move the remaining hard-coded hex colours onto theme tokens',
            detail: 'Three surfaces still bypass the runtime CSS variables.',
        },
        {
            id: 'store-slice',
            label: 'Carve the session store into per-surface slices',
            detail: 'Chat, settings and diagnostics keep re-reading the whole store.',
        },
    ],
} as const;

const THEME = hostTheme({
    accent: '--primary',
    bg: '--surface-background',
    text: '--surface-foreground',
    muted: '--surface-muted-foreground',
    surface: '--surface-elevated',
    border: '--interactive-border',
});

export const VqMountPanel: FC = () => {
    const [answer, setAnswer] = useState<Answer | null>(null);
    const [issues, setIssues] = useState<string[] | null>(null);

    return (
        <div
            data-vq-proof=""
            data-testid="vq-mount-panel"
            style={{
                position: 'fixed',
                right: 16,
                bottom: 16,
                width: 420,
                maxWidth: 'calc(100vw - 32px)',
                boxSizing: 'border-box',
                maxHeight: '60vh',
                overflow: 'auto',
                zIndex: 9999,
                padding: 14,
                borderRadius: 14,
                border: '1px solid var(--interactive-border)',
                background: 'var(--surface-elevated)',
                color: 'var(--surface-foreground)',
                boxShadow: '0 12px 32px rgba(0,0,0,.45)',
                fontSize: 13,
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <strong style={{ fontSize: 12, letterSpacing: '.04em', textTransform: 'uppercase' }}>
                    vq-react mount proof
                </strong>
                <span style={{ fontSize: 11, color: 'var(--surface-muted-foreground)' }}>dev only</span>
            </div>

            <VQ spec={SPEC} onAnswer={setAnswer} theme={THEME} scheme="dark" onInvalid={setIssues} />

            <div style={{ marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--interactive-border)' }}>
                <div style={{ fontSize: 11, color: 'var(--surface-muted-foreground)', marginBottom: 4 }}>
                    onAnswer payload
                </div>
                <pre
                    data-testid="vq-answer-json"
                    style={{
                        margin: 0,
                        fontSize: 11,
                        lineHeight: 1.5,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        color: answer ? 'var(--surface-foreground)' : 'var(--surface-muted-foreground)',
                    }}
                >
                    {issues ? `invalid spec: ${issues.join('; ')}` : answer ? JSON.stringify(answer, null, 2) : 'answer the deck to populate'}
                </pre>
            </div>
        </div>
    );
};

export default VqMountPanel;
