import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';
import { PartNumberConverter } from '../partNumberConverter';


export class EDC15PFileParser {

    public parseFile(fileBuffer: ArrayBuffer): { symbols: SymbolCollection, codeBlocks: CodeBlock[], axisHelpers: AxisHelper[] } {
        const allBytes = new Uint8Array(fileBuffer);
        const newCodeBlocks: CodeBlock[] = [];
        const newAxisHelpers: AxisHelper[] = [];
        const newSymbols: SymbolCollection = [];

        // Header info (already done in Phase 1 but useful to have access if needed)
        // const boschNumber = Tools.extractBoschPartNumber(allBytes);

        this.verifyCodeBlocks(allBytes, newSymbols, newCodeBlocks);

        let len2skip = 0;
        for (let t = 0; t < allBytes.length - 1; t += 2) {
            if (this.checkMap(t, allBytes, newSymbols, newCodeBlocks, (len) => { len2skip = len; })) {
                if (len2skip > 2) len2skip -= 2;
                if ((len2skip % 2) > 0) len2skip -= 1;
                if (len2skip < 0) len2skip = 0;
                t += len2skip;
            }
        }

        // Sort symbols
        newSymbols.sort((a, b) => a.flashStartAddress - b.flashStartAddress);

        this.nameKnownMaps(allBytes, newSymbols, newCodeBlocks);

        this.buildAxisIDList(newSymbols, newAxisHelpers);
        this.matchAxis(newSymbols, newAxisHelpers);
        this.removeNonSymbols(newSymbols, newCodeBlocks);
        this.findSVBL(allBytes, newSymbols, newCodeBlocks);

        // TODO: SymbolTranslator logic (descriptions)

        return { symbols: newSymbols, codeBlocks: newCodeBlocks, axisHelpers: newAxisHelpers };
    }

    private verifyCodeBlocks(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true;
        let offset = 0;
        const defaultCodeBlockLength = 0x10000;
        let currentCodeBlockLength = 0;
        let prevCodeBlockStart = 0;

        // Sequence: C1 02 00 68 00 25 03 00 00 10 27
        const sequence = [0xC1, 0x02, 0x00, 0x68, 0x00, 0x25, 0x03, 0x00, 0x00, 0x10, 0x27];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

        while (found) {
            const codeBlockAddress = Tools.findSequence(allBytes, offset, sequence, mask);
            if (codeBlockAddress > 0) {
                const newCodeBlock: CodeBlock = {
                    startAddress: codeBlockAddress - 1,
                    endAddress: 0,
                    codeID: 0,
                    addressID: 0,
                    blockGearboxType: GearboxType.Unknown
                };

                if (prevCodeBlockStart === 0) {
                    prevCodeBlockStart = newCodeBlock.startAddress;
                } else if (currentCodeBlockLength === 0) {
                    currentCodeBlockLength = newCodeBlock.startAddress - prevCodeBlockStart;
                    if (currentCodeBlockLength > 0x10000) currentCodeBlockLength = 0x10000;
                }

                newCodeBlocks.push(newCodeBlock);
                offset = codeBlockAddress + 1;
            } else {
                found = false;
            }
        }

        for (const cb of newCodeBlocks) {
            if (currentCodeBlockLength !== 0) {
                cb.endAddress = cb.startAddress + currentCodeBlockLength - 1;
            } else {
                cb.endAddress = cb.startAddress + defaultCodeBlockLength - 1;
            }
        }

        for (const cb of newCodeBlocks) {
            const autoSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x41, 0x47]; // "EDC  AG"
            const manualSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x53, 0x47]; // "EDC  SG"
            const maskSeq = [1, 1, 1, 1, 1, 1, 1];

            const autoIndex = Tools.findSequence(allBytes, cb.startAddress, autoSeq, maskSeq);
            const manualIndex = Tools.findSequence(allBytes, cb.startAddress, manualSeq, maskSeq);

            if (autoIndex < cb.endAddress && autoIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Automatic;
            if (manualIndex < cb.endAddress && manualIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Manual;
        }

        if (allBytes.length >= 0x80000) {
            this.checkCodeBlock(0x50000, allBytes, newSymbols, newCodeBlocks);
            this.checkCodeBlock(0x60000, allBytes, newSymbols, newCodeBlocks);
            this.checkCodeBlock(0x70000, allBytes, newSymbols, newCodeBlocks);
        }
    }

    private checkCodeBlock(offset: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): number {
        let codeBlockID = 0;
        try {
            if (offset + 0x01004 > allBytes.length) return 0;

            const endOfTable = Tools.readUint16(allBytes, offset + 0x01000, true) + offset;
            const codeBlockAddress = Tools.readUint16(allBytes, offset + 0x01002, true) + offset;

            if (endOfTable === offset + 0xC3C3) return 0;

            if (codeBlockAddress + 2 <= allBytes.length) {
                codeBlockID = Tools.readUint16(allBytes, codeBlockAddress, true);

                for (const cb of newCodeBlocks) {
                    if (cb.startAddress <= codeBlockAddress && cb.endAddress >= codeBlockAddress) {
                        cb.codeID = codeBlockID;
                        cb.addressID = codeBlockAddress;
                    }
                }
            }
        } catch (e) {
            // ignore
        }
        return codeBlockID;
    }

    private checkAxisCount(offset: number, allBytes: Uint8Array, mapSelectors: MapSelector[]): number {
        let axisCount = 0;
        let axisFound = true;
        let t = offset;

        while (axisFound) {
            axisFound = false;
            if (t + 4 > allBytes.length) break;

            const axisid = Tools.readUint16(allBytes, t, true);
            if (this.isAxisID(axisid)) {
                const axislen = Tools.readUint16(allBytes, t + 2, true);
                if (axislen > 0 && axislen < 32) {
                    axisCount++;
                    axisFound = true;
                    t += 4 + (axislen * 2);
                }
            }
        }

        let bytesToSearch = 5120 + 16;
        if (axisCount > 3) {
            while (bytesToSearch > 0 && t + 4 < allBytes.length) {
                const axisid = Tools.readUint16(allBytes, t, true);
                if (this.isAxisID(axisid)) {
                    const axislen = Tools.readUint16(allBytes, t + 2, true);
                    if (axislen <= 10) {
                        let selectorValid = true;
                        let prevSelector = 0;

                        for (let i = 0; i < (axislen * 2); i += 2) {
                            if (t + 4 + (axislen * 2) + 1 + i >= allBytes.length) {
                                selectorValid = false;
                                break;
                            }
                            const val1 = allBytes[t + 4 + (axislen * 2) + i];
                            const val2 = allBytes[t + 4 + (axislen * 2) + 1 + i];
                            const selValue = val1 + val2; // Not quite correct logic from C#? C# uses Convert.ToUInt32 which sums bytes?
                            // C#: uint selValue = Convert.ToUInt32(allBytes[...]) + Convert.ToUInt32(allBytes[... + 1]); 
                            // This just sums the two bytes.

                            if (val1 !== 0) {
                                if (val1 !== 0x40) selectorValid = false;
                                break;
                            }
                            if (val2 > 9) {
                                selectorValid = false;
                                break;
                            }
                            if (prevSelector > selValue) {
                                selectorValid = false;
                                break;
                            }
                            prevSelector = selValue;
                        }

                        if (selectorValid) {
                            const newSel: MapSelector = {
                                numRepeats: axislen,
                                startAddress: t,
                                mapData: [], // Fill below
                                mapIndexes: [], // Fill below (same as data in C# code?)
                                xAxisAddress: 0,
                                yAxisAddress: 0,
                                xAxisID: 0,
                                yAxisID: 0,
                                xAxisLen: 0,
                                yAxisLen: 0,
                                mapLength: 0
                            };

                            // Read map data
                            for (let ia = 0; ia < axislen; ia++) {
                                const val = Tools.readUint16(allBytes, t + 4 + (ia * 2), true);
                                newSel.mapData.push(val);
                                newSel.mapIndexes.push(val);
                            }

                            mapSelectors.push(newSel);
                            if (mapSelectors.length > 5) break;
                            bytesToSearch = 5120 + 16; // Reset search
                        }
                    }
                }
                t += 2;
                bytesToSearch -= 2;
            }
        }

        return axisCount;
    }

    private verifyCodeBlocksPlaceholder(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        // Removed placeholder
    }

    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        if (!this.findSVBLSequenceOne(allBytes, newSymbols, newCodeBlocks)) {
            this.findSVBLSequenceTwo(allBytes, newSymbols, newCodeBlocks);
        }
    }

    private findSVBLSequenceOne(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): boolean {
        let found = true;
        let SVBLFound = false;
        let offset = 0;

        const seq = [0xD2, 0x00, 0xFC, 0x03, 0x00, 0x00, 0x00, 0x00, 0x04, 0x00, 0xFF, 0xFF, 0xFF, 0xC3, 0x00, 0x00];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1];

        while (found) {
            const SVBLAddress = Tools.findSequence(allBytes, offset, seq, mask);

            if (SVBLAddress > 0) {
                SVBLFound = true;
                const desc = this.determineCodeBlockDescription(SVBLAddress + 16, newCodeBlocks);
                const shsvbl: SymbolHelper = {
                    flashStartAddress: SVBLAddress + 16,
                    length: 2,
                    varname: `SVBL Boost limiter [${desc}]`,
                    userDescription: "",
                    description: "",
                    category: "Detected maps",
                    subcategory: "Limiters",
                    is1D: true,
                    is2D: false,
                    is3D: false,
                    selected: false,
                    xaxisAssigned: false,
                    yaxisAssigned: false,
                    xaxisUnits: "",
                    yaxisUnits: "",
                    xAxisLength: 1,
                    yAxisLength: 1,
                    xAxisID: 0,
                    yAxisID: 0,
                    xAxisAddress: 0,
                    yAxisAddress: 0,
                    xAxisDescr: "",
                    yAxisDescr: "",
                    zAxisDescr: "",
                    xAxisCorrection: 1,
                    xAxisOffset: 0,
                    yAxisCorrection: 1,
                    yAxisOffset: 0,
                    correction: 1,
                    offset: 0,
                    codeBlock: this.determineCodeBlockByAddress(SVBLAddress + 16, newCodeBlocks)
                };

                // Check if we need to back up 2 bytes
                const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                if (testValue === 0xC300) {
                    shsvbl.flashStartAddress -= 2;
                }

                this.addToSymbolCollection(newSymbols, shsvbl, newCodeBlocks);

                // Search for MAP/MAF switch near SVBL
                const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
                const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, SVBLAddress - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh: SymbolHelper = {
                        flashStartAddress: mapMafAddr,
                        length: 2,
                        varname: `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`,
                        userDescription: "",
                        description: "Controls whether ECU uses MAP or MAF sensor for load calculation",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true,
                        is2D: false,
                        is3D: false,
                        selected: false,
                        xaxisAssigned: false,
                        yaxisAssigned: false,
                        xaxisUnits: "",
                        yaxisUnits: "",
                        xAxisLength: 1,
                        yAxisLength: 1,
                        xAxisID: 0,
                        yAxisID: 0,
                        xAxisAddress: 0,
                        yAxisAddress: 0,
                        xAxisDescr: "",
                        yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1,
                        xAxisOffset: 0,
                        yAxisCorrection: 1,
                        yAxisOffset: 0,
                        correction: 1,
                        offset: 0,
                        codeBlock: this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks)
                    };
                    this.addToSymbolCollection(newSymbols, mapmafsh, newCodeBlocks);
                }

                offset = SVBLAddress + 1;
            } else {
                found = false;
            }
        }
        return SVBLFound;
    }

    private findSVBLSequenceTwo(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): boolean {
        // Similar to One but different sequence
        let found = true;
        let SVBLFound = false;
        let offset = 0;

        const seq = [0xDF, 0x7A, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0xDF, 0x7A];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];

        while (found) {
            const SVBLAddress = Tools.findSequence(allBytes, offset, seq, mask);

            if (SVBLAddress > 0) {
                SVBLFound = true;
                const desc = this.determineCodeBlockDescription(SVBLAddress - 2, newCodeBlocks);
                const shsvbl: SymbolHelper = {
                    flashStartAddress: SVBLAddress - 2,
                    length: 2,
                    varname: `SVBL Boost limiter [${desc}]`,
                    userDescription: "",
                    description: "",
                    category: "Detected maps",
                    subcategory: "Limiters",
                    is1D: true,
                    is2D: false,
                    is3D: false,
                    selected: false,
                    xaxisAssigned: false,
                    yaxisAssigned: false,
                    xaxisUnits: "",
                    yaxisUnits: "",
                    xAxisLength: 1,
                    yAxisLength: 1,
                    xAxisID: 0,
                    yAxisID: 0,
                    xAxisAddress: 0,
                    yAxisAddress: 0,
                    xAxisDescr: "",
                    yAxisDescr: "",
                    zAxisDescr: "",
                    xAxisCorrection: 1,
                    xAxisOffset: 0,
                    yAxisCorrection: 1,
                    yAxisOffset: 0,
                    correction: 1,
                    offset: 0,
                    codeBlock: this.determineCodeBlockByAddress(SVBLAddress - 2, newCodeBlocks)
                };

                const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                if (testValue === 0xC300) {
                    shsvbl.flashStartAddress -= 2;
                }

                this.addToSymbolCollection(newSymbols, shsvbl, newCodeBlocks);

                // Search for MAP/MAF switch near SVBL
                const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
                const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, SVBLAddress - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh: SymbolHelper = {
                        flashStartAddress: mapMafAddr,
                        length: 2,
                        varname: `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`,
                        userDescription: "",
                        description: "Controls whether ECU uses MAP or MAF sensor for load calculation",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true,
                        is2D: false,
                        is3D: false,
                        selected: false,
                        xaxisAssigned: false,
                        yaxisAssigned: false,
                        xaxisUnits: "",
                        yaxisUnits: "",
                        xAxisLength: 1,
                        yAxisLength: 1,
                        xAxisID: 0,
                        yAxisID: 0,
                        xAxisAddress: 0,
                        yAxisAddress: 0,
                        xAxisDescr: "",
                        yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1,
                        xAxisOffset: 0,
                        yAxisCorrection: 1,
                        yAxisOffset: 0,
                        correction: 1,
                        offset: 0,
                        codeBlock: this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks)
                    };
                    this.addToSymbolCollection(newSymbols, mapmafsh, newCodeBlocks);
                }

                offset = SVBLAddress + 1;
            } else {
                found = false;
            }
        }
        return SVBLFound;
    }

    private determineCodeBlockByAddress(address: number, currBlocks: CodeBlock[]): number {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                return cb.codeID;
            }
        }
        return 0;
    }

    private checkMap(t: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], setLen2Skip: (len: number) => void): boolean {
        let len2Skip = 0;
        let mapSelectors: MapSelector[] = [];

        if (t < allBytes.length - 0x100) {
            if (this.checkAxisCount(t, allBytes, mapSelectors) > 3) {
                // return false; // In C# this sets _dontGenMaps=true but doesn't immediately return?
            }

            const xaxisid = Tools.readUint16(allBytes, t, true);

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);

                if (this.isValidLength(xaxislen, xaxisid)) {
                    // Check for Y axis
                    const yAxisOffset = t + 4 + (xaxislen * 2);
                    if (yAxisOffset + 4 > allBytes.length) return false;

                    const yaxisid = Tools.readUint16(allBytes, yAxisOffset, true);
                    const yaxislen = Tools.readUint16(allBytes, yAxisOffset + 2, true);

                    if (this.isAxisID(yaxisid) && this.isValidLength(yaxislen, yaxisid)) {
                        // 3D Map Found
                        const dataSize = xaxislen * yaxislen * 2;
                        const xAxisAddr = t + 4;
                        const yAxisAddr = t + 8 + (xaxislen * 2);
                        let mapDataAddress = t + 8 + (xaxislen * 2) + (yaxislen * 2);
                        let totalLen = 4 + (xaxislen * 2) + 4 + (yaxislen * 2) + dataSize;

                        // Check for an optional Z-axis header following the Y-axis data.
                        // If present, the actual map data starts AFTER the Z-axis header (and data).
                        // This is what the C# CheckMap does (max(16, 4+zaxislen*2) bump).
                        let zaxislen = 0;
                        let zaxisid = 0;
                        let zaxisaddress = 0;
                        const zHeaderOffset = mapDataAddress; // == t + 8 + xLen*2 + yLen*2
                        if (zHeaderOffset + 4 <= allBytes.length) {
                            zaxisid = Tools.readUint16(allBytes, zHeaderOffset, true);
                            if (this.isAxisID(zaxisid)) {
                                const zlen = Tools.readUint16(allBytes, zHeaderOffset + 2, true);
                                if (this.isValidLength(zlen, zaxisid)) {
                                    zaxislen = zlen;
                                    zaxisaddress = zHeaderOffset + 4;
                                    let zBump = 4 + (zaxislen * 2);
                                    if (zBump < 16) zBump = 16;
                                    mapDataAddress += zBump;
                                    totalLen += zBump;
                                }
                            }
                        }

                        const baseSym: SymbolHelper = {
                            flashStartAddress: mapDataAddress,
                            length: dataSize,
                            varname: `3D ${mapDataAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')} ${yaxisid.toString(16).toUpperCase().padStart(4, '0')}`,
                            userDescription: "",
                            description: "",
                            category: "Potential Maps",
                            subcategory: "3D",
                            is1D: false,
                            is2D: false,
                            is3D: true,
                            selected: false,
                            xaxisAssigned: false,
                            yaxisAssigned: false,
                            xaxisUnits: "",
                            yaxisUnits: "",
                            xAxisLength: xaxislen,
                            yAxisLength: yaxislen,
                            xAxisID: xaxisid,
                            yAxisID: yaxisid,
                            xAxisAddress: xAxisAddr,
                            yAxisAddress: yAxisAddr,
                            xAxisDescr: "",
                            yAxisDescr: "",
                            zAxisDescr: "",
                            xAxisCorrection: 1,
                            xAxisOffset: 0,
                            yAxisCorrection: 1,
                            yAxisOffset: 0,
                            correction: 1,
                            offset: 0,
                            codeBlock: 0
                        };

                        let mapFound = false;

                        // If a Z-axis is present, this is a stack of repeated maps sharing X/Y.
                        // Each layer is selected by the corresponding Z value. Generate one symbol per layer.
                        if (zaxislen > 1 && zaxisaddress > 0) {
                            const nextMapAddr = this.findNextMap(allBytes, mapDataAddress + dataSize, dataSize * 10);
                            if (nextMapAddr > 0 && ((nextMapAddr - mapDataAddress) % dataSize) === 0) {
                                const ms: MapSelector = {
                                    numRepeats: zaxislen,
                                    startAddress: zaxisaddress,
                                    mapLength: dataSize,
                                    xAxisAddress: xAxisAddr,
                                    yAxisAddress: yAxisAddr,
                                    xAxisID: xaxisid,
                                    yAxisID: yaxisid,
                                    xAxisLen: xaxislen,
                                    yAxisLen: yaxislen,
                                    mapData: [],
                                    mapIndexes: []
                                };
                                for (let ia = 0; ia < zaxislen; ia++) {
                                    ms.mapData.push(Tools.readUint16(allBytes, zaxisaddress + ia * 2, true));
                                }
                                // Indexes follow the data values (C# reads sequentially with same boffset)
                                for (let ia = 0; ia < zaxislen; ia++) {
                                    ms.mapIndexes.push(Tools.readUint16(allBytes, zaxisaddress + (zaxislen * 2) + ia * 2, true));
                                }

                                for (let r = 0; r < zaxislen; r++) {
                                    const layerAddr = mapDataAddress + r * dataSize;
                                    // Skip empty/unused layers (C#: only add layer 0 unconditionally,
                                    // others only if their selector index > 0).
                                    if (r > 0 && !(ms.mapIndexes[r] > 0)) continue;
                                    const layer: SymbolHelper = {
                                        ...baseSym,
                                        flashStartAddress: layerAddr,
                                        varname: `3D ${layerAddr.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')} ${yaxisid.toString(16).toUpperCase().padStart(4, '0')}`,
                                        mapSelector: ms
                                    };
                                    if (this.addToSymbolCollection(newSymbols, layer, newCodeBlocks)) {
                                        mapFound = true;
                                    }
                                }
                                // Extend total length so the outer loop skips past all layers + Z header.
                                totalLen = (mapDataAddress - t) + zaxislen * dataSize;
                            }
                        }

                        // Always try to add the base symbol (covers the case where layers weren't generated
                        // and dedupes harmlessly against layer 0).
                        if (this.addToSymbolCollection(newSymbols, baseSym, newCodeBlocks)) {
                            mapFound = true;
                        }

                        if (mapFound) {
                            setLen2Skip(totalLen);
                            return true;
                        }
                    }
                }
            }

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);
                if (this.isValidLength(xaxislen, xaxisid)) {
                    const axisDataLen = xaxislen * 2;
                    const curveDataLen = xaxislen * 2;
                    const totalLen = 4 + axisDataLen + curveDataLen;

                    const curveStart = t + 4 + axisDataLen;
                    const possibleAxisID = Tools.readUint16(allBytes, curveStart, true);

                    if (!this.isAxisID(possibleAxisID)) {
                        // C# logic: Flash_start_address = t + 4 + (xaxislen * 2)
                        // This points to the curve data, AFTER the axis header and axis data
                        const curveDataAddress = t + 4 + (xaxislen * 2);

                        const sh: SymbolHelper = {
                            flashStartAddress: curveDataAddress, // Fixed: Points to curve data, not axis header
                            length: curveDataLen,
                            varname: `2D ${curveDataAddress.toString(16).toUpperCase().padStart(8, '0')} ${xaxisid.toString(16).toUpperCase().padStart(4, '0')}`,
                            userDescription: "",
                            description: "",
                            category: "Potential Maps",
                            subcategory: "2D",
                            is1D: false,
                            is2D: true,
                            is3D: false,
                            selected: false,
                            xaxisAssigned: false,
                            yaxisAssigned: false,
                            xaxisUnits: "",
                            yaxisUnits: "",
                            xAxisLength: xaxislen,
                            yAxisLength: 1,
                            xAxisID: xaxisid,
                            yAxisID: 0,
                            xAxisAddress: t + 4, // After axis ID (2) + axis length (2)
                            yAxisAddress: 0,
                            xAxisDescr: "",
                            yAxisDescr: "",
                            zAxisDescr: "",
                            xAxisCorrection: 1,
                            xAxisOffset: 0,
                            yAxisCorrection: 1,
                            yAxisOffset: 0,
                            correction: 1,
                            offset: 0,
                            codeBlock: 0
                        };

                        if (this.addToSymbolCollection(newSymbols, sh, newCodeBlocks)) {
                            setLen2Skip(totalLen);
                            return true;
                        }
                    }
                }
            }

        }
        setLen2Skip(0);
        return false;
    }

    // Scans ahead for the next plausible map header (axis-id + valid axis length).
    // Used to detect repeated-map stacks: if the next map sits at an exact multiple
    // of this map's data size, layers can be split into separate symbols.
    private findNextMap(allBytes: Uint8Array, index: number, maxBytesToSearch: number): number {
        const end = Math.min(allBytes.length - 4, index + maxBytesToSearch);
        for (let i = index; i < end; i += 2) {
            const xid = Tools.readUint16(allBytes, i, true);
            if (this.isAxisID(xid)) {
                const xlen = Tools.readUint16(allBytes, i + 2, true);
                if (this.isValidLength(xlen, xid)) return i;
            }
        }
        return 0;
    }

    // Matches C# EDC15PFileParser.cs isAxisID exactly.
    private isAxisID(id: number): boolean {
        const idstrip = (id >>> 8) & 0xFF;
        if (idstrip === 0xDB) return true;
        if (idstrip === 0xC0 || idstrip === 0xC1 || idstrip === 0xC2 || idstrip === 0xC4 || idstrip === 0xC5) return true;
        if (idstrip === 0xE0 || idstrip === 0xE4 || idstrip === 0xE5 || idstrip === 0xE9 || idstrip === 0xEA || idstrip === 0xEB || idstrip === 0xEC) return true;
        if (idstrip === 0xDA || idstrip === 0xDD || idstrip === 0xDE) return true;
        if (idstrip === 0xF9 || idstrip === 0xFE) return true;
        if (idstrip === 0xE8) return true;
        return false;
    }

    private isValidLength(length: number, id: number): boolean {
        const idstrip = Math.floor(id / 256);
        if ((idstrip & 0xF0) === 0xE0) {
            if (length > 0 && length <= 32) return true;
        } else {
            if (length > 0 && length < 32) return true;
        }
        return false;
    }

    private addToSymbolCollection(newSymbols: SymbolCollection, newSymbol: SymbolHelper, newCodeBlocks: CodeBlock[]): boolean {
        if (newSymbol.length >= 800) return false;
        for (const sh of newSymbols) {
            if (sh.flashStartAddress === newSymbol.flashStartAddress) return false;
        }
        newSymbols.push(newSymbol);
        newSymbol.codeBlock = this.determineCodeBlockByAddress(newSymbol.flashStartAddress, newCodeBlocks);
        return true;
    }

    private determineCodeBlockDescription(address: number, currBlocks: CodeBlock[]): string {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                let desc = `Codeblock ${cb.codeID}`;
                if (cb.blockGearboxType === GearboxType.Automatic) desc += ", Automatic";
                // Use codeblock ID for manual vs 4x4 (C# fallback logic)
                else if (cb.codeID === 2) desc += ", Manual";
                else if (cb.codeID === 3) desc += ", 4x4";
                // Generic fallback
                else if (cb.blockGearboxType === GearboxType.Manual) desc += ", Manual";
                else if (cb.blockGearboxType === GearboxType.FourByFour) desc += ", 4x4";

                return desc;
            }
        }
        return `Flashbank ${Math.floor(address / 0x10000)}`;
    }

    // --- Helpers used by nameKnownMaps (mirror C# EDC15PFileParser) ---

    private getMaxAxisValue(allBytes: Uint8Array, sh: SymbolHelper, which: 'X' | 'Y'): number {
        const addr = which === 'X' ? sh.xAxisAddress : sh.yAxisAddress;
        const len  = which === 'X' ? sh.xAxisLength  : sh.yAxisLength;
        let max = 0;
        for (let i = 0; i < len; i++) {
            const v = Tools.readUint16(allBytes, addr + i * 2, true);
            if (v > max) max = v;
        }
        return max;
    }

    private isValidTemperatureAxis(allBytes: Uint8Array, sh: SymbolHelper, which: 'X' | 'Y'): boolean {
        const addr = which === 'X' ? sh.xAxisAddress : sh.yAxisAddress;
        const len  = which === 'X' ? sh.xAxisLength  : sh.yAxisLength;
        for (let i = 0; i < len; i++) {
            const v = Tools.readUint16(allBytes, addr + i * 2, true);
            const t = v * 0.1 - 273.1;
            if (t < -80 || t > 200) return false;
        }
        return true;
    }

    private mapSelectorIndexEmpty(sh: SymbolHelper): boolean {
        if (!sh.mapSelector?.mapIndexes) return true;
        for (const v of sh.mapSelector.mapIndexes) if (v !== 0) return false;
        return true;
    }

    private getTemperatureSOIRange(ms: MapSelector | undefined, index: number): number {
        if (!ms?.mapData || ms.mapData.length <= index) return index;
        return Math.round(ms.mapData[index] * 0.1 - 273.1);
    }

    private mapContainsNegativeValues(allBytes: Uint8Array, sh: SymbolHelper): boolean {
        for (let i = 0; i < sh.length; i += 2) {
            const v = Tools.readUint16(allBytes, sh.flashStartAddress + i, true);
            if (v > 0xF000) return true;
        }
        return false;
    }

    private hasZeroYAxisStart(allBytes: Uint8Array, sh: SymbolHelper): boolean {
        return allBytes[sh.yAxisAddress] === 0 && allBytes[sh.yAxisAddress + 1] === 0;
    }
    private hasZeroXAxisStart(allBytes: Uint8Array, sh: SymbolHelper): boolean {
        return allBytes[sh.xAxisAddress] === 0 && allBytes[sh.xAxisAddress + 1] === 0;
    }

    // Apply the "Injector duration NN [codeblock ...]" preset.
    private applyInjectorDuration(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        const cnt = this.getMapNameCountForCodeBlock("Injector duration", sh.codeBlock, newSymbols) - 1;
        sh.varname = `Injector duration ${String(cnt).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisCorrection = 0.01;
        sh.correction = 0.023437;
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.yAxisDescr = "Requested Quantity mg/stroke";
        sh.zAxisDescr = "Duration (crankshaft degrees)";
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mg/st";
    }

    private applyDriverWish(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Misc";
        sh.varname = `Driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.correction = 0.01;
        sh.xAxisCorrection = 0.01;
        sh.xAxisDescr = "Throttle position";
        sh.zAxisDescr = "Requested IQ (mg)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "TPS %";
    }

    private applyEGR(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "EGR";
        const cnt = this.getMapNameCountForCodeBlock("EGR", sh.codeBlock, newSymbols);
        sh.varname = `EGR ${String(cnt).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.correction = 0.1;
        sh.xAxisCorrection = 0.01;
        sh.zAxisDescr = "Mass Air Flow (mg/stroke)";
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applyN75(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Turbo";
        sh.varname = `N75 duty cycle [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.zAxisDescr = "Duty cycle %";
        sh.correction = -0.01;
        sh.offset = 100;
        sh.xAxisCorrection = 0.01;
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applyTorqueLimiter(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.correction = 0.01;
        sh.zAxisDescr = "Maximum IQ (mg)";
        sh.yAxisDescr = "Atm. pressure (mbar)";
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mbar";
    }

    private applyStartIQ(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        const cnt = this.getMapNameCountForCodeBlock("Start IQ", sh.codeBlock, newSymbols);
        sh.varname = `Start IQ (${cnt}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.correction = 0.01;
        sh.xAxisDescr = "CT (celcius)";
        sh.xAxisCorrection = 0.1;
        sh.xAxisOffset = -273.1;
        sh.zAxisDescr = "Requested IQ (mg)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "degC";
    }

    private applyBoostLimitMap(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Boost limit map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisDescr = "Atmospheric pressure (mbar)";
        sh.zAxisDescr = "Maximum boost pressure (mbar)";
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mbar";
    }

    private applyBoostTarget(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Turbo";
        sh.varname = `Boost target map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.xAxisCorrection = 0.01;
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.zAxisDescr = "Boost target (mbar)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applySmokeLimiter(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Smoke limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        // If a per-temperature selector is attached, name with temperature.
        if (sh.mapSelector?.mapIndexes && sh.mapSelector.mapIndexes.length > 1 && !this.mapSelectorIndexEmpty(sh)) {
            const smokeCount = this.getMapNameCountForCodeBlock("Smoke limiter", sh.codeBlock, newSymbols) - 1;
            const tRange = this.getTemperatureSOIRange(sh.mapSelector, smokeCount);
            sh.varname = `Smoke limiter ${tRange} °C [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        }
        sh.zAxisDescr = "Maximum IQ (mg)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.xAxisDescr = "Airflow mg/stroke";
        sh.correction = 0.01;
        sh.xAxisCorrection = 0.1;
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applySOI(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        const cnt = this.getMapNameCountForCodeBlock("Start of injection (SOI)", sh.codeBlock, newSymbols) - 1;
        const tRange = this.getTemperatureSOIRange(sh.mapSelector, cnt);
        sh.varname = `Start of injection (SOI) ${tRange} °C [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.correction = -0.023437;
        sh.offset = 78;
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xAxisCorrection = 0.01;
        sh.xaxisUnits = "mg/st";
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.zAxisDescr = "Start position (degrees BTDC)";
    }

    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xHi = (sh.xAxisID >>> 8) & 0xFF;
            const yHi = (sh.yAxisID >>> 8) & 0xFF;

            // ========== Length 700: Launch control map (25*14) ==========
            if (sh.length === 700) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                sh.varname = `Launch control map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.yAxisCorrection = 0.15625;
                sh.correction = 0.01;
                sh.xAxisDescr = "Engine speed (rpm)";
                sh.yAxisDescr = "Approx. vehicle speed (km/h)";
                sh.zAxisDescr = "IQ limit";
                sh.yaxisUnits = "km/h";
                sh.xaxisUnits = "rpm";
            }

            // ========== Length 570: Injector duration ==========
            else if (sh.length === 570) {
                if ((xHi === 0xC5 && yHi === 0xEC) ||
                    (xHi === 0xC4 && yHi === 0xEA) ||
                    (xHi === 0xC4 && yHi === 0xEC)) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 480: Injector duration ==========
            else if (sh.length === 480) {
                if ((xHi === 0xC5 && yHi === 0xEC) || (xHi === 0xC4 && yHi === 0xEA)) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 448: SOI (mapSelector w/ 10 reps) or Injector duration ==========
            else if (sh.length === 448) {
                if (sh.mapSelector?.numRepeats === 10) {
                    this.applySOI(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xC5 && yHi === 0xEC) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 416: Smoke / IQ MAP/MAF / N75 / EGR / SOI ==========
            else if (sh.length === 416) {
                if (xHi === 0xF9 && yHi === 0xDA) {
                    this.applySmokeLimiter(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xEC && yHi === 0xDA) {
                    // If display-Y axis tops below 4000, treat as IQ by MAP limiter (boost-pressure axis),
                    // otherwise IQ by MAF limiter.
                    if (this.getMaxAxisValue(allBytes, sh, 'Y') < 4000) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Limiters";
                        sh.varname = `IQ by MAP limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.correction = 0.01;
                        sh.xAxisDescr = "Boost pressure";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.zAxisDescr = "Maximum IQ (mg)";
                        sh.yaxisUnits = "rpm";
                        sh.xaxisUnits = "mbar";
                    } else {
                        sh.category = "Detected maps";
                        sh.subcategory = "Limiters";
                        const cnt = this.getMapNameCountForCodeBlock("IQ by MAF limiter", sh.codeBlock, newSymbols);
                        sh.varname = `IQ by MAF limiter ${cnt} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.zAxisDescr = "Maximum IQ (mg)";
                        sh.correction = 0.01;
                        sh.xAxisCorrection = 0.1;
                        sh.xaxisUnits = "mg/st";
                        sh.xAxisDescr = "Airflow mg/stroke";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.yaxisUnits = "rpm";
                    }
                } else if (xHi === 0xEC && yHi === 0xEA) {
                    this.applyN75(sh, newCodeBlocks);
                } else if (xHi === 0xEC && sh.yAxisID === 0xE9D4) {
                    this.applyN75(sh, newCodeBlocks);
                } else if (xHi === 0xEC && (yHi === 0xC0 || yHi === 0xE9)) {
                    // EGR only if Y axis starts with 0.
                    if (this.hasZeroYAxisStart(allBytes, sh)) this.applyEGR(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xEA && yHi === 0xE9) {
                    this.applySOI(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xEA && yHi === 0xE8) {
                    // EGR if X axis starts with 0, else N75.
                    if (this.hasZeroXAxisStart(allBytes, sh)) this.applyEGR(sh, newSymbols, newCodeBlocks);
                    else this.applyN75(sh, newCodeBlocks);
                }
            }

            // ========== Length 390: Injector duration or EGR ==========
            else if (sh.length === 390) {
                if (sh.xAxisLength === 13 && sh.yAxisLength === 15) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xEC && yHi === 0xC0) {
                    this.applyEGR(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 384: Inverse driver wish / Smoke / EGR ==========
            else if (sh.length === 384) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 16) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `Inverse driver wish [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.01;
                    sh.zAxisDescr = "Throttle position";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                } else if (sh.xAxisLength === 16 && sh.yAxisLength === 12) {
                    if (xHi === 0xEA && yHi === 0xDA) this.applySmokeLimiter(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xEC && yHi === 0xC0) this.applyEGR(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 360: Injector duration ==========
            else if (sh.length === 360) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 15) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 352: EGR or N75 ==========
            else if (sh.length === 352) {
                if (sh.xAxisLength === 16 && sh.yAxisLength === 11) {
                    if (xHi === 0xEC && yHi === 0xC0) this.applyEGR(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xEC && yHi === 0xEA) this.applyN75(sh, newCodeBlocks);
                }
            }

            // ========== Length 320: Boost map / Boost target / IQ by MAP limiter ==========
            else if (sh.length === 320) {
                // C# default classifies as "Probable maps" with the raw address; we only label
                // when an axis combo matches.
                if (xHi === 0xEC && yHi === 0xC0) {
                    this.applyBoostTarget(sh, newCodeBlocks);
                } else if (xHi === 0xEA && yHi === 0xC0) {
                    this.applyBoostTarget(sh, newCodeBlocks);
                } else if (xHi === 0xC0 && yHi === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Turbo";
                    sh.varname = `Boost map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 1;
                    sh.zAxisDescr = "Requested boost (mbar)";
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisDescr = "IQ (mg/stroke)";
                    sh.xaxisUnits = "rpm";
                    sh.yaxisUnits = "mg/st";
                } else if (xHi === 0xEC && yHi === 0xEA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Turbo";
                    sh.varname = `Boost target map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 1;
                    sh.zAxisDescr = "Requested boost (mbar)";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisCorrection = 0.01;
                    sh.xaxisUnits = "mg/st";
                    sh.yaxisUnits = "rpm";
                } else if (xHi === 0xEC && yHi === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `IQ by MAP limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.01;
                    sh.xAxisDescr = "Boost pressure";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mbar";
                }
            }

            // ========== Length 308: SOI limiter (temperature) ==========
            else if (sh.length === 308) {
                sh.category = "Detected maps";
                sh.subcategory = "Limiters";
                sh.varname = `SOI limiter (temperature) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = -0.023437;
                sh.offset = 78;
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.xAxisDescr = "Temperature";
                sh.xAxisCorrection = 0.1;
                sh.xAxisOffset = -273.1;
                sh.zAxisDescr = "SOI limit (degrees)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "°C";
            }

            // ========== Length 286: Driver wish (13x11) ==========
            else if (sh.length === 286) {
                if (sh.xAxisLength === 0x0d && sh.yAxisLength === 0x0b) {
                    this.applyDriverWish(sh, newCodeBlocks);
                }
            }

            // ========== Length 280: Boost target (10x14, Seat) ==========
            else if (sh.length === 280) {
                if (xHi === 0xEC && yHi === 0xC0) {
                    this.applyBoostTarget(sh, newCodeBlocks);
                }
            }

            // ========== Length 260 (EXPERIMENTAL): Injector duration ==========
            else if (sh.length === 260) {
                if (xHi === 0xC5 && yHi === 0xEC) this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 256: Driver wish ==========
            else if (sh.length === 256) {
                this.applyDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 240: Driver wish (12x10, axis EC/C0) ==========
            else if (sh.length === 240) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 10 && xHi === 0xEC && yHi === 0xC0) {
                    this.applyDriverWish(sh, newCodeBlocks);
                }
            }

            // ========== Length 220 (EXPERIMENTAL): Injector duration ==========
            else if (sh.length === 220) {
                if (xHi === 0xC5 && yHi === 0xEC) this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 216: Driver wish (12x9) ==========
            else if (sh.length === 216) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 9) {
                    this.applyDriverWish(sh, newCodeBlocks);
                }
            }

            // ========== Length 200: Boost limit map / Injector duration ==========
            else if (sh.length === 200) {
                if (xHi === 0xC0 && yHi === 0xEC) {
                    this.applyBoostLimitMap(sh, newCodeBlocks);
                } else if (xHi === 0xC0 && yHi === 0xEA) {
                    this.applyBoostLimitMap(sh, newCodeBlocks);
                } else if (xHi === 0xC5 && yHi === 0xEC) {
                    // C# distinguishes based on display-X max value: > 3500 means RPM (Injector duration).
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xC4 && yHi === 0xEA) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xC4 && yHi === 0xEC) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 198 (EXPERIMENTAL): Injector duration ==========
            else if (sh.length === 198) {
                if (xHi === 0xC5 && yHi === 0xEC) this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 192: Driver wish (EC/C0) ==========
            else if (sh.length === 192) {
                if (xHi === 0xEC && yHi === 0xC0) this.applyDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 180: Start IQ / Boost limit / Injector duration ==========
            else if (sh.length === 180) {
                if (sh.xAxisLength === 9 && sh.yAxisLength === 10) {
                    if (xHi === 0xEC && yHi === 0xC1) this.applyStartIQ(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xC0 && yHi === 0xEC) this.applyBoostLimitMap(sh, newCodeBlocks);
                    else if ((xHi === 0xC5 && yHi === 0xEC) || (xHi === 0xC4 && yHi === 0xEA)) {
                        this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                    }
                } else if (sh.xAxisLength === 10 && sh.yAxisLength === 9) {
                    if (xHi === 0xC5 && yHi === 0xEC) this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 162: Start IQ (9x9, EC/C1) ==========
            else if (sh.length === 162) {
                if (sh.xAxisLength === 9 && sh.yAxisLength === 9 && xHi === 0xEC && yHi === 0xC1) {
                    this.applyStartIQ(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 160: Injector duration (8x10) ==========
            else if (sh.length === 160) {
                if (sh.xAxisLength === 8 && sh.yAxisLength === 10 && xHi === 0xC5 && yHi === 0xEC) {
                    this.applyInjectorDuration(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 150: Torque limiter (3x25, 3-cyl) ==========
            else if (sh.length === 150) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 25) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 144: Fuel volume correction / Start IQ / Torque limiter ==========
            else if (sh.length === 144) {
                if (sh.xAxisLength === 9 && sh.yAxisLength === 8 && xHi === 0xEC && yHi === 0xC0) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    sh.varname = `Fuel volume correction map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.userDescription = "zmwMKOR_KF";
                    sh.zAxisDescr = "IQ correction per 100K";
                    sh.correction = 0.002441;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisCorrection = 0.01;
                    sh.xAxisDescr = "IQ (mg/stroke)";
                }
                if (sh.xAxisLength === 8 && sh.yAxisLength === 9 && xHi === 0xEC && yHi === 0xC1) {
                    this.applyStartIQ(sh, newSymbols, newCodeBlocks);
                }
                if (sh.xAxisLength === 3 && sh.yAxisLength === 24) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 138: Torque limiter (3x23) ==========
            else if (sh.length === 138) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 23) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 132: Torque limiter (3x22) ==========
            else if (sh.length === 132) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 22) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 128: MAF correction by temperature / Expected fuel temperature ==========
            else if (sh.length === 128) {
                if (xHi === 0xEC && yHi === 0xC1) {
                    if (this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Limiters";
                        const cnt = this.getMapNameCountForCodeBlock("MAF correction by temperature", sh.codeBlock, newSymbols) - 1;
                        sh.varname = `MAF correction by temperature ${String(cnt).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.zAxisDescr = "Limit";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.xAxisDescr = "Intake air temperature";
                        sh.xAxisCorrection = 0.1;
                        sh.xAxisOffset = -273.1;
                        sh.correction = 0.01;
                        sh.yaxisUnits = "rpm";
                        sh.xaxisUnits = "°C";
                    }
                } else if (xHi === 0xEA && yHi === 0xC1) {
                    if (this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Limiters";
                        const cnt = this.getMapNameCountForCodeBlock("MAF correction by temperature", sh.codeBlock, newSymbols) - 1;
                        sh.varname = `MAF correction by temperature ${String(cnt).padStart(2, '0')} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                        sh.zAxisDescr = "Limit";
                        sh.yAxisDescr = "Engine speed (rpm)";
                        sh.xAxisDescr = "Intake air temperature";
                        sh.xAxisCorrection = 0.1;
                        sh.xAxisOffset = -273.1;
                        sh.correction = 0.01;
                        sh.yaxisUnits = "rpm";
                        sh.xaxisUnits = "°C";
                    }
                } else if (xHi === 0xEC && yHi === 0xC0) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Expected fuel temperature [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.userDescription = "zmwMKBT_KF";
                    sh.correction = 0.1;
                    sh.offset = -273.1;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xAxisCorrection = 0.01;
                    sh.xaxisUnits = "mg/st";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.zAxisDescr = "Fuel temperature °C";
                }
            }

            // ========== Length 126: Torque limiter (3x21) ==========
            else if (sh.length === 126) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 21) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 120: Torque limiter (3x20) ==========
            else if (sh.length === 120) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 20) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 64: MAF linearization (32x1) ==========
            else if (sh.length === 64) {
                if (sh.xAxisLength === 32 && sh.yAxisLength === 1) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `MAF linearization [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                }
            }

            // ========== Length 60: EGR temperature map (5x6 with Y_axis_ID == 0xC1A2) ==========
            else if (sh.length === 60) {
                if (sh.yAxisLength === 6 && sh.xAxisLength === 5 && sh.yAxisID === 0xC1A2) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `EGR temperature map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.xAxisDescr = "Temperature";
                    sh.xAxisCorrection = 0.1;
                    sh.xAxisOffset = -273.1;
                    sh.zAxisDescr = "Mass airflow correction";
                }
            }

            // ========== Length 18-70 (small): IQ by air intake temp ==========
            else if (sh.length >= 18 && sh.length <= 70) {
                // C#: X_axis_ID / 16 == 0xC1A && Y_axis_ID / 16 == 0xEC3
                if ((sh.xAxisID >>> 4) === 0xC1A && (sh.yAxisID >>> 4) === 0xEC3) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.yAxisDescr = "Temperature";
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.yAxisCorrection = 0.1;
                    sh.yAxisOffset = -273.1;
                    sh.zAxisDescr = "%";
                    sh.correction = 0.01;
                    sh.varname = `IQ by air intake temp [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                }
            }

            // ========== Length 20: Pre-glow map (2x5) ==========
            else if (sh.length === 20) {
                if (sh.yAxisLength === 5 && sh.xAxisLength === 2) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `Pre-glow map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.yAxisDescr = "Air pressure";
                    sh.xAxisDescr = "Temperature";
                    sh.xAxisCorrection = 0.1;
                    sh.xAxisOffset = -273.1;
                    sh.zAxisDescr = "Time (sec)";
                    sh.correction = 0.01;
                }
            }

            // ========== Length 12: Selector for injector duration (6x1, X_axis_ID & 0xFFF0 == 0xECB0) ==========
            else if (sh.length === 12) {
                if (sh.xAxisLength === 6 && sh.yAxisLength === 1 && (sh.xAxisID & 0xFFF0) === 0xECB0) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    sh.varname = `Selector for injector duration [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.yAxisCorrection = -0.023437;
                    sh.yAxisOffset = 78;
                    sh.correction = 0.00390625;
                    sh.zAxisDescr = "Map index";
                    sh.yaxisUnits = "SOI";
                }
            }

            // ========== Length 4: MAP linearization or Idle RPM ==========
            else if (sh.length === 4) {
                if (sh.xAxisLength === 2 && sh.yAxisLength === 1) {
                    if (sh.xAxisID === 0xEBA2 || sh.xAxisID === 0xEBA4 || sh.xAxisID === 0xE9BC) {
                        sh.category = "Detected maps";
                        sh.subcategory = "Misc";
                        sh.varname = `MAP linearization [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    } else if (xHi === 0xC1) {
                        if (this.isValidTemperatureAxis(allBytes, sh, 'X')) {
                            sh.category = "Detected maps";
                            sh.subcategory = "Misc";
                            const cnt = this.getMapNameCountForCodeBlock("Idle RPM", sh.codeBlock, newSymbols);
                            sh.varname = `Idle RPM (${cnt}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                            sh.yAxisDescr = "Coolant temperature";
                            sh.yAxisCorrection = 0.1;
                            sh.yAxisOffset = -273.1;
                            sh.zAxisDescr = "Target engine speed";
                            sh.yaxisUnits = "°C";
                        }
                    }
                }
            }
        }
    }

    private getMapNameCountForCodeBlock(baseName: string, codeBlock: number, currentSymbols: SymbolCollection): number {
        let count = 0;
        for (const sh of currentSymbols) {
            if (sh.varname && sh.varname.startsWith(baseName) && sh.codeBlock === codeBlock) {
                count++;
            }
        }
        return count + 1;
    }

    private buildAxisIDList(newSymbols: SymbolCollection, newAxisHelpers: AxisHelper[]): void {
        for (const sh of newSymbols) {
            if (!sh.varname.startsWith("2D") && !sh.varname.startsWith("3D")) {
                this.addToAxisCollection(newAxisHelpers, sh.yAxisID, sh.xAxisDescr, sh.xaxisUnits, sh.xAxisCorrection, sh.xAxisOffset);
                this.addToAxisCollection(newAxisHelpers, sh.xAxisID, sh.yAxisDescr, sh.yaxisUnits, sh.yAxisCorrection, sh.yAxisOffset);
            }
        }
    }

    private addToAxisCollection(newAxisHelpers: AxisHelper[], id: number, descr: string, units: string, correction: number, offset: number): void {
        if (id === 0) return;
        for (const ah of newAxisHelpers) {
            if (ah.axisID === id) return;
        }
        newAxisHelpers.push({
            axisID: id,
            description: descr,
            units: units,
            correction: correction,
            offset: offset
        });
    }

    private matchAxis(newSymbols: SymbolCollection, newAxisHelpers: AxisHelper[]): void {
        for (const sh of newSymbols) {
            if (!sh.yaxisAssigned) {
                for (const ah of newAxisHelpers) {
                    if (sh.xAxisID === ah.axisID) {
                        sh.yAxisDescr = ah.description;
                        sh.yaxisUnits = ah.units;
                        sh.yAxisOffset = ah.offset;
                        sh.yAxisCorrection = ah.correction;
                        sh.yaxisAssigned = true;
                        break;
                    }
                }
            }
            if (!sh.xaxisAssigned) {
                for (const ah of newAxisHelpers) {
                    if (sh.yAxisID === ah.axisID) {
                        sh.xAxisDescr = ah.description;
                        sh.xaxisUnits = ah.units;
                        sh.xAxisOffset = ah.offset;
                        sh.xAxisCorrection = ah.correction;
                        sh.xaxisAssigned = true;
                        break;
                    }
                }
            }
        }
    }

    private removeNonSymbols(newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        if (newCodeBlocks.length > 0) {
            for (const sh of newSymbols) {
                if (sh.codeBlock === 0 && (sh.varname.startsWith("2D") || sh.varname.startsWith("3D"))) {
                    sh.subcategory = "Zero codeblock stuff";
                }
            }
        }
    }

}