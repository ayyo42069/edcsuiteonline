import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';
import { PartNumberConverter } from '../partNumberConverter';

/**
 * Parser for EDC15C ECU variants
 * Uses EDC15CMaps for map identification
 */
export class EDC15CFileParser {

    public parseFile(fileBuffer: ArrayBuffer): { symbols: SymbolCollection, codeBlocks: CodeBlock[], axisHelpers: AxisHelper[] } {
        const allBytes = new Uint8Array(fileBuffer);
        const newCodeBlocks: CodeBlock[] = [];
        const newAxisHelpers: AxisHelper[] = [];
        const newSymbols: SymbolCollection = [];

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
                            const selValue = val1 + val2;

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
                                mapData: [],
                                mapIndexes: [],
                                xAxisAddress: 0,
                                yAxisAddress: 0,
                                xAxisID: 0,
                                yAxisID: 0,
                                xAxisLen: 0,
                                yAxisLen: 0,
                                mapLength: 0
                            };

                            for (let ia = 0; ia < axislen; ia++) {
                                const val = Tools.readUint16(allBytes, t + 4 + (ia * 2), true);
                                newSel.mapData.push(val);
                                newSel.mapIndexes.push(val);
                            }

                            mapSelectors.push(newSel);
                            if (mapSelectors.length > 5) break;
                            bytesToSearch = 5120 + 16;
                        }
                    }
                }
                t += 2;
                bytesToSearch -= 2;
            }
        }

        return axisCount;
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
                        description: "Controls whether ECU uses MAP or MAF sensor",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true, is2D: false, is3D: false,
                        selected: false, xaxisAssigned: false, yaxisAssigned: false,
                        xaxisUnits: "", yaxisUnits: "",
                        xAxisLength: 1, yAxisLength: 1,
                        xAxisID: 0, yAxisID: 0,
                        xAxisAddress: 0, yAxisAddress: 0,
                        xAxisDescr: "", yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1, xAxisOffset: 0,
                        yAxisCorrection: 1, yAxisOffset: 0,
                        correction: 1, offset: 0,
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
                        description: "Controls whether ECU uses MAP or MAF sensor",
                        category: "Detected maps",
                        subcategory: "Switches",
                        is1D: true, is2D: false, is3D: false,
                        selected: false, xaxisAssigned: false, yaxisAssigned: false,
                        xaxisUnits: "", yaxisUnits: "",
                        xAxisLength: 1, yAxisLength: 1,
                        xAxisID: 0, yAxisID: 0,
                        xAxisAddress: 0, yAxisAddress: 0,
                        xAxisDescr: "", yAxisDescr: "",
                        zAxisDescr: "0 = MAF, 257 = MAP",
                        xAxisCorrection: 1, xAxisOffset: 0,
                        yAxisCorrection: 1, yAxisOffset: 0,
                        correction: 1, offset: 0,
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
                // Skip
            }

            const xaxisid = Tools.readUint16(allBytes, t, true);

            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);

                if (this.isValidLength(xaxislen, xaxisid)) {
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

                        // Optional Z-axis (3D map stack with selector). See EDC15PFileParser for the full pattern.
                        let zaxislen = 0;
                        let zaxisaddress = 0;
                        if (mapDataAddress + 4 <= allBytes.length) {
                            const zaxisid = Tools.readUint16(allBytes, mapDataAddress, true);
                            if (this.isAxisID(zaxisid)) {
                                const zlen = Tools.readUint16(allBytes, mapDataAddress + 2, true);
                                if (this.isValidLength(zlen, zaxisid)) {
                                    zaxislen = zlen;
                                    zaxisaddress = mapDataAddress + 4;
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
                            correction: 0.1,
                            offset: 0,
                            codeBlock: 0
                        };

                        let mapFound = false;

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
                                for (let ia = 0; ia < zaxislen; ia++) {
                                    ms.mapIndexes.push(Tools.readUint16(allBytes, zaxisaddress + (zaxislen * 2) + ia * 2, true));
                                }
                                for (let r = 0; r < zaxislen; r++) {
                                    const layerAddr = mapDataAddress + r * dataSize;
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
                                totalLen = (mapDataAddress - t) + zaxislen * dataSize;
                            }
                        }

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
                        const curveDataAddress = t + 4 + (xaxislen * 2);

                        const sh: SymbolHelper = {
                            flashStartAddress: curveDataAddress,
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
                            xAxisAddress: t + 4,
                            yAxisAddress: 0,
                            xAxisDescr: "",
                            yAxisDescr: "",
                            zAxisDescr: "",
                            xAxisCorrection: 1,
                            xAxisOffset: 0,
                            yAxisCorrection: 1,
                            yAxisOffset: 0,
                            correction: 0.1,
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

    // Matches C# EDC15CFileParser.cs isAxisID exactly.
    private isAxisID(id: number): boolean {
        const idstrip = (id >>> 8) & 0xFF;
        if (idstrip === 0xDB) return true;
        if (idstrip === 0xC0 || idstrip === 0xC1 || idstrip === 0xC2 || idstrip === 0xC3 || idstrip === 0xC4 || idstrip === 0xC5) return true;
        if (idstrip === 0xE0 || idstrip === 0xE4 || idstrip === 0xE5 || idstrip === 0xE9 || idstrip === 0xEA || idstrip === 0xEB || idstrip === 0xEC) return true;
        if (idstrip === 0xDA || idstrip === 0xDC || idstrip === 0xDD || idstrip === 0xDE) return true;
        if (idstrip === 0xF9 || idstrip === 0xFE) return true;
        if (idstrip === 0xD7 || idstrip === 0xE6) return true;
        if (idstrip === 0xD5) return true;
        if (idstrip === 0xD9 || idstrip === 0xE8) return true;
        if (idstrip === 0xD0) return true;
        if (idstrip === 0xCD || idstrip === 0xCB || idstrip === 0xCC || idstrip === 0xCA || idstrip === 0xC7) return true;
        if (idstrip === 0xC8 || idstrip === 0xC9 || idstrip === 0xC6 || idstrip === 0xCE || idstrip === 0xCF) return true;
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
                if (cb.blockGearboxType === GearboxType.Manual) desc += ", Manual";
                else if (cb.blockGearboxType === GearboxType.Automatic) desc += ", Automatic";
                else if (cb.blockGearboxType === GearboxType.FourByFour) desc += ", 4x4";
                else if (cb.codeID === 2) desc += ", Manual";
                else if (cb.codeID === 3) desc += ", 4x4";

                return desc;
            }
        }
        return `Flashbank ${Math.floor(address / 0x10000)}`;
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

    private applyN75DC(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
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

    private applySmoke(sh: SymbolHelper, varname: string, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `${varname} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.zAxisDescr = "Maximum IQ (mg)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.xAxisDescr = "Airflow mg/stroke";
        sh.correction = 0.01;
        sh.xAxisCorrection = 0.1;
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applyInverseDriverWish(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
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

    private applyBoostTargetCounted(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Turbo";
        const cnt = this.getMapNameCountForCodeBlock("Boost target map", sh.codeBlock, newSymbols);
        sh.varname = `Boost target map (${cnt}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.xAxisCorrection = 0.01;
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.zAxisDescr = "Boost target (mbar)";
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applyBoostLimit(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Boost limit map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisDescr = "Atmospheric pressure (mbar)";
        sh.zAxisDescr = "Maximum boost pressure (mbar)";
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mbar";
    }

    private applySOIN108(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        const cnt = this.getMapNameCountForCodeBlock("Start of injection (N108 SOI)", sh.codeBlock, newSymbols);
        sh.varname = `Start of injection (N108 SOI) ${cnt} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xAxisCorrection = 0.01;
        sh.xaxisUnits = "mg/st";
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.correction = 0.023437;
        sh.zAxisDescr = "Start position (degrees BTDC)";
    }

    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xHi = (sh.xAxisID >>> 8) & 0xFF;
            const yHi = (sh.yAxisID >>> 8) & 0xFF;

            // ========== Length 544: N146 Pump voltage map (16x17, E0/C2) ==========
            if (sh.length === 544) {
                if (sh.xAxisLength === 16 && sh.yAxisLength === 17 && xHi === 0xE0 && yHi === 0xC2) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    sh.varname = `N146 Pump voltage map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.xAxisCorrection = 0.01;
                    sh.zAxisDescr = "Pump voltage (V)";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                }
            }

            // ========== Length 468: Inverse driver wish (13x18, DC/C0) ==========
            else if (sh.length === 468) {
                if (sh.xAxisLength === 13 && sh.yAxisLength === 18 && xHi === 0xDC && yHi === 0xC0) {
                    this.applyInverseDriverWish(sh, newCodeBlocks);
                }
            }

            // ========== Length 416 (16x13): Smoke / N75 / SOI ==========
            else if (sh.length === 416) {
                if (sh.xAxisLength === 0x10 && sh.yAxisLength === 0x0D) {
                    if (xHi === 0xF9 && (yHi === 0xDB || yHi === 0xDA)) {
                        this.applySmoke(sh, "Smoke limiter", newCodeBlocks);
                    } else if (xHi === 0xDC && yHi === 0xDA) {
                        this.applySmoke(sh, "Smoke limiter II", newCodeBlocks);
                    } else if (xHi === 0xDD && yHi === 0xDA) {
                        this.applyN75DC(sh, newCodeBlocks);
                    } else if (sh.xAxisID === 0xE08A && sh.yAxisID === 0xDDD8) {
                        this.applyN75DC(sh, newCodeBlocks);
                    } else if (xHi === 0xDC && yHi === 0xEA) {
                        this.applyN75DC(sh, newCodeBlocks);
                    } else if (xHi === 0xE0 && yHi === 0xDE) {
                        this.applySOIN108(sh, newSymbols, newCodeBlocks);
                    }
                }
            }

            // ========== Length 384 (12x16): Inverse driver wish / Smoke ==========
            else if (sh.length === 384) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 16) {
                    if (xHi === 0xDD && yHi === 0xC0) this.applyInverseDriverWish(sh, newCodeBlocks);
                    else if (xHi === 0xE0 && yHi === 0xC1) this.applyInverseDriverWish(sh, newCodeBlocks);
                }
                if (sh.xAxisLength === 16 && sh.yAxisLength === 12 && xHi === 0xE0 && yHi === 0xDC) {
                    this.applySmoke(sh, "Smoke limiter", newCodeBlocks);
                }
            }

            // ========== Length 320 (16x10): Boost target / Driver wish ==========
            else if (sh.length === 320) {
                if (xHi === 0xDD && yHi === 0xC0) {
                    this.applyBoostTargetCounted(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xDC && sh.yAxisID === 0xC0BA) {
                    this.applyDriverWish(sh, newCodeBlocks);
                } else if (xHi === 0xDC && sh.yAxisID === 0xC036) {
                    this.applyBoostTargetCounted(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xE0 && yHi === 0xC3) {
                    this.applyBoostTargetCounted(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 312 (13x12, DC/D7): SOI (N108) ==========
            else if (sh.length === 312) {
                if (sh.xAxisLength === 13 && sh.yAxisLength === 12 && xHi === 0xDC && yHi === 0xD7) {
                    this.applySOIN108(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 256 (8x16, DD/C0): Driver wish ==========
            else if (sh.length === 256) {
                if (xHi === 0xDD && yHi === 0xC0) this.applyDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 200: Boost limit map (multiple variants) ==========
            else if (sh.length === 200) {
                if (xHi === 0xC0 && yHi === 0xDD) this.applyBoostLimit(sh, newCodeBlocks);
                else if (xHi === 0xC0 && yHi === 0xDC) this.applyBoostLimit(sh, newCodeBlocks);
                else if (sh.xAxisID === 0xC2BE && sh.yAxisID === 0xE08A) this.applyBoostLimit(sh, newCodeBlocks);
            }

            // ========== Length 192 (8x12, E0/C1): Driver wish ==========
            else if (sh.length === 192) {
                if (xHi === 0xE0 && yHi === 0xC1) this.applyDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 182 (7x13, DC/C0): Driver wish ==========
            else if (sh.length === 182) {
                if (xHi === 0xDC && yHi === 0xC0) this.applyDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 150 (3x25): Torque limiter ==========
            else if (sh.length === 150) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 25) this.applyTorqueLimiter(sh, newCodeBlocks);
            }

            // ========== Length 114 (3x19): Torque limiter ==========
            else if (sh.length === 114) {
                if (sh.xAxisLength === 3 && sh.yAxisLength === 19) this.applyTorqueLimiter(sh, newCodeBlocks);
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
