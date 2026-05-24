import React, { useMemo, useState, useRef, useEffect } from 'react';
import { useFileStore } from '../store/useFileStore';
import { Folder, FileText, Map as MapIcon, Layers, AlertTriangle, ChevronRight, ChevronDown, Zap, Gauge, Settings, Disc, Rows3, Rows4 } from 'lucide-react';
import { SymbolHelper } from '../core/types';
import { Splitter } from './Splitter';

const SIDEBAR_MIN = 200;
const SIDEBAR_MAX = 640;
const SIDEBAR_DEFAULT = 280;

// Sub-component for a collapsible section
const CollapsibleSection: React.FC<{
    title: string;
    count: number;
    icon?: React.ComponentType<{ className?: string }>;
    defaultOpen?: boolean;
    children: React.ReactNode;
    colorClass?: string;
}> = ({ title, count, icon: Icon, defaultOpen = false, children, colorClass = "text-zinc-400" }) => {
    const [isOpen, setIsOpen] = useState(defaultOpen);

    if (count === 0) return null;

    return (
        <div className="mb-1">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wider hover:bg-zinc-900/50 rounded transition-colors"
            >
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {Icon && <Icon className={`w-3 h-3 ${colorClass}`} />}
                <span className="flex-1 text-left">{title}</span>
                <span className="bg-zinc-800 text-zinc-500 px-1.5 py-0.5 rounded text-[9px] font-mono">{count}</span>
            </button>

            {isOpen && (
                <div className="pl-2 mt-1 space-y-0.5">
                    {children}
                </div>
            )}
        </div>
    );
};

interface MapListProps {
    isOpen: boolean;
    onToggle: () => void;
}

export const MapList: React.FC<MapListProps> = ({ isOpen, onToggle }) => {
    const symbols = useFileStore((state) => state.symbols);
    const selectedSymbol = useFileStore((state) => state.selectedSymbol);
    const selectSymbol = useFileStore((state) => state.selectSymbol);
    const [searchTerm, setSearchTerm] = useState("");
    const [isCompact, setIsCompact] = useState(false);
    // Sidebar width is user-resizable (drag the right edge). Persisted across reloads
    // by the Splitter via localStorage.
    const [sidebarWidth, setSidebarWidth] = useState(SIDEBAR_DEFAULT);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const selectedItemRef = useRef<HTMLDivElement>(null);

    // "/" focuses the search box from anywhere (unless typing in another field).
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            const t = e.target as HTMLElement | null;
            const inField = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable));
            if (e.key === '/' && !inField && isOpen) {
                e.preventDefault();
                searchInputRef.current?.focus();
                searchInputRef.current?.select();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen]);

    // Scroll the selected item into view when the symbol changes (e.g. selected via chart click).
    useEffect(() => {
        if (selectedSymbol && selectedItemRef.current) {
            selectedItemRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
    }, [selectedSymbol]);

    // Process symbols: Group by Category -> Subcategory
    const processedData = useMemo(() => {
        // 1. Filter
        const filtered = symbols.filter(s =>
            s.varname.toLowerCase().includes(searchTerm.toLowerCase()) ||
            s.flashStartAddress.toString(16).includes(searchTerm.toLowerCase())
        );

        // 2. Structure
        const structure = {
            detected: {
                fuel: [] as SymbolHelper[],
                turbo: [] as SymbolHelper[],
                limiters: [] as SymbolHelper[],
                misc: [] as SymbolHelper[],
                switches: [] as SymbolHelper[],
                other: [] as SymbolHelper[],
            },
            potential: [] as SymbolHelper[]
        };

        filtered.forEach(sym => {
            if (sym.category === "Detected maps") {
                const sub = (sym.subcategory || "").toLowerCase();
                if (sub === "fuel") structure.detected.fuel.push(sym);
                else if (sub === "turbo") structure.detected.turbo.push(sym);
                else if (sub === "limiters") structure.detected.limiters.push(sym);
                else if (sub === "misc") structure.detected.misc.push(sym);
                else if (sub === "switches") structure.detected.switches.push(sym);
                else structure.detected.other.push(sym);
            } else {
                structure.potential.push(sym);
            }
        });

        // Natural alphanumeric sort: "EGR 01" before "EGR 02", "IQ limiter 1" before "IQ limiter 10"
        const naturalSort = (a: SymbolHelper, b: SymbolHelper) => {
            const aName = a.varname || a.flashStartAddress.toString(16);
            const bName = b.varname || b.flashStartAddress.toString(16);

            // Use localeCompare with numeric option for natural number sorting
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        };

        Object.values(structure.detected).forEach(list => list.sort(naturalSort));
        structure.potential.sort(naturalSort);

        return structure;
    }, [symbols, searchTerm]);

    const renderSymbolItem = (map: SymbolHelper) => {
        const isSelected = selectedSymbol?.flashStartAddress === map.flashStartAddress;
        let Icon = MapIcon;
        if (map.subcategory === "Limiters") Icon = AlertTriangle;
        if (map.subcategory === "Misc") Icon = Settings;
        if (map.subcategory === "Fuel") Icon = Disc; // Injection
        if (map.subcategory === "Turbo") Icon = Gauge;
        if (map.subcategory === "Switches") Icon = Zap;

        return (
            <div
                key={map.flashStartAddress}
                ref={isSelected ? selectedItemRef : null}
                onClick={() => selectSymbol(map)}
                className={`
                group flex items-center gap-2.5 ${isCompact ? 'px-2 py-1' : 'px-3 py-2'} rounded-md cursor-pointer text-sm transition-all duration-150
                ${isSelected
                        ? 'bg-blue-600 text-white shadow-md shadow-blue-900/20'
                        : 'text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100'
                    }
            `}
                title={map.varname}
            >
                <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isSelected ? 'text-blue-200' : 'text-zinc-600 group-hover:text-zinc-400'}`} />

                <div className="flex-1 min-w-0">
                    <div className="truncate font-medium leading-tight text-[13px]">
                        {map.varname || `Map @ ${map.flashStartAddress.toString(16).toUpperCase()}`}
                    </div>
                    {!isCompact && (
                        <div className={`text-[10px] mt-0.5 flex justify-between font-mono ${isSelected ? 'text-blue-200' : 'text-zinc-600 group-hover:text-zinc-500'}`}>
                            <span className="opacity-80">{map.flashStartAddress.toString(16).toUpperCase()}</span>
                            <span>{map.xAxisLength}x{map.yAxisLength}</span>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    // Toggle button component
    const ToggleButton = () => (
        <button
            onClick={onToggle}
            className="absolute -right-3 top-1/2 -translate-y-1/2 z-20 w-6 h-12 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-r-md flex items-center justify-center transition-colors duration-200 group"
            title={isOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
            <ChevronRight
                className={`w-4 h-4 text-zinc-400 group-hover:text-zinc-200 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
            />
        </button>
    );

    // Width is animated when collapsed/expanded but applied via inline style so
    // the user-resized value (Splitter) can also drive it.
    const widthStyle: React.CSSProperties = isOpen
        ? { width: sidebarWidth, transition: 'width 200ms ease-out' }
        : { width: 0, transition: 'width 200ms ease-out' };

    if (symbols.length === 0) {
        return (
            <div className="relative flex-shrink-0 flex" style={widthStyle}>
                <div
                    className={`h-full flex flex-col items-center justify-center text-zinc-500 p-6 border-r border-zinc-800 bg-zinc-900 overflow-hidden ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                    style={{ width: isOpen ? sidebarWidth : 0 }}
                >
                    <Layers className="w-12 h-12 mb-4 opacity-20" />
                    <p className="text-sm text-center whitespace-nowrap">No maps loaded.</p>
                </div>
                <ToggleButton />
            </div>
        );
    }

    return (
        <div className="relative flex-shrink-0 flex" style={widthStyle}>
            <div
                className={`h-full flex flex-col border-r border-zinc-800 bg-zinc-950 text-zinc-300 select-none overflow-hidden ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                style={{ width: isOpen ? sidebarWidth : 0 }}
            >
                {/* Header */}
                <div className="flex-shrink-0 px-3 py-3 border-b border-zinc-800 bg-zinc-900 sticky top-0 z-10 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2 font-semibold text-zinc-100 text-sm whitespace-nowrap">
                            <Layers className="w-4 h-4 text-blue-500" />
                            <span>Map Selector</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <button
                                onClick={() => setIsCompact(c => !c)}
                                className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
                                title={isCompact ? "Show details" : "Compact view"}
                            >
                                {isCompact ? <Rows4 className="w-3.5 h-3.5" /> : <Rows3 className="w-3.5 h-3.5" />}
                            </button>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-400 font-mono border border-zinc-700">
                                {symbols.length}
                            </span>
                        </div>
                    </div>
                    <div className="relative">
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="Search maps…"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 pr-7 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/50 transition-colors"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                        {!searchTerm && (
                            <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] px-1 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-500 font-mono">
                                /
                            </kbd>
                        )}
                    </div>
                </div>

                {/* Scrollable List */}
                <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">

                    <CollapsibleSection title="Detected Maps" count={Object.values(processedData.detected).flat().length} icon={Folder} defaultOpen={true} colorClass="text-blue-500">
                        <CollapsibleSection title="Turbo" count={processedData.detected.turbo.length} icon={Gauge} defaultOpen={true}>
                            {processedData.detected.turbo.map(renderSymbolItem)}
                        </CollapsibleSection>

                        <CollapsibleSection title="Fuel" count={processedData.detected.fuel.length} icon={Disc} defaultOpen={true}>
                            {processedData.detected.fuel.map(renderSymbolItem)}
                        </CollapsibleSection>

                        <CollapsibleSection title="Limiters" count={processedData.detected.limiters.length} icon={AlertTriangle} defaultOpen={true}>
                            {processedData.detected.limiters.map(renderSymbolItem)}
                        </CollapsibleSection>

                        <CollapsibleSection title="Switches" count={processedData.detected.switches.length} icon={Zap}>
                            {processedData.detected.switches.map(renderSymbolItem)}
                        </CollapsibleSection>

                        <CollapsibleSection title="Misc" count={processedData.detected.misc.length} icon={Settings}>
                            {processedData.detected.misc.map(renderSymbolItem)}
                        </CollapsibleSection>

                        <CollapsibleSection title="Other" count={processedData.detected.other.length} icon={FileText}>
                            {processedData.detected.other.map(renderSymbolItem)}
                        </CollapsibleSection>
                    </CollapsibleSection>

                    <CollapsibleSection title="Unknown Maps" count={processedData.potential.length} icon={Layers} defaultOpen={false} colorClass="text-yellow-600">
                        {processedData.potential.map(renderSymbolItem)}
                    </CollapsibleSection>

                </div>
            </div>

            {/* Width-resize handle — only shown when sidebar is open. */}
            {isOpen && (
                <Splitter
                    orientation="vertical"
                    target="before"
                    initialSize={sidebarWidth}
                    minSize={SIDEBAR_MIN}
                    maxSize={SIDEBAR_MAX}
                    onResize={setSidebarWidth}
                    storageKey="edc.sidebarWidth"
                />
            )}

            <ToggleButton />
        </div>
    );
};
