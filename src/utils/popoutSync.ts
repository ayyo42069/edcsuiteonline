// Cross-window state sync for popped-out map editor windows.
//
// Architecture: every window (opener and any number of popouts) opens the same
// BroadcastChannel. Whichever window has the file loaded acts as the canonical
// source. New popouts broadcast `hello` on mount; any window that has a file
// replies with a `state` snapshot containing the buffer + parsed symbols. After
// that, individual edits propagate as small messages (cell coords + new value)
// so we don't ship the whole 512KB buffer on every keystroke.
//
// To avoid feedback loops, when a remote message arrives we run the receiving
// store action inside a "suppress broadcast" guard — that action mutates the
// local store without re-broadcasting.

import { useFileStore } from '../store/useFileStore';
import { SymbolHelper, SymbolCollection, CodeBlock, AxisHelper, EDCFileType } from '../core/types';

const CHANNEL_NAME = 'edcsuite-sync';

type StateSnapshot = {
    buffer: ArrayBuffer;
    fileName: string;
    fileType: EDCFileType;
    symbols: SymbolCollection;
    codeBlocks: CodeBlock[];
    axisHelpers: AxisHelper[];
};

type SyncMessage =
    | { type: 'hello'; senderId: string }
    // Reply to `hello` with the full current state.
    | { type: 'state'; senderId: string; targetId: string; payload: StateSnapshot | null }
    // Edits (one of these per store mutation).
    | { type: 'edit-single'; senderId: string; symbolAddress: number; xIndex: number; yIndex: number; newValue: number }
    | { type: 'edit-batch'; senderId: string; symbolAddress: number; cells: Array<{x:number,y:number}>; operation: 'set'|'add'|'multiply'|'addPercent'; value: number }
    | { type: 'edit-write'; senderId: string; symbolAddress: number; cells: Array<{x:number,y:number,value:number}> }
    // Full buffer replacement (undo/redo, checksum fix, etc).
    | { type: 'buffer-replaced'; senderId: string; buffer: ArrayBuffer }
    // Selected symbol change so popouts can highlight or follow.
    | { type: 'symbol-selected'; senderId: string; symbolAddress: number | null };

// Module-level state.
let channel: BroadcastChannel | null = null;
const senderId = (() => {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return Math.random().toString(36).slice(2);
})();
let suppressBroadcast = false;
let mode: 'idle' | 'opener' | 'popout' = 'idle';

const ensureChannel = (): BroadcastChannel | null => {
    if (channel) return channel;
    if (typeof BroadcastChannel === 'undefined') return null;
    try { channel = new BroadcastChannel(CHANNEL_NAME); } catch { channel = null; }
    return channel;
};

/** Returns true if the action should broadcast (called by store mutations). */
export const shouldBroadcast = () => !suppressBroadcast && mode !== 'idle';

const post = (msg: SyncMessage) => {
    const ch = ensureChannel();
    if (!ch) return;
    try { ch.postMessage(msg); } catch (e) { console.warn('[popoutSync] postMessage failed:', e); }
};

/** Run a store mutation without it broadcasting (used when applying remote messages). */
const applyRemotely = (fn: () => void) => {
    suppressBroadcast = true;
    try { fn(); } finally { suppressBroadcast = false; }
};

/** Find a symbol by its flash start address (the cross-window stable identifier). */
const findSymbolByAddress = (address: number): SymbolHelper | undefined => {
    return useFileStore.getState().symbols.find(s => s.flashStartAddress === address);
};

// ---- Broadcast helpers, called by the store after a local mutation ----

export const broadcastSingleEdit = (symbol: SymbolHelper, xIndex: number, yIndex: number, newValue: number) => {
    if (!shouldBroadcast()) return;
    post({ type: 'edit-single', senderId, symbolAddress: symbol.flashStartAddress, xIndex, yIndex, newValue });
};

export const broadcastBatchEdit = (
    symbol: SymbolHelper,
    cells: Array<{x:number,y:number}>,
    operation: 'set'|'add'|'multiply'|'addPercent',
    value: number
) => {
    if (!shouldBroadcast()) return;
    post({ type: 'edit-batch', senderId, symbolAddress: symbol.flashStartAddress, cells, operation, value });
};

export const broadcastWriteCells = (symbol: SymbolHelper, cells: Array<{x:number,y:number,value:number}>) => {
    if (!shouldBroadcast()) return;
    post({ type: 'edit-write', senderId, symbolAddress: symbol.flashStartAddress, cells });
};

export const broadcastBufferReplaced = (buffer: ArrayBuffer) => {
    if (!shouldBroadcast()) return;
    // Clone the buffer so the channel transmits a stable snapshot (structured clone
    // already copies it, but cloning ourselves makes the intent explicit).
    post({ type: 'buffer-replaced', senderId, buffer: buffer.slice(0) });
};

export const broadcastSymbolSelected = (symbolAddress: number | null) => {
    if (!shouldBroadcast()) return;
    post({ type: 'symbol-selected', senderId, symbolAddress });
};

// ---- Message handlers ----

const sendStateSnapshot = (targetId: string) => {
    const s = useFileStore.getState();
    const payload: StateSnapshot | null = s.fileBuffer
        ? {
              buffer: s.fileBuffer.slice(0),
              fileName: s.fileName,
              fileType: s.fileType,
              symbols: s.symbols,
              codeBlocks: s.codeBlocks,
              axisHelpers: s.axisHelpers
          }
        : null;
    post({ type: 'state', senderId, targetId, payload });
};

const handleMessage = (ev: MessageEvent<SyncMessage>) => {
    const msg = ev.data;
    if (!msg || msg.senderId === senderId) return; // ignore our own broadcasts

    switch (msg.type) {
        case 'hello':
            // Any window that has state replies; the popout will accept the first
            // reply addressed to its id and ignore the rest.
            if (useFileStore.getState().fileBuffer) sendStateSnapshot(msg.senderId);
            break;

        case 'state': {
            if (mode !== 'popout' || msg.targetId !== senderId) return;
            const p = msg.payload;
            if (!p) return;
            applyRemotely(() => {
                useFileStore.setState({
                    fileBuffer: p.buffer,
                    fileName: p.fileName,
                    fileType: p.fileType,
                    symbols: p.symbols,
                    codeBlocks: p.codeBlocks,
                    axisHelpers: p.axisHelpers,
                    isParsing: false,
                    selectedSymbol: null,
                    checksumStatus: null,
                    checksumFixedCount: 0,
                    checksumMatchCount: 0,
                    undoStack: [],
                    redoStack: [],
                    isDirty: false
                });
            });
            break;
        }

        case 'edit-single': {
            const sym = findSymbolByAddress(msg.symbolAddress);
            if (!sym) return;
            applyRemotely(() => useFileStore.getState().updateMapData(sym, msg.xIndex, msg.yIndex, msg.newValue));
            break;
        }

        case 'edit-batch': {
            const sym = findSymbolByAddress(msg.symbolAddress);
            if (!sym) return;
            applyRemotely(() => useFileStore.getState().updateMapDataBatch(sym, msg.cells, msg.operation, msg.value));
            break;
        }

        case 'edit-write': {
            const sym = findSymbolByAddress(msg.symbolAddress);
            if (!sym) return;
            applyRemotely(() => useFileStore.getState().writeMapCells(sym, msg.cells));
            break;
        }

        case 'buffer-replaced': {
            applyRemotely(() => {
                useFileStore.setState({
                    fileBuffer: msg.buffer,
                    checksumStatus: 'Modified (Unverified)',
                    isDirty: true
                });
            });
            break;
        }

        case 'symbol-selected': {
            const sym = msg.symbolAddress === null ? null : (findSymbolByAddress(msg.symbolAddress) ?? null);
            applyRemotely(() => useFileStore.setState({ selectedSymbol: sym }));
            break;
        }
    }
};

/** Call once from the opener (the window that loaded the file). */
export const setupAsOpener = () => {
    mode = 'opener';
    const ch = ensureChannel();
    if (!ch) return;
    ch.addEventListener('message', handleMessage);
};

/**
 * Call once from a popout window. Sends `hello` to request the current state
 * from any peer that has one.
 */
export const setupAsPopout = () => {
    mode = 'popout';
    const ch = ensureChannel();
    if (!ch) return;
    ch.addEventListener('message', handleMessage);
    // Ask all peers for the latest state.
    post({ type: 'hello', senderId });
};

export const teardown = () => {
    const ch = channel;
    channel = null;
    mode = 'idle';
    try { ch?.close(); } catch { /* ignore */ }
};

/** Open a new browser window editing the given symbol. */
export const openPopoutWindow = (symbolAddress: number) => {
    const hex = symbolAddress.toString(16).toUpperCase();
    const url = new URL(window.location.href);
    // Keep the path, drop other query params, set only ?popout=<hex>.
    url.search = '';
    url.searchParams.set('popout', hex);
    const features = 'popup=yes,width=960,height=720,menubar=no,toolbar=no,location=no,status=no';
    const win = window.open(url.toString(), `edc-popout-${hex}`, features);
    win?.focus();
};
