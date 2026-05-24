"use client";

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { SymbolHelper } from '../core/types';
import { Tools } from '../core/tools';
import { useFileStore } from '../store/useFileStore';
import { getColorForValue, getTextColorForBackground } from '../utils/colorUtils';
import { SelectionToolbar } from './SelectionToolbar';

interface MapEditorProps {
    symbol: SymbolHelper;
    fileBuffer: ArrayBuffer;
    // When true, the editor owns global keyboard shortcuts (arrows, F2, type-to-edit,
    // Ctrl+Z/Y, Ctrl+C/V, Ctrl+A). Set to false for embedded views where the host
    // wants to manage shortcuts itself (e.g. modal with its own Esc handling).
    captureGlobalShortcuts?: boolean;
    // Compact mode shrinks padding & font for inline view; popup uses normal.
    dense?: boolean;
}

interface CellCoord { x: number; y: number; }
// `prefillFromType` distinguishes:
//   - true:  user started typing a digit on a selected cell. Value starts with that
//            single character and the input cursor sits AFTER it so subsequent
//            keystrokes append (typing "54" produces "54", not "4").
//   - false: F2 / Enter / double-click on the cell. Value is the existing cell
//            display value with everything selected so the user can overwrite in
//            one keystroke (standard spreadsheet behaviour).
interface EditState { x: number; y: number; value: string; prefillFromType: boolean; }
interface Clipboard {
    width: number;
    height: number;
    cells: number[][]; // display-space values
}

const cellKey = (x: number, y: number) => `${x},${y}`;
const parseKey = (key: string): CellCoord => {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
};

// Format a value with the given correction/offset for axis or cell display.
const formatValue = (val: number, factor: number | undefined, offset: number | undefined): string => {
    const f = factor ?? 1;
    const o = offset ?? 0;
    const real = val * f + o;
    return parseFloat(real.toFixed(3)).toString();
};

// Detect maps where display should be a 0..100 colour-scale (percent / duty cycle).
const isPercentMap = (symbol: SymbolHelper) =>
    (symbol.zAxisDescr || "").includes("%") || (symbol.xaxisUnits || "").includes("Duty cycle");

const isDegreeMap = (symbol: SymbolHelper) => {
    const d = (symbol.zAxisDescr || "").toLowerCase();
    return d.includes("degrees") || d.includes("btdc") || d.includes("deg ") || d.includes("deg)") || d.includes("°");
};

export const MapEditor: React.FC<MapEditorProps> = ({
    symbol,
    fileBuffer,
    captureGlobalShortcuts = true,
    dense = false
}) => {
    const updateMapData = useFileStore(s => s.updateMapData);
    const updateMapDataBatch = useFileStore(s => s.updateMapDataBatch);
    const writeMapCells = useFileStore(s => s.writeMapCells);
    const undo = useFileStore(s => s.undo);
    const redo = useFileStore(s => s.redo);

    // ------- Derived map data (raw uint16 cells, already sign-decoded) -------
    const { x, y, z, zMin, zMax } = useMemo(() => {
        if (!fileBuffer || !symbol) return { x: [], y: [], z: [], zMin: 0, zMax: 0 };
        const data = Tools.readMapData(fileBuffer, symbol);
        let min = Number.POSITIVE_INFINITY;
        let max = Number.NEGATIVE_INFINITY;
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        data.z.forEach(row => row.forEach(v => {
            const r = v * factor + off;
            if (r < min) min = r;
            if (r > max) max = r;
        }));
        return { ...data, zMin: min, zMax: max };
    }, [fileBuffer, symbol]);

    const isPct = useMemo(() => isPercentMap(symbol), [symbol]);
    const isDeg = useMemo(() => isDegreeMap(symbol), [symbol]);

    // ------- Selection / edit state -------
    // activeCell is the "focused" cell (keyboard caret). Always within bounds when grid non-empty.
    const [activeCell, setActiveCell] = useState<CellCoord>({ x: 0, y: 0 });
    const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
    const [selectionAnchor, setSelectionAnchor] = useState<CellCoord | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [editCell, setEditCell] = useState<EditState | null>(null);
    const [clipboard, setClipboard] = useState<Clipboard | null>(null);

    const inputRef = useRef<HTMLInputElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const cellRefs = useRef<Map<string, HTMLTableCellElement>>(new Map());

    // ------- Reset state when the map changes -------
    useEffect(() => {
        setSelectedCells(new Set());
        setSelectionAnchor(null);
        setEditCell(null);
        setActiveCell({ x: 0, y: 0 });
        // Clear cell refs from previous map
        cellRefs.current = new Map();
    }, [symbol]);

    // Clamp active cell when the grid resizes.
    useEffect(() => {
        if (x.length === 0 || y.length === 0) return;
        setActiveCell(c => ({
            x: Math.min(c.x, x.length - 1),
            y: Math.min(c.y, y.length - 1)
        }));
    }, [x.length, y.length]);

    // ------- Selection helpers -------
    const getCellsInRange = useCallback((start: CellCoord, end: CellCoord): Set<string> => {
        const cells = new Set<string>();
        const minX = Math.min(start.x, end.x);
        const maxX = Math.max(start.x, end.x);
        const minY = Math.min(start.y, end.y);
        const maxY = Math.max(start.y, end.y);
        for (let yi = minY; yi <= maxY; yi++) {
            for (let xi = minX; xi <= maxX; xi++) cells.add(cellKey(xi, yi));
        }
        return cells;
    }, []);

    const getSelectedArray = useCallback((): CellCoord[] => {
        if (selectedCells.size > 0) return Array.from(selectedCells).map(parseKey);
        // If nothing selected, treat the active cell as a single-cell selection.
        return [{ ...activeCell }];
    }, [selectedCells, activeCell]);

    // Live stats over the current selection (post-correction).
    const stats = useMemo(() => {
        const cells = getSelectedArray();
        if (cells.length === 0) return null;
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        let min = Number.POSITIVE_INFINITY, max = Number.NEGATIVE_INFINITY, sum = 0;
        for (const c of cells) {
            const raw = z[c.y]?.[c.x] ?? 0;
            const real = raw * factor + off;
            if (real < min) min = real;
            if (real > max) max = real;
            sum += real;
        }
        return { min, max, avg: sum / cells.length, sum };
    }, [getSelectedArray, z, symbol]);

    // ------- Edit lifecycle -------
    const beginEditAt = useCallback((cx: number, cy: number, prefilled?: string) => {
        const raw = z[cy]?.[cx] ?? 0;
        const value = prefilled !== undefined ? prefilled : formatValue(raw, symbol.correction, symbol.offset);
        setEditCell({ x: cx, y: cy, value, prefillFromType: prefilled !== undefined });
        setActiveCell({ x: cx, y: cy });
        // Don't keep multi-selection visible while editing — keeps focus clear.
        setSelectedCells(new Set([cellKey(cx, cy)]));
    }, [z, symbol]);

    const commitEdit = useCallback((moveDx = 0, moveDy = 0) => {
        if (!editCell) return;
        const num = parseFloat(editCell.value);
        if (!isNaN(num)) updateMapData(symbol, editCell.x, editCell.y, num);
        setEditCell(null);
        if (moveDx !== 0 || moveDy !== 0) {
            const nx = Math.max(0, Math.min(x.length - 1, editCell.x + moveDx));
            const ny = Math.max(0, Math.min(y.length - 1, editCell.y + moveDy));
            setActiveCell({ x: nx, y: ny });
            setSelectedCells(new Set([cellKey(nx, ny)]));
            setSelectionAnchor({ x: nx, y: ny });
        }
    }, [editCell, symbol, updateMapData, x.length, y.length]);

    const cancelEdit = useCallback(() => setEditCell(null), []);

    // Focus the input when edit starts. Done after render so the cell is in the DOM.
    // - Type-to-edit (prefillFromType): cursor at end, no selection, so the next
    //   keystroke appends instead of replacing the just-typed character.
    // - F2 / Enter / double-click: select all so a fresh value can be typed in one go.
    useEffect(() => {
        const input = inputRef.current;
        if (!editCell || !input) return;
        input.focus();
        if (editCell.prefillFromType) {
            const end = input.value.length;
            input.setSelectionRange(end, end);
        } else {
            input.select();
        }
    }, [editCell]);

    // Scroll the active cell into view when it moves via keyboard.
    useEffect(() => {
        const el = cellRefs.current.get(cellKey(activeCell.x, activeCell.y));
        el?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }, [activeCell]);

    // ------- Mouse interactions -------
    const handleCellMouseDown = (cx: number, cy: number, e: React.MouseEvent) => {
        // Don't trap clicks inside an active edit input.
        if (editCell && editCell.x === cx && editCell.y === cy) return;
        e.preventDefault();
        // Commit any in-progress edit before changing selection.
        if (editCell) commitEdit();

        const key = cellKey(cx, cy);

        if (e.ctrlKey || e.metaKey) {
            // Toggle cell in selection.
            const next = new Set(selectedCells);
            next.has(key) ? next.delete(key) : next.add(key);
            setSelectedCells(next);
            setSelectionAnchor({ x: cx, y: cy });
            setActiveCell({ x: cx, y: cy });
            return;
        }

        if (e.shiftKey && selectionAnchor) {
            setSelectedCells(getCellsInRange(selectionAnchor, { x: cx, y: cy }));
            setActiveCell({ x: cx, y: cy });
            return;
        }

        // Plain click: set active cell, start a (potential) drag selection.
        setSelectedCells(new Set([key]));
        setSelectionAnchor({ x: cx, y: cy });
        setActiveCell({ x: cx, y: cy });
        setIsDragging(true);
    };

    const handleCellMouseEnter = (cx: number, cy: number) => {
        if (isDragging && selectionAnchor) {
            setSelectedCells(getCellsInRange(selectionAnchor, { x: cx, y: cy }));
            setActiveCell({ x: cx, y: cy });
        }
    };

    const handleCellDoubleClick = (cx: number, cy: number) => {
        beginEditAt(cx, cy);
    };

    // Mouseup releases drag (window-level so dragging outside grid still ends).
    useEffect(() => {
        const onUp = () => setIsDragging(false);
        window.addEventListener('mouseup', onUp);
        return () => window.removeEventListener('mouseup', onUp);
    }, []);

    // ------- Batch operations -------
    const handleBatchApply = useCallback((op: 'set' | 'add' | 'multiply' | 'addPercent', value: number) => {
        const cells = getSelectedArray();
        if (cells.length === 0) return;
        updateMapDataBatch(symbol, cells, op, value);
    }, [getSelectedArray, symbol, updateMapDataBatch]);

    // Smooth: each selected cell becomes the average of itself + its 4 neighbours (clamped).
    // Reads the ORIGINAL grid (z) so all selected cells update from the same base, which is
    // how most tuning tools behave — otherwise edits would propagate.
    const handleSmooth = useCallback(() => {
        const cells = getSelectedArray();
        if (cells.length < 4) return;
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        const real = (cx: number, cy: number) => (z[cy]?.[cx] ?? 0) * factor + off;
        const W = x.length, H = y.length;
        const out: Array<{ x: number, y: number, value: number }> = [];
        for (const c of cells) {
            let sum = real(c.x, c.y);
            let n = 1;
            if (c.x > 0)     { sum += real(c.x - 1, c.y); n++; }
            if (c.x < W - 1) { sum += real(c.x + 1, c.y); n++; }
            if (c.y > 0)     { sum += real(c.x, c.y - 1); n++; }
            if (c.y < H - 1) { sum += real(c.x, c.y + 1); n++; }
            out.push({ x: c.x, y: c.y, value: sum / n });
        }
        writeMapCells(symbol, out);
    }, [getSelectedArray, z, symbol, writeMapCells, x.length, y.length]);

    // Linear interpolate along X within each row of the selection's bounding box,
    // anchored to the left-most and right-most selected cell of that row.
    const handleInterpolateX = useCallback(() => {
        const cells = getSelectedArray();
        if (cells.length < 2) return;
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        const real = (cx: number, cy: number) => (z[cy]?.[cx] ?? 0) * factor + off;
        // Group by y, find min/max x in each row.
        const rows = new Map<number, number[]>();
        cells.forEach(c => {
            const arr = rows.get(c.y) ?? [];
            arr.push(c.x);
            rows.set(c.y, arr);
        });
        const out: Array<{ x: number, y: number, value: number }> = [];
        rows.forEach((xs, yi) => {
            const xMin = Math.min(...xs);
            const xMax = Math.max(...xs);
            if (xMax === xMin) return;
            const vMin = real(xMin, yi);
            const vMax = real(xMax, yi);
            for (let xi = xMin; xi <= xMax; xi++) {
                const t = (xi - xMin) / (xMax - xMin);
                out.push({ x: xi, y: yi, value: vMin + (vMax - vMin) * t });
            }
        });
        writeMapCells(symbol, out);
    }, [getSelectedArray, z, symbol, writeMapCells]);

    // Same as InterpolateX but column-wise.
    const handleInterpolateY = useCallback(() => {
        const cells = getSelectedArray();
        if (cells.length < 2) return;
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        const real = (cx: number, cy: number) => (z[cy]?.[cx] ?? 0) * factor + off;
        const cols = new Map<number, number[]>();
        cells.forEach(c => {
            const arr = cols.get(c.x) ?? [];
            arr.push(c.y);
            cols.set(c.x, arr);
        });
        const out: Array<{ x: number, y: number, value: number }> = [];
        cols.forEach((ys, xi) => {
            const yMin = Math.min(...ys);
            const yMax = Math.max(...ys);
            if (yMax === yMin) return;
            const vMin = real(xi, yMin);
            const vMax = real(xi, yMax);
            for (let yi = yMin; yi <= yMax; yi++) {
                const t = (yi - yMin) / (yMax - yMin);
                out.push({ x: xi, y: yi, value: vMin + (vMax - vMin) * t });
            }
        });
        writeMapCells(symbol, out);
    }, [getSelectedArray, z, symbol, writeMapCells]);

    // Copy: rectangular bounding box of the selection, in display values.
    const handleCopy = useCallback(() => {
        const cells = getSelectedArray();
        if (cells.length === 0) return;
        const xs = cells.map(c => c.x);
        const ys = cells.map(c => c.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs);
        const y0 = Math.min(...ys), y1 = Math.max(...ys);
        const factor = symbol.correction || 1;
        const off = symbol.offset || 0;
        const grid: number[][] = [];
        for (let yi = y0; yi <= y1; yi++) {
            const row: number[] = [];
            for (let xi = x0; xi <= x1; xi++) {
                const raw = z[yi]?.[xi] ?? 0;
                row.push(raw * factor + off);
            }
            grid.push(row);
        }
        setClipboard({ width: x1 - x0 + 1, height: y1 - y0 + 1, cells: grid });
    }, [getSelectedArray, z, symbol]);

    // Paste: top-left = active cell, clamp to grid bounds.
    const handlePaste = useCallback(() => {
        if (!clipboard) return;
        const out: Array<{ x: number, y: number, value: number }> = [];
        for (let dy = 0; dy < clipboard.height; dy++) {
            const ty = activeCell.y + dy;
            if (ty >= y.length) break;
            for (let dx = 0; dx < clipboard.width; dx++) {
                const tx = activeCell.x + dx;
                if (tx >= x.length) break;
                out.push({ x: tx, y: ty, value: clipboard.cells[dy][dx] });
            }
        }
        if (out.length > 0) writeMapCells(symbol, out);
    }, [clipboard, activeCell, x.length, y.length, symbol, writeMapCells]);

    // ------- Global keyboard handler -------
    useEffect(() => {
        if (!captureGlobalShortcuts) return;
        if (x.length === 0 || y.length === 0) return;

        const onKey = (e: KeyboardEvent) => {
            // If a non-cell input is focused (search box etc.) don't hijack keys.
            const t = e.target as HTMLElement | null;
            const editingHere = !!(t && (t === inputRef.current));
            const inOtherInput = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) && !editingHere);
            if (inOtherInput) return;

            const meta = e.ctrlKey || e.metaKey;

            // Undo / Redo — always available.
            if (meta && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                if (e.shiftKey) redo(); else undo();
                return;
            }
            if (meta && (e.key === 'y' || e.key === 'Y')) {
                e.preventDefault();
                redo();
                return;
            }

            // While editing a cell, scope keys are handled by the input below.
            if (editCell) return;

            // Select all.
            if (meta && (e.key === 'a' || e.key === 'A')) {
                e.preventDefault();
                const all = new Set<string>();
                for (let yi = 0; yi < y.length; yi++)
                    for (let xi = 0; xi < x.length; xi++) all.add(cellKey(xi, yi));
                setSelectedCells(all);
                return;
            }

            // Copy / Paste.
            if (meta && (e.key === 'c' || e.key === 'C')) { e.preventDefault(); handleCopy(); return; }
            if (meta && (e.key === 'v' || e.key === 'V')) { e.preventDefault(); handlePaste(); return; }

            // Escape: clear selection.
            if (e.key === 'Escape') {
                if (selectedCells.size > 0) {
                    setSelectedCells(new Set());
                    setSelectionAnchor(null);
                }
                return;
            }

            // F2: edit active cell.
            if (e.key === 'F2') {
                e.preventDefault();
                beginEditAt(activeCell.x, activeCell.y);
                return;
            }

            // Enter: edit active cell.
            if (e.key === 'Enter') {
                e.preventDefault();
                beginEditAt(activeCell.x, activeCell.y);
                return;
            }

            // Delete: zero out selected cells.
            if (e.key === 'Delete' || e.key === 'Backspace') {
                const cells = getSelectedArray();
                if (cells.length > 0) {
                    e.preventDefault();
                    updateMapDataBatch(symbol, cells, 'set', 0);
                }
                return;
            }

            // Arrow navigation: with Shift extends selection, without resets.
            const arrows: Record<string, [number, number]> = {
                ArrowLeft:  [-1, 0],
                ArrowRight: [ 1, 0],
                ArrowUp:    [ 0, -1],
                ArrowDown:  [ 0, 1],
            };
            if (arrows[e.key]) {
                e.preventDefault();
                const [dx, dy] = arrows[e.key];
                const nx = Math.max(0, Math.min(x.length - 1, activeCell.x + dx));
                const ny = Math.max(0, Math.min(y.length - 1, activeCell.y + dy));
                if (e.shiftKey) {
                    const anchor = selectionAnchor ?? activeCell;
                    if (!selectionAnchor) setSelectionAnchor(anchor);
                    setSelectedCells(getCellsInRange(anchor, { x: nx, y: ny }));
                } else {
                    setSelectedCells(new Set([cellKey(nx, ny)]));
                    setSelectionAnchor({ x: nx, y: ny });
                }
                setActiveCell({ x: nx, y: ny });
                return;
            }

            // Home / End — jump within the active row.
            if (e.key === 'Home') {
                e.preventDefault();
                setActiveCell({ x: 0, y: activeCell.y });
                setSelectedCells(new Set([cellKey(0, activeCell.y)]));
                setSelectionAnchor({ x: 0, y: activeCell.y });
                return;
            }
            if (e.key === 'End') {
                e.preventDefault();
                const nx = x.length - 1;
                setActiveCell({ x: nx, y: activeCell.y });
                setSelectedCells(new Set([cellKey(nx, activeCell.y)]));
                setSelectionAnchor({ x: nx, y: activeCell.y });
                return;
            }

            // Type-to-edit: digit, period, minus, or a sign starts editing with that char.
            // Single-char alphanumerics also work for non-numeric maps.
            if (e.key.length === 1 && !meta && !e.altKey) {
                const ch = e.key;
                if (/^[0-9.+\-]$/.test(ch)) {
                    e.preventDefault();
                    beginEditAt(activeCell.x, activeCell.y, ch);
                }
            }
        };

        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [
        captureGlobalShortcuts, x.length, y.length, editCell, activeCell, selectedCells,
        selectionAnchor, undo, redo, beginEditAt, getCellsInRange, getSelectedArray,
        handleCopy, handlePaste, symbol, updateMapDataBatch
    ]);

    // Edit-input key handler: Enter commits + moves down, Tab right, Esc cancels.
    const handleEditKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            commitEdit(0, e.shiftKey ? -1 : 1);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            commitEdit(e.shiftKey ? -1 : 1, 0);
        } else if (e.key === 'Escape') {
            e.preventDefault();
            cancelEdit();
        }
        // Stop bubbling so global handler doesn't double-process.
        e.stopPropagation();
    };

    // ------- Render -------
    if (!symbol || !fileBuffer || x.length === 0 || y.length === 0) {
        return <div className="p-6 text-zinc-500 text-center">No map data available.</div>;
    }

    const hasSelection = selectedCells.size > 0 && !editCell;
    const cellPad = dense ? 'py-1.5 px-1' : 'py-2 px-1.5';
    const minColWidth = dense ? 'min-w-[60px]' : 'min-w-[70px]';
    const fontSize = dense ? 'text-xs' : 'text-[13px]';

    return (
        <div
            ref={containerRef}
            className={`flex flex-col h-full w-full overflow-hidden bg-zinc-950 text-zinc-300 ${fontSize} font-mono`}
            tabIndex={0}
        >
            {/* Selection toolbar (always present when there's any selection) */}
            {hasSelection && (
                <SelectionToolbar
                    selectedCount={selectedCells.size}
                    stats={stats}
                    onApply={handleBatchApply}
                    onSmooth={handleSmooth}
                    onInterpolateX={handleInterpolateX}
                    onInterpolateY={handleInterpolateY}
                    onCopy={handleCopy}
                    onPaste={handlePaste}
                    canPaste={!!clipboard}
                    onClear={() => { setSelectedCells(new Set()); setSelectionAnchor(null); }}
                />
            )}

            {/* Data grid */}
            <div className="flex-1 overflow-auto relative custom-scrollbar">
                <table className="w-max border-separate border-spacing-0">
                    <thead className="sticky top-0 z-20 shadow-sm">
                        <tr>
                            <th className={`sticky left-0 z-30 ${cellPad} ${minColWidth} bg-zinc-900 border-r border-b border-zinc-800 text-zinc-500 font-normal text-[10px] uppercase tracking-wider`}>
                                <div className="flex items-center justify-between gap-1">
                                    <span className="text-green-500/70">Y</span>
                                    <span className="text-zinc-700">/</span>
                                    <span className="text-blue-400/70">X</span>
                                </div>
                            </th>
                            {x.map((val, idx) => (
                                <th
                                    key={`x-${idx}`}
                                    className={`${cellPad} ${minColWidth} bg-zinc-900 border-b border-r border-zinc-800 text-blue-300 font-medium ${idx === activeCell.x ? 'bg-blue-950/40' : ''}`}
                                >
                                    {formatValue(val, symbol.xAxisCorrection, symbol.xAxisOffset)}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {y.map((yVal, yIdx) => (
                            <tr key={`y-${yIdx}`} className="group">
                                <th className={`sticky left-0 z-10 ${cellPad} bg-zinc-900 border-r border-b border-zinc-800 text-green-300 font-medium ${yIdx === activeCell.y ? 'bg-green-950/40' : 'group-hover:bg-zinc-800'} transition-colors`}>
                                    {formatValue(yVal, symbol.yAxisCorrection, symbol.yAxisOffset)}
                                </th>

                                {z[yIdx]?.map((zVal, xIdx) => {
                                    const isEditing = editCell?.x === xIdx && editCell?.y === yIdx;
                                    const isSelected = selectedCells.has(cellKey(xIdx, yIdx));
                                    const isActive = activeCell.x === xIdx && activeCell.y === yIdx;
                                    const real = zVal * (symbol.correction || 1) + (symbol.offset || 0);

                                    const rangeMin = isPct ? 0 : zMin;
                                    const rangeMax = isPct ? 100 : zMax;
                                    const bg = getColorForValue(real, rangeMin, rangeMax);
                                    const fg = getTextColorForBackground(real, rangeMin, rangeMax);

                                    const key = cellKey(xIdx, yIdx);
                                    return (
                                        <td
                                            key={`z-${yIdx}-${xIdx}`}
                                            ref={(el) => {
                                                if (el) cellRefs.current.set(key, el);
                                                else cellRefs.current.delete(key);
                                            }}
                                            style={{
                                                backgroundColor: !isEditing ? bg : undefined,
                                                color: !isEditing ? fg : undefined
                                            }}
                                            className={`
                                                p-0 border-r border-b ${minColWidth} relative select-none
                                                ${!isEditing ? 'cursor-cell transition-colors opacity-95 hover:opacity-100' : ''}
                                                ${isEditing ? 'bg-zinc-800' : ''}
                                                ${isSelected && !isEditing ? 'ring-2 ring-blue-400 ring-inset z-10' : 'border-zinc-800/40'}
                                                ${isActive && !isEditing ? 'outline outline-2 outline-amber-400 outline-offset-[-2px] z-20' : ''}
                                            `}
                                            onMouseDown={(e) => handleCellMouseDown(xIdx, yIdx, e)}
                                            onMouseEnter={() => handleCellMouseEnter(xIdx, yIdx)}
                                            onDoubleClick={() => handleCellDoubleClick(xIdx, yIdx)}
                                        >
                                            {isEditing ? (
                                                <input
                                                    ref={inputRef}
                                                    type="text"
                                                    inputMode="decimal"
                                                    className="absolute inset-0 w-full h-full bg-zinc-800 text-zinc-100 text-center outline-none border-2 border-amber-400 font-mono"
                                                    value={editCell!.value}
                                                    onChange={(e) => setEditCell(prev => prev ? { ...prev, value: e.target.value } : prev)}
                                                    onBlur={() => commitEdit()}
                                                    onKeyDown={handleEditKeyDown}
                                                />
                                            ) : (
                                                <div className={`${cellPad} text-center font-medium tabular-nums`}>
                                                    {formatValue(zVal, symbol.correction, symbol.offset)}
                                                    {isPct && <span className="opacity-50 text-[10px] ml-0.5">%</span>}
                                                    {isDeg && !isPct && <span className="opacity-50 text-[10px] ml-0.5">°</span>}
                                                </div>
                                            )}
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Hint bar */}
            <div className="flex-shrink-0 px-3 py-1.5 bg-zinc-900/60 border-t border-zinc-800 flex justify-between items-center text-[10px] text-zinc-500">
                <span className="flex items-center gap-3 flex-wrap">
                    <span><kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">↑↓←→</kbd> move</span>
                    <span><kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">Shift</kbd>+arrows: extend</span>
                    <span><kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">Enter</kbd>/<kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">F2</kbd> edit</span>
                    <span>type to overwrite</span>
                    <span><kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">Ctrl+Z</kbd> undo</span>
                    <span><kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">Ctrl+C</kbd>/<kbd className="px-1 rounded bg-zinc-800 border border-zinc-700">V</kbd> copy/paste</span>
                </span>
                <span className="font-mono">
                    cell [{activeCell.x}, {activeCell.y}] · factor {symbol.correction} · offset {symbol.offset}
                </span>
            </div>
        </div>
    );
};
