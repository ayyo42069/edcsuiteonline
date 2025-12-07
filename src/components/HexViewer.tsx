import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { useFileStore } from '@/src/store/useFileStore';
import { SymbolHelper } from '@/src/core/types';
import { Folder, FileText, Map as MapIcon, Layers, AlertTriangle, ChevronRight, ChevronDown, Zap, Gauge, Settings, Disc } from 'lucide-react';

interface HexViewerProps {
    data: Uint8Array;
    onSwitchToMapView?: () => void;
}

interface MapRegion {
    startAddress: number;
    endAddress: number;
    symbol: SymbolHelper;
    color: string;
}

const ROW_SIZE = 16;

// Subcategory-specific colors for hex view highlighting
const SUBCATEGORY_COLORS: Record<string, { bg: string; border: string; text: string }> = {
    'turbo': { bg: 'bg-cyan-500/20', border: 'border-l-2 border-cyan-500', text: 'text-cyan-400' },
    'fuel': { bg: 'bg-orange-500/20', border: 'border-l-2 border-orange-500', text: 'text-orange-400' },
    'limiters': { bg: 'bg-red-500/20', border: 'border-l-2 border-red-500', text: 'text-red-400' },
    'switches': { bg: 'bg-yellow-500/20', border: 'border-l-2 border-yellow-500', text: 'text-yellow-400' },
    'misc': { bg: 'bg-purple-500/20', border: 'border-l-2 border-purple-500', text: 'text-purple-400' },
    'launch control': { bg: 'bg-pink-500/20', border: 'border-l-2 border-pink-500', text: 'text-pink-400' },
    'other': { bg: 'bg-blue-500/20', border: 'border-l-2 border-blue-500', text: 'text-blue-400' },
    'potential': { bg: 'bg-zinc-500/20', border: 'border-l-2 border-zinc-500', text: 'text-zinc-400' },
};

// Helper to get color for a symbol based on its subcategory
const getSubcategoryColor = (symbol: SymbolHelper): { bg: string; border: string; text: string } => {
    if (symbol.category !== "Detected maps") {
        return SUBCATEGORY_COLORS['potential'];
    }
    const sub = (symbol.subcategory || "").toLowerCase();
    return SUBCATEGORY_COLORS[sub] || SUBCATEGORY_COLORS['other'];
};

// Collapsible Section component for the sidebar
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
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-bold text-zinc-500 uppercase tracking-wider hover:bg-zinc-700/50 rounded transition-colors"
            >
                {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                {Icon && <Icon className={`w-3 h-3 ${colorClass}`} />}
                <span className="flex-1 text-left">{title}</span>
                <span className="bg-zinc-700 text-zinc-400 px-1.5 py-0.5 rounded text-[9px] font-mono">{count}</span>
            </button>

            {isOpen && (
                <div className="pl-2 mt-1 space-y-0.5">
                    {children}
                </div>
            )}
        </div>
    );
};

export const HexViewer: React.FC<HexViewerProps> = ({ data, onSwitchToMapView }) => {
    const symbols = useFileStore((state) => state.symbols);
    const fileBuffer = useFileStore((state) => state.fileBuffer);
    const selectSymbol = useFileStore((state) => state.selectSymbol);

    const virtuosoRef = useRef<VirtuosoHandle>(null);

    // Editing state
    const [editingAddress, setEditingAddress] = useState<number | null>(null);
    const [editValue, setEditValue] = useState<string>('');
    const [currentSymbol, setCurrentSymbol] = useState<string>('No symbol');
    const [cursorAddress, setCursorAddress] = useState<number>(0);
    const [searchAddress, setSearchAddress] = useState<string>('');
    const [selectedMapAddress, setSelectedMapAddress] = useState<number | null>(null);

    // Mutable ref for tracking the buffer for edits
    const dataRef = useRef<Uint8Array>(data);
    useEffect(() => {
        dataRef.current = data;
    }, [data]);

    const rowCount = Math.ceil(data.length / ROW_SIZE);

    // Build map regions from symbols
    const mapRegions = useMemo<MapRegion[]>(() => {
        return symbols
            .filter(s => s.flashStartAddress > 0 && s.length > 0)
            .map((symbol) => {
                const colors = getSubcategoryColor(symbol);
                return {
                    startAddress: symbol.flashStartAddress,
                    endAddress: symbol.flashStartAddress + symbol.length - 1,
                    symbol,
                    color: `${colors.bg} ${colors.border}`
                };
            })
            .sort((a, b) => a.startAddress - b.startAddress);
    }, [symbols]);

    // Group symbols by category and subcategory (like MapList)
    const groupedMaps = useMemo(() => {
        const structure = {
            detected: {
                fuel: [] as MapRegion[],
                turbo: [] as MapRegion[],
                limiters: [] as MapRegion[],
                misc: [] as MapRegion[],
                switches: [] as MapRegion[],
                launchControl: [] as MapRegion[],
                other: [] as MapRegion[],
            },
            potential: [] as MapRegion[]
        };

        mapRegions.forEach(region => {
            const sym = region.symbol;
            if (sym.category === "Detected maps") {
                const sub = (sym.subcategory || "").toLowerCase();
                if (sub === "fuel") structure.detected.fuel.push(region);
                else if (sub === "turbo") structure.detected.turbo.push(region);
                else if (sub === "limiters") structure.detected.limiters.push(region);
                else if (sub === "misc") structure.detected.misc.push(region);
                else if (sub === "switches") structure.detected.switches.push(region);
                else if (sub === "launch control") structure.detected.launchControl.push(region);
                else structure.detected.other.push(region);
            } else {
                structure.potential.push(region);
            }
        });

        // Natural alphanumeric sort
        const naturalSort = (a: MapRegion, b: MapRegion) => {
            const aName = a.symbol.varname || a.startAddress.toString(16);
            const bName = b.symbol.varname || b.startAddress.toString(16);
            return aName.localeCompare(bName, undefined, { numeric: true, sensitivity: 'base' });
        };

        Object.values(structure.detected).forEach(list => list.sort(naturalSort));
        structure.potential.sort(naturalSort);

        return structure;
    }, [mapRegions]);

    // Find which symbol contains a given address
    const findSymbolAtAddress = useCallback((address: number): SymbolHelper | null => {
        for (const region of mapRegions) {
            if (address >= region.startAddress && address <= region.endAddress) {
                return region.symbol;
            }
        }
        return null;
    }, [mapRegions]);

    // Get region info for an address
    const getRegionForAddress = useCallback((address: number): MapRegion | null => {
        for (const region of mapRegions) {
            if (address >= region.startAddress && address <= region.endAddress) {
                return region;
            }
        }
        return null;
    }, [mapRegions]);

    // Check if address is start/end of a map
    const isMapBoundary = useCallback((address: number): { isStart: boolean; isEnd: boolean; symbol: SymbolHelper | null } => {
        for (const region of mapRegions) {
            if (address === region.startAddress) {
                return { isStart: true, isEnd: false, symbol: region.symbol };
            }
            if (address === region.endAddress) {
                return { isStart: false, isEnd: true, symbol: region.symbol };
            }
        }
        return { isStart: false, isEnd: false, symbol: null };
    }, [mapRegions]);

    // Handle clicking on a hex byte
    const handleByteClick = useCallback((address: number) => {
        const symbol = findSymbolAtAddress(address);
        setCurrentSymbol(symbol ? symbol.varname : 'No symbol');
        setCursorAddress(address);
        setEditingAddress(address);
        setEditValue(data[address].toString(16).toUpperCase().padStart(2, '0'));
    }, [data, findSymbolAtAddress]);

    // Handle editing completion - REPLACE mode only (never insert)
    const handleEditComplete = useCallback(() => {
        if (editingAddress === null || !fileBuffer) return;

        const parsed = parseInt(editValue, 16);
        if (isNaN(parsed) || parsed < 0 || parsed > 255) {
            // Invalid value, cancel edit
            setEditingAddress(null);
            setEditValue('');
            return;
        }

        // Create new buffer with the edited byte (REPLACE, not INSERT)
        const newData = new Uint8Array(fileBuffer);
        newData[editingAddress] = parsed;

        // Update the store's file buffer
        useFileStore.setState({
            fileBuffer: newData.buffer.slice(0),
            checksumStatus: "Modified (Unverified)"
        });

        setEditingAddress(null);
        setEditValue('');
    }, [editingAddress, editValue, fileBuffer]);

    // Handle keyboard input during edit
    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') {
            handleEditComplete();
        } else if (e.key === 'Escape') {
            setEditingAddress(null);
            setEditValue('');
        } else if (e.key === 'Tab') {
            e.preventDefault();
            handleEditComplete();
            // Move to next byte
            if (editingAddress !== null && editingAddress < data.length - 1) {
                const nextAddr = editingAddress + (e.shiftKey ? -1 : 1);
                if (nextAddr >= 0 && nextAddr < data.length) {
                    handleByteClick(nextAddr);
                }
            }
        }
    }, [handleEditComplete, editingAddress, data.length, handleByteClick]);

    // Jump to address
    const handleJumpToAddress = useCallback(() => {
        const addr = parseInt(searchAddress, 16);
        if (!isNaN(addr) && addr >= 0 && addr < data.length) {
            const row = Math.floor(addr / ROW_SIZE);
            virtuosoRef.current?.scrollToIndex({ index: row, align: 'center' });
            setCursorAddress(addr);
            const symbol = findSymbolAtAddress(addr);
            setCurrentSymbol(symbol ? symbol.varname : 'No symbol');
        }
    }, [searchAddress, data.length, findSymbolAtAddress]);

    // Jump to selected map
    const handleJumpToMap = useCallback((region: MapRegion) => {
        const row = Math.floor(region.startAddress / ROW_SIZE);
        virtuosoRef.current?.scrollToIndex({ index: row, align: 'start' });
        setCursorAddress(region.startAddress);
        setCurrentSymbol(region.symbol.varname);
        setSelectedMapAddress(region.startAddress);
    }, []);

    // Open map in map view
    const handleOpenMap = useCallback((symbol: SymbolHelper) => {
        selectSymbol(symbol);
        onSwitchToMapView?.();
    }, [selectSymbol, onSwitchToMapView]);

    // Render a map item in the sidebar
    const renderMapItem = (region: MapRegion) => {
        const isSelected = selectedMapAddress === region.startAddress;
        const colors = getSubcategoryColor(region.symbol);
        let Icon = MapIcon;
        const sub = (region.symbol.subcategory || "").toLowerCase();
        if (sub === "limiters") Icon = AlertTriangle;
        if (sub === "misc") Icon = Settings;
        if (sub === "fuel") Icon = Disc;
        if (sub === "turbo") Icon = Gauge;
        if (sub === "switches") Icon = Zap;
        if (sub === "launch control") Icon = Zap;

        return (
            <div
                key={region.startAddress}
                className={`group flex flex-col p-2 rounded cursor-pointer text-xs transition-all duration-150
                    ${isSelected
                        ? 'bg-blue-600 text-white'
                        : 'text-zinc-400 hover:bg-zinc-700 hover:text-zinc-100'
                    }`}
                onClick={() => handleJumpToMap(region)}
            >
                <div className="flex items-center gap-2">
                    <Icon className={`w-3 h-3 flex-shrink-0 ${isSelected ? 'text-blue-200' : colors.text}`} />
                    <span className="flex-1 truncate font-medium" title={region.symbol.varname}>
                        {region.symbol.varname || `Map @ ${region.startAddress.toString(16).toUpperCase()}`}
                    </span>
                    {/* Color indicator matching hex view */}
                    <span className={`w-2 h-2 rounded-full ${colors.bg.replace('/20', '')} flex-shrink-0`}></span>
                </div>
                <div className="flex items-center justify-between mt-1 pl-5">
                    <span className={`font-mono text-[10px] ${isSelected ? 'text-blue-200' : 'text-zinc-500'}`}>
                        0x{region.startAddress.toString(16).toUpperCase().padStart(6, '0')}
                    </span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            handleOpenMap(region.symbol);
                        }}
                        className={`text-[10px] px-1.5 py-0.5 rounded transition-colors
                            ${isSelected
                                ? 'bg-blue-500 text-white hover:bg-blue-400'
                                : 'bg-zinc-600 text-zinc-300 hover:bg-blue-500 hover:text-white'
                            }`}
                        title="Open in Map View"
                    >
                        Edit
                    </button>
                </div>
            </div>
        );
    };

    const itemContent = (index: number) => {
        const offset = index * ROW_SIZE;
        const rowData = data.subarray(offset, Math.min(offset + ROW_SIZE, data.length));

        // Address
        const address = offset.toString(16).toUpperCase().padStart(8, '0');

        // Check if any byte in this row belongs to a map region
        const rowRegion = getRegionForAddress(offset);
        const rowHasMapStart = mapRegions.some(r => r.startAddress >= offset && r.startAddress < offset + ROW_SIZE);
        const rowHasMapEnd = mapRegions.some(r => r.endAddress >= offset && r.endAddress < offset + ROW_SIZE);

        return (
            <div
                className={`flex font-mono text-sm hover:bg-gray-100 dark:hover:bg-gray-800 cursor-default h-[28px] items-center ${rowRegion ? rowRegion.color : ''}`}
            >
                {/* Address */}
                <div className="w-24 text-blue-600 dark:text-blue-400 select-none border-r border-gray-200 dark:border-gray-700 px-2 flex items-center">
                    {address}
                    {rowHasMapStart && (
                        <span className="ml-1 text-[10px] text-green-500 font-bold" title="Map Start">▶</span>
                    )}
                    {rowHasMapEnd && (
                        <span className="ml-1 text-[10px] text-red-500 font-bold" title="Map End">◀</span>
                    )}
                </div>

                {/* Hex Bytes */}
                <div className="flex-1 flex px-2 text-gray-800 dark:text-gray-200">
                    <div className="flex">
                        {Array.from({ length: ROW_SIZE }, (_, i) => {
                            const byteAddress = offset + i;
                            const byteValue = i < rowData.length ? rowData[i] : null;
                            const boundary = isMapBoundary(byteAddress);
                            const isInMap = getRegionForAddress(byteAddress) !== null;
                            const isCursor = byteAddress === cursorAddress;
                            const isEditing = byteAddress === editingAddress;

                            if (byteValue === null) {
                                return <span key={i} className="w-6 text-center invisible">  </span>;
                            }

                            const hexString = byteValue.toString(16).toUpperCase().padStart(2, '0');

                            let borderClass = '';
                            if (boundary.isStart) borderClass = 'border-l-2 border-green-500';
                            if (boundary.isEnd) borderClass = 'border-r-2 border-red-500';

                            return (
                                <span
                                    key={i}
                                    onClick={() => handleByteClick(byteAddress)}
                                    className={`w-6 text-center cursor-pointer transition-colors rounded-sm
                                        ${i === 8 ? 'ml-3' : ''}
                                        ${isInMap ? 'font-medium' : 'text-gray-500'}
                                        ${isCursor && !isEditing ? 'bg-yellow-300 dark:bg-yellow-600 text-black dark:text-white' : ''}
                                        ${borderClass}
                                        hover:bg-blue-200 dark:hover:bg-blue-700`}
                                    title={boundary.isStart ? `Start: ${boundary.symbol?.varname}` : boundary.isEnd ? `End: ${boundary.symbol?.varname}` : ''}
                                >
                                    {isEditing ? (
                                        <input
                                            type="text"
                                            value={editValue}
                                            onChange={(e) => setEditValue(e.target.value.toUpperCase().slice(0, 2))}
                                            onBlur={handleEditComplete}
                                            onKeyDown={handleKeyDown}
                                            className="w-5 bg-blue-500 text-white text-center font-mono text-sm outline-none rounded"
                                            autoFocus
                                            maxLength={2}
                                        />
                                    ) : (
                                        hexString
                                    )}
                                </span>
                            );
                        })}
                    </div>
                </div>

                {/* ASCII */}
                <div className="w-44 border-l border-gray-200 dark:border-gray-700 px-2 text-gray-600 dark:text-gray-400 tracking-wide font-mono text-xs flex items-center">
                    {Array.from({ length: ROW_SIZE }, (_, i) => {
                        if (i >= rowData.length) return ' ';
                        const charCode = rowData[i];
                        // Printable ASCII range
                        if (charCode >= 32 && charCode <= 126) {
                            return String.fromCharCode(charCode);
                        }
                        return '.';
                    }).join('')}
                </div>
            </div>
        );
    };

    const detectedCount = Object.values(groupedMaps.detected).flat().length;

    return (
        <div className="h-full w-full flex flex-col bg-white dark:bg-zinc-900">
            {/* Toolbar */}
            <div className="flex-shrink-0 p-2 border-b border-gray-200 dark:border-gray-700 flex items-center gap-4 bg-gray-50 dark:bg-zinc-800">
                {/* Current Address & Symbol */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Address:</span>
                    <span className="font-mono text-sm text-blue-600 dark:text-blue-400">
                        0x{cursorAddress.toString(16).toUpperCase().padStart(8, '0')}
                    </span>
                </div>

                <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>

                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Symbol:</span>
                    <span className="font-mono text-sm text-green-600 dark:text-green-400 truncate" title={currentSymbol}>
                        {currentSymbol}
                    </span>
                </div>

                <div className="h-4 w-px bg-gray-300 dark:bg-gray-600"></div>

                {/* Go to Address */}
                <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-500 dark:text-gray-400">Go to:</span>
                    <input
                        type="text"
                        value={searchAddress}
                        onChange={(e) => setSearchAddress(e.target.value.toUpperCase())}
                        onKeyDown={(e) => e.key === 'Enter' && handleJumpToAddress()}
                        placeholder="0x00000000"
                        className="w-24 px-2 py-1 text-xs font-mono bg-white dark:bg-zinc-700 border border-gray-300 dark:border-gray-600 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    <button
                        onClick={handleJumpToAddress}
                        className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
                    >
                        Go
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Map List Sidebar with Categories */}
                <div className="w-72 flex-shrink-0 border-r border-gray-200 dark:border-zinc-700 flex flex-col bg-zinc-950">
                    <div className="p-2 border-b border-zinc-800 bg-zinc-900">
                        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
                            <Layers className="w-4 h-4 text-blue-500" />
                            <span>Hex Map Navigator</span>
                            <span className="ml-auto bg-zinc-800 text-zinc-400 px-1.5 py-0.5 rounded text-[9px] font-mono">
                                {mapRegions.length}
                            </span>
                        </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
                        {/* Detected Maps */}
                        <CollapsibleSection title="Detected Maps" count={detectedCount} icon={Folder} defaultOpen={true} colorClass="text-blue-500">
                            <CollapsibleSection title="Turbo" count={groupedMaps.detected.turbo.length} icon={Gauge} defaultOpen={true}>
                                {groupedMaps.detected.turbo.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Fuel" count={groupedMaps.detected.fuel.length} icon={Disc} defaultOpen={true}>
                                {groupedMaps.detected.fuel.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Limiters" count={groupedMaps.detected.limiters.length} icon={AlertTriangle} defaultOpen={true}>
                                {groupedMaps.detected.limiters.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Launch Control" count={groupedMaps.detected.launchControl.length} icon={Zap} defaultOpen={true}>
                                {groupedMaps.detected.launchControl.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Switches" count={groupedMaps.detected.switches.length} icon={Zap}>
                                {groupedMaps.detected.switches.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Misc" count={groupedMaps.detected.misc.length} icon={Settings}>
                                {groupedMaps.detected.misc.map(renderMapItem)}
                            </CollapsibleSection>

                            <CollapsibleSection title="Other" count={groupedMaps.detected.other.length} icon={FileText}>
                                {groupedMaps.detected.other.map(renderMapItem)}
                            </CollapsibleSection>
                        </CollapsibleSection>

                        {/* Potential/Unknown Maps */}
                        <CollapsibleSection title="Unknown Maps" count={groupedMaps.potential.length} icon={Layers} defaultOpen={false} colorClass="text-yellow-600">
                            {groupedMaps.potential.map(renderMapItem)}
                        </CollapsibleSection>

                        {mapRegions.length === 0 && (
                            <div className="p-4 text-xs text-gray-500 dark:text-gray-400 text-center">
                                No maps detected in this file
                            </div>
                        )}
                    </div>
                </div>

                {/* Hex View */}
                <div className="flex-1 overflow-hidden">
                    {/* Column Headers */}
                    <div className="flex font-mono text-xs bg-gray-100 dark:bg-zinc-800 border-b border-gray-200 dark:border-gray-700 h-6 items-center text-gray-500 dark:text-gray-400">
                        <div className="w-24 px-2 border-r border-gray-200 dark:border-gray-700">Offset</div>
                        <div className="flex-1 px-2 flex">
                            {Array.from({ length: 16 }, (_, i) => (
                                <span key={i} className={`w-6 text-center ${i === 8 ? 'ml-3' : ''}`}>
                                    {i.toString(16).toUpperCase()}
                                </span>
                            ))}
                        </div>
                        <div className="w-44 px-2 border-l border-gray-200 dark:border-gray-700">ASCII</div>
                    </div>

                    <Virtuoso
                        ref={virtuosoRef}
                        totalCount={rowCount}
                        itemContent={itemContent}
                        className="scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600"
                        style={{ height: 'calc(100% - 24px)', width: '100%' }}
                    />
                </div>
            </div>

            {/* Footer Status Bar */}
            <div className="flex-shrink-0 px-3 py-1.5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-zinc-800 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                <div className="flex items-center gap-4">
                    <span>File Size: {(data.length / 1024).toFixed(2)} KB ({data.length.toLocaleString()} bytes)</span>
                    <span>•</span>
                    <span>Maps: {mapRegions.length}</span>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                    {/* Subcategory colors */}
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-cyan-500"></span> Turbo
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-orange-500"></span> Fuel
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-red-500"></span> Limiters
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-pink-500"></span> Launch
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-yellow-500"></span> Switches
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-purple-500"></span> Misc
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded bg-zinc-500"></span> Unknown
                    </span>
                    <span className="text-zinc-600">|</span>
                    <span className="flex items-center gap-1">
                        <span className="text-green-500 font-bold">▶</span> Start
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="text-red-500 font-bold">◀</span> End
                    </span>
                </div>
            </div>
        </div>
    );
};