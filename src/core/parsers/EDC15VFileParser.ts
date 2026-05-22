import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';

/**
 * Parser for EDC15V ECU variants (V6 2.5 TDI, R4 1.9 TDI, R3 1.4 TDi)
 * Most comprehensive parser with ~60+ map patterns
 * Based on C# EDC15VFileParser.cs
 */
export class EDC15VFileParser {
    private SOICorrection = 0.023437;

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

        newSymbols.sort((a, b) => a.flashStartAddress - b.flashStartAddress);
        this.nameKnownMaps(allBytes, newSymbols, newCodeBlocks);
        this.buildAxisIDList(newSymbols, newAxisHelpers);
        this.matchAxis(newSymbols, newAxisHelpers);
        this.findSVBL(allBytes, newSymbols, newCodeBlocks);

        return { symbols: newSymbols, codeBlocks: newCodeBlocks, axisHelpers: newAxisHelpers };
    }

    private verifyCodeBlocks(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true;
        let offset = 0;
        const defaultCodeBlockLength = 0x10000;
        let currentCodeBlockLength = 0;
        let prevCodeBlockStart = 0;

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
                if (prevCodeBlockStart === 0) prevCodeBlockStart = newCodeBlock.startAddress;
                else if (currentCodeBlockLength === 0) {
                    currentCodeBlockLength = newCodeBlock.startAddress - prevCodeBlockStart;
                    if (currentCodeBlockLength > 0x10000) currentCodeBlockLength = 0x10000;
                }
                newCodeBlocks.push(newCodeBlock);
                offset = codeBlockAddress + 1;
            } else found = false;
        }

        for (const cb of newCodeBlocks) {
            cb.endAddress = currentCodeBlockLength !== 0
                ? cb.startAddress + currentCodeBlockLength - 1
                : cb.startAddress + defaultCodeBlockLength - 1;
        }

        for (const cb of newCodeBlocks) {
            const autoSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x41, 0x47];
            const manualSeq = [0x45, 0x44, 0x43, 0x20, 0x20, 0x53, 0x47];
            const maskSeq = [1, 1, 1, 1, 1, 1, 1];
            const autoIndex = Tools.findSequence(allBytes, cb.startAddress, autoSeq, maskSeq);
            const manualIndex = Tools.findSequence(allBytes, cb.startAddress, manualSeq, maskSeq);
            if (autoIndex < cb.endAddress && autoIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Automatic;
            if (manualIndex < cb.endAddress && manualIndex >= cb.startAddress) cb.blockGearboxType = GearboxType.Manual;
        }

        if (allBytes.length >= 0x80000) {
            this.checkCodeBlock(0x50000, allBytes, newCodeBlocks);
            this.checkCodeBlock(0x60000, allBytes, newCodeBlocks);
            this.checkCodeBlock(0x70000, allBytes, newCodeBlocks);
        }
    }

    private checkCodeBlock(offset: number, allBytes: Uint8Array, newCodeBlocks: CodeBlock[]): void {
        try {
            if (offset + 0x01004 > allBytes.length) return;
            const endOfTable = Tools.readUint16(allBytes, offset + 0x01000, true) + offset;
            const codeBlockAddress = Tools.readUint16(allBytes, offset + 0x01002, true) + offset;
            if (endOfTable === offset + 0xC3C3) return;
            if (codeBlockAddress + 2 <= allBytes.length) {
                const codeBlockID = Tools.readUint16(allBytes, codeBlockAddress, true);
                for (const cb of newCodeBlocks) {
                    if (cb.startAddress <= codeBlockAddress && cb.endAddress >= codeBlockAddress) {
                        cb.codeID = codeBlockID;
                        cb.addressID = codeBlockAddress;
                    }
                }
            }
        } catch { /* ignore */ }
    }

    // Matches C# EDC15VFileParser.cs isAxisID exactly.
    private isAxisID(id: number): boolean {
        const idstrip = (id >>> 8) & 0xFF;
        if (idstrip === 0xDB) return true;
        if (idstrip === 0xC0 || idstrip === 0xC1 || idstrip === 0xC2 || idstrip === 0xC4 || idstrip === 0xC5) return true;
        if (idstrip === 0xE0 || idstrip === 0xE4 || idstrip === 0xE5 || idstrip === 0xE7 || idstrip === 0xE9 || idstrip === 0xEA || idstrip === 0xEB || idstrip === 0xEC || idstrip === 0xEF) return true;
        if (idstrip === 0xDA || idstrip === 0xDC || idstrip === 0xDD || idstrip === 0xDE) return true;
        if (idstrip === 0xF9 || idstrip === 0xFE) return true;
        if (idstrip === 0xD7 || idstrip === 0xE6) return true;
        if (idstrip === 0xD5) return true;
        if (idstrip === 0xD9 || idstrip === 0xE8) return true;
        if (idstrip === 0xC3 || idstrip === 0xD0) return true;
        return false;
    }

    private isValidLength(length: number, id: number): boolean {
        const idstrip = Math.floor(id / 256);
        return idstrip === 0xEB ? (length > 0 && length <= 32) : (length > 0 && length < 32);
    }

    private checkMap(t: number, allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], setLen2Skip: (len: number) => void): boolean {
        let retval = false;
        let len2Skip = 0;

        if (t < allBytes.length - 0x100) {
            const xaxisid = Tools.readUint16(allBytes, t, true);
            if (this.isAxisID(xaxisid)) {
                const xaxislen = Tools.readUint16(allBytes, t + 2, true);
                if (this.isValidLength(xaxislen, xaxisid)) {
                    const yaxisid = Tools.readUint16(allBytes, t + 4 + (xaxislen * 2), true);
                    const yaxislen = Tools.readUint16(allBytes, t + 6 + (xaxislen * 2), true);

                    if (this.isAxisID(yaxisid) && this.isValidLength(yaxislen, yaxisid)) {
                        const dataSize = xaxislen * yaxislen * 2;
                        const xAxisAddr = t + 4;
                        const yAxisAddr = t + 8 + (xaxislen * 2);
                        let mapDataAddress = t + 8 + (xaxislen * 2) + (yaxislen * 2);

                        // Optional Z-axis (3D stack with selector).
                        let zaxislen = 0;
                        let zaxisaddress = 0;
                        if (mapDataAddress + 4 <= allBytes.length) {
                            const zid = Tools.readUint16(allBytes, mapDataAddress, true);
                            if (this.isAxisID(zid)) {
                                const zlen = Tools.readUint16(allBytes, mapDataAddress + 2, true);
                                if (this.isValidLength(zlen, zid)) {
                                    zaxislen = zlen;
                                    zaxisaddress = mapDataAddress + 4;
                                    let zBump = 4 + (zaxislen * 2);
                                    if (zBump < 16) zBump = 16;
                                    mapDataAddress += zBump;
                                    len2Skip += (xaxislen * 2) + (yaxislen * 2) + zaxislen * 2;
                                }
                            }
                        }

                        const newSymbol = this.createSymbolHelper();
                        newSymbol.xAxisLength = xaxislen;
                        newSymbol.yAxisLength = yaxislen;
                        newSymbol.xAxisID = xaxisid;
                        newSymbol.yAxisID = yaxisid;
                        newSymbol.xAxisAddress = xAxisAddr;
                        newSymbol.yAxisAddress = yAxisAddr;
                        newSymbol.length = dataSize;
                        newSymbol.flashStartAddress = mapDataAddress;
                        newSymbol.varname = `3D ${mapDataAddress.toString(16).toUpperCase().padStart(8, '0')}`;
                        newSymbol.is3D = true;

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
                                    const layer = this.createSymbolHelper();
                                    Object.assign(layer, newSymbol);
                                    layer.flashStartAddress = layerAddr;
                                    layer.varname = `3D ${layerAddr.toString(16).toUpperCase().padStart(8, '0')}`;
                                    layer.mapSelector = ms;
                                    if (this.addToSymbolCollection(newSymbols, layer, newCodeBlocks)) {
                                        retval = true;
                                    }
                                }
                                len2Skip += zaxislen * dataSize;
                            }
                        }

                        if (this.addToSymbolCollection(newSymbols, newSymbol, newCodeBlocks)) {
                            retval = true;
                            len2Skip += (xaxislen * 2) + (yaxislen * 2) + dataSize;
                        }
                    } else {
                        const newSymbol = this.createSymbolHelper();
                        newSymbol.xAxisLength = xaxislen;
                        newSymbol.xAxisID = xaxisid;
                        newSymbol.xAxisAddress = t + 4;
                        newSymbol.length = xaxislen * 2;
                        newSymbol.flashStartAddress = t + 4 + (xaxislen * 2);
                        newSymbol.varname = `2D ${newSymbol.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')}`;
                        newSymbol.is2D = true;
                        retval = this.addToSymbolCollection(newSymbols, newSymbol, newCodeBlocks);
                        if (retval) len2Skip += (xaxislen * 2);
                    }
                }
            }
        }
        setLen2Skip(len2Skip);
        return retval;
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

    private createSymbolHelper(): SymbolHelper {
        return {
            varname: '', flashStartAddress: 0, length: 0, xAxisLength: 1, yAxisLength: 1,
            xAxisAddress: 0, yAxisAddress: 0, xAxisID: 0, yAxisID: 0, correction: 1, offset: 0,
            xAxisCorrection: 1, xAxisOffset: 0, yAxisCorrection: 1, yAxisOffset: 0,
            xAxisDescr: '', yAxisDescr: '', zAxisDescr: '', xaxisUnits: '', yaxisUnits: '',
            category: 'Potential Maps', subcategory: '', codeBlock: 0, description: '',
            xaxisAssigned: false, yaxisAssigned: false, mapSelector: undefined,
            is1D: false, is2D: false, is3D: false, selected: false, userDescription: ''
        };
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

    private determineCodeBlockByAddress(address: number, currBlocks: CodeBlock[]): number {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) return cb.codeID;
        }
        return 0;
    }

    private determineCodeBlockDescription(address: number, currBlocks: CodeBlock[]): string {
        for (const cb of currBlocks) {
            if (cb.startAddress <= address && cb.endAddress >= address) {
                let desc = `codeblock ${cb.codeID}`;
                if (cb.blockGearboxType === GearboxType.Automatic) desc += ", automatic";
                else if (cb.codeID === 2) desc += ", manual";
                else if (cb.codeID === 3) desc += ", 4x4";
                return desc;
            }
        }
        return `flashbank ${Math.floor(address / 0x10000)}`;
    }

    private getMapNameCountForCodeBlock(baseName: string, codeBlock: number, currentSymbols: SymbolCollection): number {
        let count = 0;
        for (const sh of currentSymbols) {
            if (sh.varname?.startsWith(baseName) && sh.codeBlock === codeBlock) count++;
        }
        return count + 1;
    }

    // --- Helpers ported from C# EDC15VFileParser ---
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

    private applyPumpVoltage(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], counted = false): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        if (counted) {
            const cnt = this.getMapNameCountForCodeBlock("N146 Pump voltage map", sh.codeBlock, newSymbols);
            sh.varname = `N146 Pump voltage map (${cnt}) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        } else {
            sh.varname = `N146 Pump voltage map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        }
        sh.correction = 1.221001;
        sh.xAxisCorrection = 0.01;
        sh.zAxisDescr = "Pump voltage (mV)";
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.yAxisDescr = "Engine speed (rpm)";
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

    private applySmokeLimiterV(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[], altName?: string): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        const base = altName ?? "Smoke limiter";
        sh.varname = `${base} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        if (sh.mapSelector?.mapIndexes && sh.mapSelector.mapIndexes.length > 1 && !this.mapSelectorIndexEmpty(sh)) {
            const smokeCount = this.getMapNameCountForCodeBlock(base, sh.codeBlock, newSymbols) - 1;
            const t = this.getTemperatureSOIRange(sh.mapSelector, smokeCount);
            sh.varname = `Smoke limiter ${t} °C [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        }
        sh.zAxisDescr = "Maximum IQ (mg)";
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.xAxisDescr = "Airflow mg/stroke";
        sh.correction = 0.01;
        sh.xAxisCorrection = 0.1;
        sh.yaxisUnits = "rpm";
        sh.xaxisUnits = "mg/st";
    }

    private applyN75DCV(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
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

    private applyEGRV(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Misc";
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

    private applySOIN108V(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Fuel";
        const cnt = this.getMapNameCountForCodeBlock("Start of injection (N108 SOI)", sh.codeBlock, newSymbols);
        sh.varname = `Start of injection (N108 SOI) ${cnt} [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisDescr = "Engine speed (rpm)";
        sh.yaxisUnits = "rpm";
        sh.xAxisCorrection = 0.01;
        sh.xaxisUnits = "mg/st";
        sh.xAxisDescr = "IQ (mg/stroke)";
        sh.correction = this.SOICorrection;
        sh.zAxisDescr = "Start position (degrees BTDC)";
    }

    private applyBoostTargetV(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
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

    private applyDriverWishV(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
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

    private applyBoostLimitV(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Boost limit map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.yAxisDescr = "Atmospheric pressure (mbar)";
        sh.zAxisDescr = "Maximum boost pressure (mbar)";
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mbar";
    }

    private applyTorqueLimiterV(sh: SymbolHelper, newCodeBlocks: CodeBlock[]): void {
        sh.category = "Detected maps";
        sh.subcategory = "Limiters";
        sh.varname = `Torque limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
        sh.zAxisDescr = "Maximum IQ (mg)";
        sh.yAxisDescr = "Atm. pressure (mbar)";
        sh.xAxisDescr = "Engine speed (rpm)";
        sh.correction = 0.01;
        sh.xaxisUnits = "rpm";
        sh.yaxisUnits = "mbar";
    }

    private applyStartIQV(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
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

    private applyMAFCorrTemp(sh: SymbolHelper, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
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

    // Comprehensive map detection ported from C# EDC15VFileParser.NameKnownMaps.
    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xHi = (sh.xAxisID >>> 8) & 0xFF;
            const yHi = (sh.yAxisID >>> 8) & 0xFF;
            const xId = sh.xAxisID;
            const yId = sh.yAxisID;

            // ========== Length 700 (25x14): Launch control ==========
            if (sh.length === 700) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                sh.varname = `Launch control map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.yAxisCorrection = 0.156250;
                sh.correction = 0.01;
                sh.xAxisDescr = "Engine speed (rpm)";
                sh.yAxisDescr = "Approx. vehicle speed (km/h)";
                sh.zAxisDescr = "IQ limit";
                sh.yaxisUnits = "km/h";
                sh.xaxisUnits = "rpm";
            }

            // ========== Length 544 (16x17): N146 Pump voltage ==========
            if (sh.length === 544 && sh.xAxisLength === 16 && sh.yAxisLength === 17) {
                if ((xHi === 0xE0 && yHi === 0xC2) || (xHi === 0xDD && yHi === 0xC0)) {
                    this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 512 (16x16, DD/C0): N146 Pump voltage ==========
            if (sh.length === 512 && sh.xAxisLength === 16 && sh.yAxisLength === 16 && xHi === 0xDD && yHi === 0xC0) {
                this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 480 (16x15): N146 Pump voltage / Inverse driver wish ==========
            if (sh.length === 480 && sh.xAxisLength === 16 && sh.yAxisLength === 15) {
                if (xId === 0xDD7C && yId === 0xC064) this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                else if (xId === 0xDDDC && yId === 0xC07C) this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                else if (xId === 0xDD52 && yId === 0xC080) this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xE0 && yHi === 0xC2) this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xEB && yHi === 0xC0) this.applyPumpVoltage(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xDD && yId === 0xC044) this.applyInverseDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 468 (13x18, DC/C0): Inverse driver wish ==========
            else if (sh.length === 468 && sh.xAxisLength === 13 && sh.yAxisLength === 18 && xHi === 0xDC && yHi === 0xC0) {
                this.applyInverseDriverWish(sh, newCodeBlocks);
            }

            // ========== Length 448: SOI (10 reps via map selector) or N146 Pump voltage ==========
            else if (sh.length === 448) {
                if (sh.mapSelector?.numRepeats === 10) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    const cnt = this.getMapNameCountForCodeBlock("Start of injection (SOI)", sh.codeBlock, newSymbols) - 1;
                    const t = this.getTemperatureSOIRange(sh.mapSelector, cnt);
                    sh.varname = `Start of injection (SOI) ${t} °C [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.023437;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xAxisCorrection = 0.01;
                    sh.xaxisUnits = "mg/st";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.zAxisDescr = "Start position (degrees BTDC)";
                } else if (xHi === 0xDD && yHi === 0xC0) {
                    this.applyPumpVoltage(sh, newSymbols, newCodeBlocks, true);
                } else if (xHi === 0xE0 && yHi === 0xC2) {
                    this.applyPumpVoltage(sh, newSymbols, newCodeBlocks, true);
                }
            }

            // ========== Length 416 (16x13): Smoke / N75 / SOI / EGR ==========
            else if (sh.length === 416 && sh.xAxisLength === 0x10 && sh.yAxisLength === 0x0D) {
                if (xHi === 0xF9 && (yHi === 0xDB || yHi === 0xDA)) {
                    this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDC64 && yId === 0xDA2A) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xHi === 0xDC && yHi === 0xDA) {
                    this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks, "Smoke limiter II");
                } else if (xId === 0xDDDC && yId === 0xDA52) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xId === 0xDD50 && yId === 0xEA44) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xId === 0xEBDA && yId === 0xEA5A) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xId === 0xE08A && yId === 0xDDD8) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xId === 0xDD7A && yId === 0xD9B6) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xHi === 0xDC && yHi === 0xEA) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if (xId === 0xDD7C && yId === 0xD9B6) {
                    this.applyN75DCV(sh, newCodeBlocks);
                } else if ((xId & 0xFFF0) === 0xDD50 && yId === 0xC01E) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDD50 && yId === 0xC024) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xEBDA && yId === 0xC048) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDD7C && yId === 0xD904) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDC64 && yId === 0xD908) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDD7A && yId === 0xD904) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xDDDC && yId === 0xD908) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xE0 && yId === 0xDE00) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xId === 0xE08A && yId === 0xDD30) {
                    this.applyEGRV(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xE0 && yHi === 0xDE) {
                    this.applySOIN108V(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xE0 && yHi === 0xDD) {
                    this.applySOIN108V(sh, newSymbols, newCodeBlocks);
                } else if (xHi === 0xDD && yHi === 0xDC) {
                    this.applySOIN108V(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 392 (14x14, DC/C0): EGR ==========
            if (sh.length === 392 && sh.xAxisLength === 14 && sh.yAxisLength === 14 && xHi === 0xDC && yHi === 0xC0) {
                this.applyEGRV(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 384: Inverse driver wish / Smoke / EGR ==========
            if (sh.length === 384) {
                if (sh.xAxisLength === 12 && sh.yAxisLength === 16) {
                    if (xHi === 0xDD && yHi === 0xC0) this.applyInverseDriverWish(sh, newCodeBlocks);
                    else if (xHi === 0xE0 && yHi === 0xC1) this.applyInverseDriverWish(sh, newCodeBlocks);
                    else if (xHi === 0xE0 && yHi === 0xC2) this.applyInverseDriverWish(sh, newCodeBlocks);
                    else if (xId === 0xEBDA && yId === 0xC04A) this.applyInverseDriverWish(sh, newCodeBlocks);
                }
                if (sh.xAxisLength === 16 && sh.yAxisLength === 12) {
                    if (xHi === 0xE0 && yHi === 0xDC) this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xDD && yHi === 0xDA) this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xDC && yHi === 0xD9) this.applyEGRV(sh, newSymbols, newCodeBlocks);
                    else if (xHi === 0xDD && yHi === 0xD9) this.applyEGRV(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 364 (14x13): EGR ==========
            if (sh.length === 364 && sh.xAxisLength === 14 && sh.yAxisLength === 13) {
                if (xHi === 0xDC && yHi === 0xC0) this.applyEGRV(sh, newSymbols, newCodeBlocks);
                if (xHi === 0xDC && yHi === 0xD9) this.applyEGRV(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 338 (13x13, DC/D9): EGR ==========
            if (sh.length === 338 && sh.xAxisLength === 13 && sh.yAxisLength === 13 && xHi === 0xDC && yHi === 0xD9) {
                this.applyEGRV(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 320 (16x10): Boost target / Driver wish / Smoke / Boost correction ==========
            if (sh.length === 320) {
                if (xHi === 0xDD && yHi === 0xC0) this.applyBoostTargetV(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xDC && yId === 0xC0BA) this.applyDriverWishV(sh, newCodeBlocks);
                else if (xHi === 0xDC && (yId & 0xFFF0) === 0xC030) this.applyBoostTargetV(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xE0 && yHi === 0xC3) this.applyBoostTargetV(sh, newSymbols, newCodeBlocks);
                else if (xId === 0xEBDA && yId === 0xC03A) this.applyBoostTargetV(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xDD && yHi === 0xDA) this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xE0 && yHi === 0xDC) this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                else if (xId === 0xEBDA && yId === 0xDA70) this.applySmokeLimiterV(sh, newSymbols, newCodeBlocks);
                else if (xHi === 0xDA && yHi === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Boost correction by temperature [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.xAxisDescr = "IAT (celcius)";
                    sh.xAxisCorrection = 0.1;
                    sh.xAxisOffset = -273.1;
                    sh.yAxisDescr = "Requested boost";
                    sh.zAxisDescr = "Boost limit (mbar)";
                    sh.yaxisUnits = "mbar";
                    sh.xaxisUnits = "degC";
                }
            }

            // ========== Length 312 (13x12, DC/D7): SOI (N108) ==========
            if (sh.length === 312 && sh.xAxisLength === 13 && sh.yAxisLength === 12 && xHi === 0xDC && yHi === 0xD7) {
                this.applySOIN108V(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 256: Driver wish (DD/C0 or EB/C0) ==========
            else if (sh.length === 256) {
                if (xHi === 0xDD && yHi === 0xC0) this.applyDriverWishV(sh, newCodeBlocks);
                if (xHi === 0xEB && yHi === 0xC0) this.applyDriverWishV(sh, newCodeBlocks);
            }

            // ========== Length 288 (16x9): Driver wish ==========
            else if (sh.length === 288 && sh.xAxisLength === 16 && sh.yAxisLength === 9) {
                this.applyDriverWishV(sh, newCodeBlocks);
            }

            // ========== Length 208 (13x8, DC/C0): Driver wish ==========
            else if (sh.length === 208 && sh.xAxisLength === 13 && sh.yAxisLength === 8 && xHi === 0xDC && yHi === 0xC0) {
                this.applyDriverWishV(sh, newCodeBlocks);
            }

            // ========== Length 200: Boost limit map (4 variants) ==========
            else if (sh.length === 200) {
                if (xHi === 0xC0 && yHi === 0xDD) this.applyBoostLimitV(sh, newCodeBlocks);
                else if (xHi === 0xC0 && yHi === 0xDC) this.applyBoostLimitV(sh, newCodeBlocks);
                else if ((xId & 0xFFF0) === 0xC2B0 && yId === 0xE08A) this.applyBoostLimitV(sh, newCodeBlocks);
                else if (xId === 0xC034 && yId === 0xEBDA) this.applyBoostLimitV(sh, newCodeBlocks);
            }

            // ========== Length 192 (8x12): Driver wish ==========
            else if (sh.length === 192) {
                if (xHi === 0xE0 && yHi === 0xC1) this.applyDriverWishV(sh, newCodeBlocks);
                if (xHi === 0xE0 && yHi === 0xC2) this.applyDriverWishV(sh, newCodeBlocks);
                if (xHi === 0xDD && yHi === 0xC0) this.applyDriverWishV(sh, newCodeBlocks);
                if (xId === 0xEBDA && yHi === 0xC0) this.applyDriverWishV(sh, newCodeBlocks);
            }

            // ========== Length 182 (7x13): Driver wish or SOI limiter ==========
            else if (sh.length === 182) {
                if (xHi === 0xDC && yHi === 0xC0) this.applyDriverWishV(sh, newCodeBlocks);
                else if (xHi === 0xDD && yHi === 0xC3) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `SOI limiter (temperature) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.023437;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Temperature";
                    sh.xAxisCorrection = 0.1;
                    sh.xAxisOffset = -273.1;
                    sh.zAxisDescr = "SOI limit (degrees)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "°C";
                } else if (xHi === 0xDC && yHi === 0xC5) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `SOI limiter (temperature) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = 0.023437;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Temperature";
                    sh.xAxisCorrection = 0.1;
                    sh.xAxisOffset = -273.1;
                    sh.zAxisDescr = "SOI limit (degrees)";
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "°C";
                }
            }

            // ========== Length 162 (9x9): Start IQ ==========
            else if (sh.length === 162 && sh.xAxisLength === 9 && sh.yAxisLength === 9) {
                if (xHi === 0xDD && yHi === 0xC1) this.applyStartIQV(sh, newSymbols, newCodeBlocks);
                if (xId === 0xEBDA && yHi === 0xC1) this.applyStartIQV(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 150 (3x25): Torque limiter ==========
            else if (sh.length === 150 && sh.xAxisLength === 3 && sh.yAxisLength === 25) {
                this.applyTorqueLimiterV(sh, newCodeBlocks);
            }

            // ========== Length 144 (DC/C1): Start IQ ==========
            else if (sh.length === 144 && xHi === 0xDC && yHi === 0xC1) {
                this.applyStartIQV(sh, newSymbols, newCodeBlocks);
            }

            // ========== Length 138 (3x23): Torque limiter ==========
            else if (sh.length === 138 && sh.xAxisLength === 3 && sh.yAxisLength === 23) {
                this.applyTorqueLimiterV(sh, newCodeBlocks);
            }

            // ========== Length 128: MAF correction by temperature / Start IQ ==========
            else if (sh.length === 128) {
                if (xHi === 0xDD && yId === 0xC1A0 && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyMAFCorrTemp(sh, newSymbols, newCodeBlocks);
                }
                if (xHi === 0xDC && yHi === 0xC1 && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyMAFCorrTemp(sh, newSymbols, newCodeBlocks);
                }
                if (xHi === 0xE0 && yId === 0xC002 && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyMAFCorrTemp(sh, newSymbols, newCodeBlocks);
                }
                if ((xId & 0xFFF0) === 0xDD70 && yId === 0xC134 && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyMAFCorrTemp(sh, newSymbols, newCodeBlocks);
                }
                if (xId === 0xEBDA && yId === 0xC1AA && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyMAFCorrTemp(sh, newSymbols, newCodeBlocks);
                }
                if (xHi === 0xDD && yId === 0xC1A4 && this.isValidTemperatureAxis(allBytes, sh, 'Y')) {
                    this.applyStartIQV(sh, newSymbols, newCodeBlocks);
                }
            }

            // ========== Length 120 (3x20): Torque limiter ==========
            else if (sh.length === 120 && sh.xAxisLength === 3 && sh.yAxisLength === 20) {
                this.applyTorqueLimiterV(sh, newCodeBlocks);
            }

            // ========== Length 114 (3x19): Torque limiter ==========
            else if (sh.length === 114 && sh.xAxisLength === 3 && sh.yAxisLength === 19) {
                this.applyTorqueLimiterV(sh, newCodeBlocks);
            }

            // ========== Length 64 (32x1): MAF linearization ==========
            else if (sh.length === 64 && sh.xAxisLength === 32 && sh.yAxisLength === 1) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                sh.varname = `MAF linearization [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
            }

            // ========== Length 38 (19x1, X=0xE08A): Torque limiter ==========
            else if (sh.length === 38 && sh.xAxisLength === 19 && sh.yAxisLength === 1 && xId === 0xE08A) {
                this.applyTorqueLimiterV(sh, newCodeBlocks);
            }

            // ========== Length 26 (13x1, X=0xD904): MAF linearization ==========
            else if (sh.length === 26 && sh.xAxisLength === 13 && sh.yAxisLength === 1 && xId === 0xD904) {
                sh.category = "Detected maps";
                sh.subcategory = "Misc";
                sh.varname = `MAF linearization [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
            }

            // ========== Length 4 (2x1): MAP linearization / Idle RPM ==========
            else if (sh.length === 4 && sh.xAxisLength === 2 && sh.yAxisLength === 1) {
                if (xId === 0xDCD4 || xId === 0xDD28) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Misc";
                    sh.varname = `MAP linearization [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                } else if (xHi === 0xC1 && this.isValidTemperatureAxis(allBytes, sh, 'X')) {
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

    // SVBL detection with 3 sequence patterns
    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
        const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];

        // Sequence 1: DF 7A 28 00 00 00 00 00 DF 7A
        let found = true, offset = 0;
        const seq1 = [0xDF, 0x7A, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0xDF, 0x7A];
        const mask1 = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        while (found) {
            const addr = Tools.findSequence(allBytes, offset, seq1, mask1);
            if (addr > 0) {
                const shsvbl = this.createSymbolHelper();
                shsvbl.category = "Detected maps";
                shsvbl.subcategory = "Limiters";
                shsvbl.flashStartAddress = addr - 2;
                if (shsvbl.flashStartAddress >= 2) {
                    const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                    if (testValue === 0xC300) shsvbl.flashStartAddress -= 2;
                }
                shsvbl.varname = `SVBL Boost limiter [${this.determineCodeBlockDescription(shsvbl.flashStartAddress, newCodeBlocks)}]`;
                shsvbl.length = 2;
                shsvbl.codeBlock = this.determineCodeBlockByAddress(shsvbl.flashStartAddress, newCodeBlocks);
                newSymbols.push(shsvbl);

                // Search for MAP/MAF switch near SVBL
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, addr - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh = this.createSymbolHelper();
                    mapmafsh.flashStartAddress = mapMafAddr;
                    mapmafsh.length = 2;
                    mapmafsh.varname = `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`;
                    mapmafsh.description = "Controls whether ECU uses MAP or MAF sensor";
                    mapmafsh.category = "Detected maps";
                    mapmafsh.subcategory = "Switches";
                    mapmafsh.zAxisDescr = "0 = MAF, 257 = MAP";
                    mapmafsh.codeBlock = this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks);
                    newSymbols.push(mapmafsh);
                }

                offset = addr + 1;
            } else found = false;
        }

        // Sequence 2: 7F C3 10 27 10 27 + 8
        found = true; offset = 0;
        const seq2 = [0x7F, 0xC3, 0x10, 0x27, 0x10, 0x27];
        const mask2 = [1, 1, 1, 1, 1, 1];
        while (found) {
            const addr = Tools.findSequence(allBytes, offset, seq2, mask2);
            if (addr > 0) {
                const shsvbl = this.createSymbolHelper();
                shsvbl.category = "Detected maps";
                shsvbl.subcategory = "Limiters";
                shsvbl.flashStartAddress = addr + 8;
                if (shsvbl.flashStartAddress >= 2) {
                    const testValue = Tools.readUint16(allBytes, shsvbl.flashStartAddress, true);
                    if (testValue === 0xC300) shsvbl.flashStartAddress -= 2;
                }
                shsvbl.varname = `SVBL Boost limiter [${this.determineCodeBlockDescription(shsvbl.flashStartAddress, newCodeBlocks)}]`;
                shsvbl.length = 2;
                shsvbl.codeBlock = this.determineCodeBlockByAddress(shsvbl.flashStartAddress, newCodeBlocks);
                newSymbols.push(shsvbl);

                // Search for MAP/MAF switch near SVBL
                const MAPMAFSwitch = Tools.findSequence(allBytes, Math.max(0, addr - 0x100), mapMafSeq, mapMafMask);
                if (MAPMAFSwitch > 0) {
                    const mapMafAddr = MAPMAFSwitch + 2;
                    const mapmafsh = this.createSymbolHelper();
                    mapmafsh.flashStartAddress = mapMafAddr;
                    mapmafsh.length = 2;
                    mapmafsh.varname = `MAP/MAF switch (0 = MAF, 257/0x101 = MAP) [${this.determineCodeBlockDescription(mapMafAddr, newCodeBlocks)}]`;
                    mapmafsh.description = "Controls whether ECU uses MAP or MAF sensor";
                    mapmafsh.category = "Detected maps";
                    mapmafsh.subcategory = "Switches";
                    mapmafsh.zAxisDescr = "0 = MAF, 257 = MAP";
                    mapmafsh.codeBlock = this.determineCodeBlockByAddress(mapMafAddr, newCodeBlocks);
                    newSymbols.push(mapmafsh);
                }

                offset = addr + 1;
            } else found = false;
        }
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
        for (const ah of newAxisHelpers) { if (ah.axisID === id) return; }
        newAxisHelpers.push({ axisID: id, description: descr, units: units, correction: correction, offset: offset });
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
                        break;
                    }
                }
            }
        }
    }
}
