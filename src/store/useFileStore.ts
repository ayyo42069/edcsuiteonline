import { create } from 'zustand';
import { SymbolCollection, CodeBlock, AxisHelper, EDCFileType, SymbolHelper } from '../core/types';
import { EDC15PFileParser } from '../core/parsers/EDC15PFileParser';
import { EDC15CFileParser } from '../core/parsers/EDC15CFileParser';
import { EDC15MFileParser } from '../core/parsers/EDC15MFileParser';
import { EDC15VFileParser } from '../core/parsers/EDC15VFileParser';
import { EDC15P6FileParser } from '../core/parsers/EDC15P6FileParser';
import { EDC16FileParser } from '../core/parsers/EDC16FileParser';
import { EDC15P_checksum, ChecksumResult } from '../core/checksum/EDC15P_checksum';
import { Tools } from '../core/tools';

interface FileState {
    fileBuffer: ArrayBuffer | null;
    fileName: string;
    fileType: EDCFileType;
    symbols: SymbolCollection;
    codeBlocks: CodeBlock[];
    axisHelpers: AxisHelper[];
    isParsing: boolean;
    selectedSymbol: SymbolHelper | null;

    // Checksum State
    checksumStatus: string | null;
    checksumFixedCount: number;
    checksumMatchCount: number;

    loadResult: (buffer: ArrayBuffer, name: string) => void;
    reset: () => void;
    selectSymbol: (symbol: SymbolHelper | null) => void;
    updateMapData: (symbol: SymbolHelper, xIndex: number, yIndex: number, newValue: number) => void;
    updateMapDataBatch: (
        symbol: SymbolHelper,
        cells: Array<{ x: number, y: number }>,
        operation: 'set' | 'add' | 'multiply' | 'addPercent',
        value: number
    ) => void;
    verifyChecksums: () => void;
    addLaunchControlSymbols: (modifiedBuffer: ArrayBuffer, locations: number[]) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
    fileBuffer: null,
    fileName: "",
    fileType: EDCFileType.Unknown,
    symbols: [],
    codeBlocks: [],
    axisHelpers: [],
    isParsing: false,
    selectedSymbol: null,

    checksumStatus: null,
    checksumFixedCount: 0,
    checksumMatchCount: 0,

    loadResult: (buffer: ArrayBuffer, name: string) => {
        set({ isParsing: true });

        // In a real app, this parsing should probably happen in a Web Worker to avoid blocking UI
        // For now, we do it synchronously or in a timeout to let UI update state first
        setTimeout(() => {
            try {
                const allBytes = new Uint8Array(buffer);

                // Auto-detect file type
                const detectedType = Tools.determineFileType(allBytes);
                console.log(`Detected ECU type: ${detectedType}`);

                // Select appropriate parser based on detected type
                let result: { symbols: SymbolCollection, codeBlocks: CodeBlock[], axisHelpers: AxisHelper[] };

                console.log("Starting parser...");

                if (detectedType === EDCFileType.EDC15C) {
                    console.log("Using EDC15CFileParser");
                    const parser = new EDC15CFileParser();
                    result = parser.parseFile(buffer);
                } else if (detectedType === EDCFileType.EDC15M) {
                    console.log("Using EDC15MFileParser");
                    const parser = new EDC15MFileParser();
                    result = parser.parseFile(buffer);
                } else if (detectedType === EDCFileType.EDC15V) {
                    console.log("Using EDC15VFileParser");
                    const parser = new EDC15VFileParser();
                    result = parser.parseFile(buffer);
                } else if (detectedType === EDCFileType.EDC15P6) {
                    console.log("Using EDC15P6FileParser");
                    const parser = new EDC15P6FileParser();
                    result = parser.parseFile(buffer);
                } else if (detectedType === EDCFileType.EDC16) {
                    console.log("Using EDC16FileParser");
                    const parser = new EDC16FileParser();
                    result = parser.parseFile(buffer);
                } else {
                    console.log("Using EDC15PFileParser");
                    // Default to EDC15P parser for EDC15P or unknown 512KB files
                    const parser = new EDC15PFileParser();
                    result = parser.parseFile(buffer);
                }

                console.log("Parser completed, symbols found:", result.symbols.length);

                // ========== DEBUG: Download addresses as CSV file ==========
                // DISABLED: Uncomment to re-enable CSV download on file load
                /*
                const csvLines: string[] = [];
                csvLines.push("Name,MapAddr,XAxisAddr,YAxisAddr,XLen,YLen,Length,Type");

                result.symbols.forEach(sym => {
                    const mapAddr = "0x" + sym.flashStartAddress.toString(16).toUpperCase().padStart(6, '0');
                    const xAddr = "0x" + sym.xAxisAddress.toString(16).toUpperCase().padStart(6, '0');
                    const yAddr = "0x" + sym.yAxisAddress.toString(16).toUpperCase().padStart(6, '0');
                    const type = sym.is3D ? '3D' : sym.is2D ? '2D' : '1D';
                    csvLines.push(`"${sym.varname}",${mapAddr},${xAddr},${yAddr},${sym.xAxisLength},${sym.yAxisLength},${sym.length},${type}`);
                });

                const csvContent = csvLines.join('\n');
                const blob = new Blob([csvContent], { type: 'text/csv' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `parsed_symbols_${name.replace(/\.[^/.]+$/, '')}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                console.log("Downloaded symbol addresses CSV file");
                */
                // ========== END DEBUG ==========


                set({
                    fileBuffer: buffer,
                    fileName: name,
                    fileType: detectedType,
                    symbols: result.symbols,
                    codeBlocks: result.codeBlocks,
                    axisHelpers: result.axisHelpers,
                    isParsing: false,
                    selectedSymbol: null,
                    checksumStatus: null,
                    checksumFixedCount: 0,
                    checksumMatchCount: 0
                });
            } catch (e) {
                console.error("Parsing failed", e);
                set({ isParsing: false });
            }
        }, 100);
    },

    reset: () => set({
        fileBuffer: null,
        fileName: "",
        fileType: EDCFileType.Unknown,
        symbols: [],
        codeBlocks: [],
        axisHelpers: [],
        isParsing: false,
        selectedSymbol: null,
        checksumStatus: null,
        checksumFixedCount: 0,
        checksumMatchCount: 0
    }),

    selectSymbol: (symbol) => set({ selectedSymbol: symbol }),

    updateMapData: (symbol, xIndex, yIndex, newValue) => {
        const { fileBuffer } = get();
        if (!fileBuffer) return;

        const data = new Uint8Array(fileBuffer);

        // Display dimensions match readMapData:
        //   - displayRows = symbol.xAxisLength (Y axis rows in display)
        //   - displayCols = symbol.yAxisLength (X axis columns in display)
        const displayCols = symbol.yAxisLength;
        const totalElements = symbol.xAxisLength * symbol.yAxisLength;
        const elementSize = Math.floor(symbol.length / totalElements);
        const actualElementSize = (elementSize === 1 || elementSize === 2) ? elementSize : 2;

        // Calculate offset - data is stored row by row
        // flatIndex = row * columns + column = yIndex * displayCols + xIndex
        const flatIndex = yIndex * displayCols + xIndex;
        const offset = symbol.flashStartAddress + (flatIndex * actualElementSize);

        // Apply inverse correction to get raw value
        // displayed = raw * factor + offset
        // raw = (displayed - offset) / factor
        const factor = symbol.correction || 1;
        const offsetVal = symbol.offset || 0;

        const rawSigned = Math.round((newValue - offsetVal) / factor);

        if (actualElementSize === 1) {
            let v = rawSigned;
            if (v < 0) v = 0;
            if (v > 255) v = 255;
            data[offset] = v;
        } else {
            const enc = Tools.rawFromSigned16(rawSigned);
            // Write 16-bit (Little Endian / LoHi)
            data[offset] = enc & 0xFF;
            data[offset + 1] = (enc >> 8) & 0xFF;
        }

        // Clone the buffer to trigger React update
        set({ fileBuffer: data.buffer.slice(0), checksumStatus: "Modified (Unverified)" });
    },

    updateMapDataBatch: (symbol, cells, operation, value) => {
        const { fileBuffer } = get();
        if (!fileBuffer || cells.length === 0) return;

        const data = new Uint8Array(fileBuffer);
        const displayCols = symbol.yAxisLength;
        const totalElements = symbol.xAxisLength * symbol.yAxisLength;
        const elementSize = Math.floor(symbol.length / totalElements);
        const actualElementSize = (elementSize === 1 || elementSize === 2) ? elementSize : 2;

        const factor = symbol.correction || 1;
        const offsetVal = symbol.offset || 0;

        // Helper to read current value (signed-aware for 16-bit cells)
        const readValue = (x: number, y: number): number => {
            const flatIndex = y * displayCols + x;
            const offset = symbol.flashStartAddress + (flatIndex * actualElementSize);
            let raw = 0;
            if (actualElementSize === 2) {
                raw = Tools.signedFromRaw16(data[offset] | (data[offset + 1] << 8));
            } else {
                raw = data[offset];
            }
            return raw * factor + offsetVal;
        };

        // Helper to write value (signed-aware encoding for 16-bit cells)
        const writeValue = (x: number, y: number, newDisplayValue: number) => {
            const flatIndex = y * displayCols + x;
            const offset = symbol.flashStartAddress + (flatIndex * actualElementSize);
            const rawSigned = Math.round((newDisplayValue - offsetVal) / factor);

            if (actualElementSize === 1) {
                const v = Math.max(0, Math.min(255, rawSigned));
                data[offset] = v;
            } else {
                const enc = Tools.rawFromSigned16(rawSigned);
                data[offset] = enc & 0xFF;
                data[offset + 1] = (enc >> 8) & 0xFF;
            }
        };

        // Apply operation to each cell
        for (const cell of cells) {
            const currentValue = readValue(cell.x, cell.y);
            let newValue: number;

            switch (operation) {
                case 'set':
                    newValue = value;
                    break;
                case 'add':
                    newValue = currentValue + value;
                    break;
                case 'multiply':
                    newValue = currentValue * value;
                    break;
                case 'addPercent':
                    newValue = currentValue * (1 + value / 100);
                    break;
                default:
                    newValue = currentValue;
            }

            writeValue(cell.x, cell.y, newValue);
        }

        set({ fileBuffer: data.buffer.slice(0), checksumStatus: "Modified (Unverified)" });
    },

    verifyChecksums: () => {
        const { fileBuffer } = get();
        if (!fileBuffer) return;

        const data = new Uint8Array(fileBuffer); // This is a reference if from state, but safe to mutate? 
        // Actually, updateMapData clones it. So we are working on the current buffer.
        // Checksums modify the buffer in place if incorrect.
        // We should probably clone it first if we want to be purely functional, but here we WANT to fix it.

        const checksum = new EDC15P_checksum();
        let result = ChecksumResult.ChecksumFail;

        // Try standard search first
        result = checksum.tdi41_checksum_search(data, data.length);

        // If not found/ok, try v2
        if (result !== ChecksumResult.ChecksumOK && checksum.ChecksumsFound === 0) {
            result = checksum.tdi41v2_checksum_search(data, data.length);
        }

        // If still not found, try 2002
        if (result !== ChecksumResult.ChecksumOK && checksum.ChecksumsFound === 0) {
            result = checksum.tdi41_2002_checksum_search(data, data.length);
        }

        let statusMsg = "Unknown";
        if (result === ChecksumResult.ChecksumOK) statusMsg = "OK";
        else if (result === ChecksumResult.ChecksumFail) statusMsg = "Failed";
        else if (result === ChecksumResult.ChecksumUpdated) statusMsg = "Fixed";
        else if (result === ChecksumResult.ChecksumTypeError) statusMsg = "Type Error";

        // If fixed > 0, it means we updated the buffer
        if (checksum.ChecksumsIncorrect > 0) {
            set({
                fileBuffer: data.buffer.slice(0), // Trigger update with fixed buffer
                checksumStatus: `Fixed ${checksum.ChecksumsIncorrect} checksums`,
                checksumFixedCount: checksum.ChecksumsIncorrect,
                checksumMatchCount: checksum.ChecksumsMatch
            });
        } else {
            set({
                checksumStatus: statusMsg,
                checksumFixedCount: checksum.ChecksumsIncorrect,
                checksumMatchCount: checksum.ChecksumsMatch
            });
        }
    },

    addLaunchControlSymbols: (modifiedBuffer: ArrayBuffer, locations: number[]) => {
        const { symbols, codeBlocks } = get();

        // Create launch control symbols for each location
        const newSymbols: SymbolHelper[] = [];

        for (let i = 0; i < locations.length; i++) {
            const addr = locations[i];
            // Map data starts after X-axis (25*2=50 bytes) and Y-axis (14*2=28 bytes) + axis headers
            // Based on C# pattern, the structure at this location is:
            // The map data area starts at approximately addr + 4 + 50 + 4 + 28 = addr + 86
            const mapDataAddr = addr + 86; // Approximate start of 700-byte map

            const codeBlockId = codeBlocks.findIndex(cb =>
                cb.startAddress <= addr && cb.endAddress >= addr
            );

            const launchControlSymbol: SymbolHelper = {
                flashStartAddress: mapDataAddr,
                length: 700, // 25 * 14 * 2 = 700 bytes
                varname: `Launch control map (added) [codeblock ${codeBlockId >= 0 ? codeBlockId + 1 : 'unknown'}]`,
                userDescription: "",
                description: "Launch control map - added by launch control adder",
                category: "Detected maps",
                subcategory: "Launch Control",
                is1D: false,
                is2D: false,
                is3D: true,
                selected: false,
                xaxisAssigned: true,
                yaxisAssigned: true,
                xaxisUnits: "rpm",
                yaxisUnits: "km/h",
                xAxisLength: 25,
                yAxisLength: 14,
                xAxisID: 0xC002, // Typical RPM axis ID
                yAxisID: 0xEC02, // Matched from pattern
                xAxisAddress: addr + 4,
                yAxisAddress: addr + 4 + 50, // After X-axis data
                xAxisDescr: "Engine speed (rpm)",
                yAxisDescr: "Vehicle speed (km/h)",
                zAxisDescr: "IQ limit (%)",
                xAxisCorrection: 1,
                xAxisOffset: 0,
                yAxisCorrection: 0.15625,
                yAxisOffset: 0,
                correction: 0.01,
                offset: 0,
                codeBlock: codeBlockId >= 0 ? codeBlocks[codeBlockId].codeID : 0
            };

            newSymbols.push(launchControlSymbol);
        }

        console.log("[Store] Adding", newSymbols.length, "launch control symbols");

        // Add new symbols to collection and update buffer
        set({
            fileBuffer: modifiedBuffer,
            symbols: [...symbols, ...newSymbols].sort((a, b) => a.flashStartAddress - b.flashStartAddress)
        });
    }
}));
