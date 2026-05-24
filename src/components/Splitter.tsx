"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';

interface SplitterProps {
    /** Vertical splitter (drag horizontally — for resizing a side panel width). */
    orientation: 'vertical' | 'horizontal';
    /** Resize target side of the splitter — `before` to size what's left/above, `after` for right/below. */
    target: 'before' | 'after';
    /** Initial size in pixels. */
    initialSize: number;
    minSize: number;
    maxSize: number;
    /** Called with the new pixel size during and after a drag. */
    onResize: (size: number) => void;
    /** localStorage key to persist size across reloads. */
    storageKey?: string;
}

// Pure drag handle. The caller renders the actual panel and applies the size
// (passed via onResize) — Splitter only manages pointer events and bounds.
// Designed for both vertical (resizes width) and horizontal (resizes height) splits.
export const Splitter: React.FC<SplitterProps> = ({
    orientation,
    target,
    initialSize,
    minSize,
    maxSize,
    onResize,
    storageKey
}) => {
    // Restore last saved size on mount.
    useEffect(() => {
        if (!storageKey) return;
        try {
            const raw = localStorage.getItem(storageKey);
            if (!raw) return;
            const n = parseInt(raw, 10);
            if (Number.isFinite(n)) onResize(Math.max(minSize, Math.min(maxSize, n)));
        } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [dragging, setDragging] = useState(false);
    const startRef = useRef<{ pos: number; size: number } | null>(null);
    const sizeRef = useRef(initialSize);

    useEffect(() => { sizeRef.current = initialSize; }, [initialSize]);

    const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const pos = orientation === 'vertical' ? e.clientX : e.clientY;
        startRef.current = { pos, size: sizeRef.current };
        setDragging(true);
    }, [orientation]);

    const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
        if (!startRef.current) return;
        const pos = orientation === 'vertical' ? e.clientX : e.clientY;
        let delta = pos - startRef.current.pos;
        if (target === 'after') delta = -delta;
        let next = startRef.current.size + delta;
        if (next < minSize) next = minSize;
        if (next > maxSize) next = maxSize;
        sizeRef.current = next;
        onResize(next);
    }, [orientation, target, minSize, maxSize, onResize]);

    const onPointerUp = useCallback(() => {
        startRef.current = null;
        setDragging(false);
        if (storageKey) {
            try { localStorage.setItem(storageKey, String(Math.round(sizeRef.current))); } catch { /* ignore */ }
        }
    }, [storageKey]);

    const cursorClass = orientation === 'vertical' ? 'cursor-col-resize' : 'cursor-row-resize';
    // Thin visible track that fattens on hover/drag so it's easier to grab.
    const baseClass = orientation === 'vertical'
        ? 'w-1 hover:w-1.5 group h-full'
        : 'h-1 hover:h-1.5 group w-full';

    return (
        <div
            role="separator"
            aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
            tabIndex={0}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`relative shrink-0 ${baseClass} ${cursorClass} transition-all duration-150 ${dragging ? 'bg-blue-500/70' : 'bg-zinc-800 hover:bg-blue-500/40'}`}
            title="Drag to resize"
        >
            {/* Wider invisible hit-area so the splitter is comfortable to grab. */}
            <div className={orientation === 'vertical' ? 'absolute inset-y-0 -left-1 -right-1' : 'absolute inset-x-0 -top-1 -bottom-1'} />
        </div>
    );
};
