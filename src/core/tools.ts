import { EDCFileType, SymbolHelper } from './types';

export class Tools {
    /**
     * Reads the map content (Z data) and axes (X, Y) from the file buffer based on SymbolHelper.
     * 
     * IMPORTANT: The C# code swaps X and Y axes when displaying:
     *   tabdet.X_axisAddress = sh.Y_axis_address;
     *   tabdet.Y_axisAddress = sh.X_axis_address;
     * 
     * This means for display purposes:
     * - X axis (columns) comes from Y_axis_address/Y_axis_length
     * - Y axis (rows) comes from X_axis_address/X_axis_length
     */
    static readMapData(fileBuffer: ArrayBuffer, symbol: SymbolHelper): { x: number[], y: number[], z: number[][] } {
        const data = new Uint8Array(fileBuffer);
        const xValues: number[] = [];
        const yValues: number[] = [];
        const zValues: number[][] = [];

        // Read X Axis for display (from Y_axis in symbol - C# swap!)
        if (symbol.yAxisAddress > 0) {
            for (let i = 0; i < symbol.yAxisLength; i++) {
                xValues.push(Tools.readUint16(data, symbol.yAxisAddress + (i * 2)));
            }
        } else {
            for (let i = 0; i < symbol.yAxisLength; i++) xValues.push(i);
        }

        // Read Y Axis for display (from X_axis in symbol - C# swap!)
        if (symbol.xAxisAddress > 0) {
            for (let i = 0; i < symbol.xAxisLength; i++) {
                yValues.push(Tools.readUint16(data, symbol.xAxisAddress + (i * 2)));
            }
        } else {
            for (let i = 0; i < symbol.xAxisLength; i++) yValues.push(i);
        }

        // Read Z Data (Map Content)
        // Display dimensions: 
        //   - X axis (columns) = symbol.yAxisLength (swapped)
        //   - Y axis (rows) = symbol.xAxisLength (swapped)
        const displayRows = symbol.xAxisLength;  // Y axis rows in display
        const displayCols = symbol.yAxisLength;  // X axis columns in display
        const totalElements = displayRows * displayCols;

        // Avoid division by zero
        if (totalElements === 0) return { x: [], y: [], z: [] };

        const elementSize = Math.floor(symbol.length / totalElements);
        // Default to 2 bytes (16-bit) for EDC15 maps
        const actualElementSize = (elementSize === 1 || elementSize === 2) ? elementSize : 2;

        let offset = symbol.flashStartAddress;

        // Read rows (Y axis / xAxisLength in storage)
        for (let y = 0; y < displayRows; y++) {
            const row: number[] = [];
            // Read cols (X axis / yAxisLength in storage)
            for (let x = 0; x < displayCols; x++) {
                let val = 0;

                if (actualElementSize === 2) {
                    val = Tools.readUint16(data, offset);
                } else {
                    val = data[offset];
                }
                offset += actualElementSize;
                row.push(val);
            }
            zValues.push(row);
        }

        return { x: xValues, y: yValues, z: zValues };
    }

    /**
     * Finds a sequence of bytes in a larger byte array using a mask.
     * @param fileData The full binary data.
     * @param offset Start search from this offset.
     * @param sequence The byte sequence to find.
     * @param mask The mask for the sequence (1 = match, 0 = ignore).
     * @returns The index of the start of the sequence, or -1 if not found.
     */
    static findSequence(fileData: Uint8Array, offset: number, sequence: number[], mask: number[]): number {
        if (sequence.length !== mask.length) {
            throw new Error("Sequence and mask must be of the same length.");
        }

        let i = 0;
        let position = offset;
        const seqLen = sequence.length;
        const fileLen = fileData.length;

        while (position < fileLen) {
            const data = fileData[position];
            if (mask[i] === 0 || data === sequence[i]) {
                i++;
            } else {
                // Mismatch, reset. 
                // Optimisation: This is a naive search. In the C# code: 
                // if (i > max) max = i; position -= i; i = 0;
                // This rewinds position.
                position -= i;
                i = 0;
            }

            position++;

            if (i === seqLen) {
                return position - seqLen;
            }
        }

        return -1;
    }

    /**
     * Extracts the Bosch Part Number from the binary data.
     * @param allBytes The full binary data.
     * @returns The Bosch Part Number string or empty string if not found.
     */
    static extractBoschPartNumber(allBytes: Uint8Array): string {
        let retval = "";
        try {
            // Search for "EDC  "
            const sequence = [0x45, 0x44, 0x43, 0x20, 0x20];
            const mask = [1, 1, 1, 1, 1];
            let partnumberAddress = Tools.findSequence(allBytes, 0, sequence, mask);

            if (partnumberAddress > 0) {
                // for EDC
                retval = Tools.getString(allBytes, partnumberAddress + 23, 10).trim();
                if (Tools.stripNonAscii(retval).length < 10) {
                    // try again, read from "EDC" id - 0x100 to EDC id + 100 and find 10 digit sequence
                    retval = Tools.findDigits(allBytes, partnumberAddress - 0x100, partnumberAddress + 0x100, 10);
                }

                // ... (Other checks omitted for Phase 1 MVP unless strictly needed, sticking to core EDC15P logic first)
                if (retval === "") {
                    // Fallback for older ECUs logic from C#
                    // partnumberAddress = Tools.findSequence(allBytes, 0, new byte[4] { 0x30, 0x32, 0x38, 0x31}, new byte[4] { 1, 1, 1, 1 });
                    partnumberAddress = Tools.findSequence(allBytes, 0, [0x30, 0x32, 0x38, 0x31], [1, 1, 1, 1]);
                    if (partnumberAddress > 0) {
                        retval = Tools.getString(allBytes, partnumberAddress, 10).trim();
                    }
                }

            } else {
                // Fallback if "EDC  " not found
                let partnumberAddress = Tools.findSequence(allBytes, 0, [0x30, 0x32, 0x38, 0x31], [1, 1, 1, 1]);
                if (partnumberAddress > 0) {
                    retval = Tools.getString(allBytes, partnumberAddress, 10).trim();
                }
            }
        } catch (e) {
            console.error("Error extracting Bosch Part Number", e);
        }
        return Tools.stripNonAscii(retval);
    }

    static getString(allBytes: Uint8Array, start: number, length: number): string {
        let result = "";
        for (let i = 0; i < length; i++) {
            if (start + i < allBytes.length) {
                result += String.fromCharCode(allBytes[start + i]);
            }
        }
        return result;
    }

    static stripNonAscii(input: string): string {
        return input.replace(/[^a-zA-Z0-9]/g, '');
    }

    static findDigits(allBytes: Uint8Array, start: number, end: number, length: number): string {
        // Safety bounds
        start = Math.max(0, start);
        end = Math.min(allBytes.length, end);

        for (let i = start; i < end; i++) {
            const testStr = Tools.getString(allBytes, i, length);
            const stripped = Tools.stripNonDigit(testStr);
            if (stripped.length === length) return stripped;
        }
        return "";
    }

    static stripNonDigit(input: string): string {
        return input.replace(/[^0-9]/g, '');
    }

    static readUint16(data: Uint8Array, offset: number, littleEndian: boolean = true): number {
        if (offset + 2 > data.length) return 0;
        const b0 = data[offset];
        const b1 = data[offset + 1];
        return littleEndian ? (b0 | (b1 << 8)) : ((b0 << 8) | b1);
    }

    static readInt16(data: Uint8Array, offset: number, littleEndian: boolean = true): number {
        const uint = Tools.readUint16(data, offset, littleEndian);
        return uint >= 0x8000 ? uint - 0x10000 : uint;
    }

    /**
     * Determines the ECU file type based on the binary content.
     * Uses Bosch part number and file characteristics to identify the ECU variant.
     * @param allBytes The full binary data.
     * @returns The detected EDCFileType.
     */
    static determineFileType(allBytes: Uint8Array): EDCFileType {
        const boschNumber = Tools.extractBoschPartNumber(allBytes);

        // Extract ECU info identifier from file
        // Search for "EDC  " pattern and get the ECU type string
        const sequence = [0x45, 0x44, 0x43, 0x20, 0x20]; // "EDC  "
        const mask = [1, 1, 1, 1, 1];
        const edcAddress = Tools.findSequence(allBytes, 0, sequence, mask);

        let ecuTypeString = "";
        if (edcAddress > 0) {
            // Read the ECU type identifier which typically follows "EDC  " pattern
            // Format is usually like "EDC15P" or "EDC15C" etc in the firmware
            ecuTypeString = Tools.getString(allBytes, edcAddress, 20).trim();
        }

        // Check for specific ECU types by searching for them in the firmware
        // EDC15P identification
        if (ecuTypeString.includes("EDC15P-6") || ecuTypeString.includes("EDC15P6")) {
            return EDCFileType.EDC15P6;
        }
        if (ecuTypeString.includes("EDC15P")) {
            return EDCFileType.EDC15P;
        }
        if (ecuTypeString.includes("EDC15C")) {
            return EDCFileType.EDC15C;
        }
        if (ecuTypeString.includes("EDC15V")) {
            return EDCFileType.EDC15V;
        }
        if (ecuTypeString.includes("EDC15M")) {
            return EDCFileType.EDC15M;
        }
        if (ecuTypeString.includes("EDC16")) {
            return EDCFileType.EDC16;
        }
        if (ecuTypeString.includes("EDC17")) {
            return EDCFileType.EDC17;
        }
        if (ecuTypeString.includes("MSA15")) {
            return EDCFileType.MSA15;
        }
        if (ecuTypeString.includes("MSA12")) {
            return EDCFileType.MSA12;
        }
        if (ecuTypeString.includes("MSA11")) {
            return EDCFileType.MSA11;
        }
        if (ecuTypeString.includes("MSA6")) {
            return EDCFileType.MSA6;
        }

        // File size heuristics as fallback
        if (allBytes.length === 512 * 1024) {
            // 512KB - typical for EDC15P/C/V
            // Default to EDC15P as it's the most common
            return EDCFileType.EDC15P;
        }
        if (allBytes.length === 1024 * 1024) {
            // 1MB - could be EDC15V or EDC16
            return EDCFileType.EDC15V;
        }
        if (allBytes.length === 2 * 1024 * 1024) {
            // 2MB - EDC17
            return EDCFileType.EDC17;
        }

        // Default to EDC15P for 512KB files (most common in this tool's scope)
        if (allBytes.length === 512 * 1024) {
            return EDCFileType.EDC15P;
        }

        return EDCFileType.Unknown;
    }
}
