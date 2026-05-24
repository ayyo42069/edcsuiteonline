"use client";

import React, { useEffect, useMemo, useState } from 'react';
import { useFileStore } from '../store/useFileStore';
import { setupAsPopout, teardown } from '../utils/popoutSync';
import { MapEditor } from './MapEditor';
import { SymbolHelper } from '../core/types';

interface PopoutViewProps {
    address: number; // flashStartAddress (hex parsed in page.tsx)
}

// Minimal layout for a popped-out map editor window. Pulls its data from the
// opener via BroadcastChannel — no file upload, no sidebar, no top-bar chrome.
// Just cell grid + selection toolbar.
export const PopoutView: React.FC<PopoutViewProps> = ({ address }) => {
    const symbols = useFileStore(s => s.symbols);
    const fileBuffer = useFileStore(s => s.fileBuffer);
    const fileName = useFileStore(s => s.fileName);
    const [waitingForState, setWaitingForState] = useState(true);

    // The symbol we're editing — picked out of the synchronized symbol list by
    // its flash address (the stable cross-window identifier).
    const symbol: SymbolHelper | null = useMemo(
        () => symbols.find(s => s.flashStartAddress === address) ?? null,
        [symbols, address]
    );

    // Open the channel and request state once on mount.
    useEffect(() => {
        setupAsPopout();
        return () => { teardown(); };
    }, []);

    // Hide the "waiting" splash once we have the buffer.
    useEffect(() => {
        if (fileBuffer && symbols.length > 0) setWaitingForState(false);
    }, [fileBuffer, symbols.length]);

    // Surface this map's name in the window title for tab strip visibility.
    useEffect(() => {
        if (symbol) document.title = `${symbol.varname || 'Map'} — EDC Suite`;
        else document.title = 'EDC Suite popout';
    }, [symbol]);

    if (waitingForState) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 gap-3">
                <div className="text-blue-400 animate-pulse text-lg">Syncing with main window…</div>
                <div className="text-xs text-zinc-600">
                    Make sure the main EDC Suite window is still open. This window receives
                    edits live and sends edits back to it via BroadcastChannel.
                </div>
            </div>
        );
    }

    if (!symbol) {
        return (
            <div className="h-screen w-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-400 gap-3 p-6 text-center">
                <div className="text-amber-400 text-lg">Map not found</div>
                <div className="text-xs text-zinc-600">
                    No symbol with address 0x{address.toString(16).toUpperCase()} exists in the loaded file.
                    Open the main window, select a map, and click <span className="text-zinc-300">Pop Out</span> again.
                </div>
            </div>
        );
    }

    if (!fileBuffer) return null;

    return (
        <div className="h-screen w-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden">
            {/* Compact header — symbol identity only. No sidebar / no global menu. */}
            <header className="flex-shrink-0 px-4 py-2 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center gap-4">
                <div className="min-w-0 flex-1">
                    <div className="font-bold text-sm text-zinc-100 truncate" title={symbol.varname}>
                        {symbol.varname || `Map @ 0x${symbol.flashStartAddress.toString(16).toUpperCase()}`}
                    </div>
                    <div className="flex gap-3 text-zinc-500 mt-0.5 text-[10px] font-mono flex-wrap">
                        <span>0x{symbol.flashStartAddress.toString(16).toUpperCase()}</span>
                        <span>·</span>
                        <span>{symbol.xAxisLength}×{symbol.yAxisLength}</span>
                        <span>·</span>
                        <span>factor {symbol.correction}</span>
                        {symbol.offset !== 0 && <><span>·</span><span>offset {symbol.offset}</span></>}
                    </div>
                </div>
                <div className="text-right text-[10px] text-zinc-500 shrink-0 font-mono">
                    <div className="text-blue-300">X: {symbol.xAxisDescr || 'X'}{symbol.xaxisUnits ? ` (${symbol.xaxisUnits})` : ''}</div>
                    <div className="text-green-300">Y: {symbol.yAxisDescr || 'Y'}{symbol.yaxisUnits ? ` (${symbol.yaxisUnits})` : ''}</div>
                    <div className="text-purple-300">Z: {symbol.zAxisDescr || 'Value'}</div>
                </div>
            </header>

            <div className="flex-1 overflow-hidden">
                <MapEditor symbol={symbol} fileBuffer={fileBuffer} />
            </div>

            {/* Bottom hint: which file we're editing, so users with several windows
                know what they're looking at. */}
            <footer className="flex-shrink-0 px-3 py-1 bg-zinc-900/60 border-t border-zinc-800 text-[10px] text-zinc-500 font-mono flex justify-between">
                <span>Edits sync live with the main window.</span>
                <span className="truncate ml-2">{fileName}</span>
            </footer>
        </div>
    );
};
