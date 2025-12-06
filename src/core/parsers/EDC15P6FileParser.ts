import { SymbolHelper, CodeBlock, AxisHelper, GearboxType, MapSelector, EDCFileType, SymbolCollection } from '../types';
import { Tools } from '../tools';

/**
 * Parser for EDC15P6 ECU variants
 * Based on C# EDC15P6FileParser.cs with inline map detection
 */
export class EDC15P6FileParser {

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
    }

    private isAxisID(id: number): boolean {
        const idstrip = Math.floor(id / 256);
        if (idstrip === 0xDB) return true;
        if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC4, 0xC5].includes(idstrip)) return true;
        if ([0xE0, 0xE4, 0xE5, 0xE8, 0xE9, 0xEA, 0xEB, 0xEC].includes(idstrip)) return true;
        if ([0xDA, 0xDC, 0xDD, 0xDE].includes(idstrip)) return true;
        if ([0xF9, 0xFE, 0xFC].includes(idstrip)) return true;
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
                        const newSymbol = this.createSymbolHelper();
                        newSymbol.xAxisLength = xaxislen;
                        newSymbol.yAxisLength = yaxislen;
                        newSymbol.xAxisID = xaxisid;
                        newSymbol.yAxisID = yaxisid;
                        newSymbol.xAxisAddress = t + 4;
                        newSymbol.yAxisAddress = t + 8 + (xaxislen * 2);
                        newSymbol.length = xaxislen * yaxislen * 2;
                        newSymbol.flashStartAddress = t + 8 + (xaxislen * 2) + (yaxislen * 2);
                        newSymbol.varname = `3D ${newSymbol.flashStartAddress.toString(16).toUpperCase().padStart(8, '0')}`;
                        newSymbol.is3D = true;
                        retval = this.addToSymbolCollection(newSymbols, newSymbol, newCodeBlocks);
                        if (retval) len2Skip += (xaxislen * 2) + (yaxislen * 2) + newSymbol.length;
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
                if (cb.codeID === 1) return "codeblock 1";
                if (cb.codeID === 2) return "codeblock 2";
                if (cb.codeID === 3) return "codeblock 3";
                return cb.codeID.toString();
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

    private getMaxAxisValue(allBytes: Uint8Array, sh: SymbolHelper, axis: 'X' | 'Y'): number {
        let retval = 0;
        const offset = axis === 'X' ? sh.xAxisAddress : sh.yAxisAddress;
        const length = axis === 'X' ? sh.xAxisLength : sh.yAxisLength;
        for (let i = 0; i < length; i++) {
            const val = Tools.readUint16(allBytes, offset + i * 2, true);
            if (val > retval) retval = val;
        }
        return retval;
    }

    // Comprehensive map detection based on C# EDC15P6FileParser
    private nameKnownMaps(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        for (const sh of newSymbols) {
            const xHi = Math.floor(sh.xAxisID / 256);
            const yHi = Math.floor(sh.yAxisID / 256);

            // Launch control (700 = 25*14)
            if (sh.length === 700) {
                sh.category = "Detected maps";
                sh.subcategory = "Launch Control";
                sh.varname = `Launch control map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.yAxisCorrection = 0.156250;
                sh.correction = 0.01;
                sh.xAxisDescr = "Engine speed (rpm)";
                sh.yAxisDescr = "Vehicle speed (kph)";
                sh.zAxisDescr = "Output percentage";
                sh.yaxisUnits = "km/h";
                sh.xaxisUnits = "rpm";
            }

            // Injector duration (570 = 19*15)
            else if (sh.length === 570) {
                if ((((xHi) & 0xF0) === 0xC0 && ((yHi) & 0xF0) === 0xE0) || (((xHi) & 0xF0) === 0xC1 && ((yHi) & 0xF0) === 0xE0)) {
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
            }

            // Injector duration (480 = 16*15)
            else if (sh.length === 480 && xHi === 0xC5 && yHi === 0xEC) {
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

            // Length 416 - Smoke limiter, IQ by MAF/MAP, SOI, N75, EGR
            else if (sh.length === 416) {
                if (xHi === 0xF9 && yHi === 0xDA) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Smoke limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Airflow mg/stroke";
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.1;
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                }
                else if (xHi === 0xEC && yHi === 0xDA) {
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
                }
                else if (xHi === 0xE0 && yHi === 0xC3) {
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
                else if (xHi === 0xE0 && yHi === 0xDD) {
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
                else if (xHi === 0xEA && yHi === 0xE9) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Fuel";
                    sh.varname = `Start of injection (SOI) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.correction = -0.023437;
                    sh.offset = 78;
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.yaxisUnits = "rpm";
                    sh.xAxisCorrection = 0.01;
                    sh.xaxisUnits = "mg/st";
                    sh.xAxisDescr = "IQ (mg/stroke)";
                    sh.zAxisDescr = "Start position (degrees BTDC)";
                }
                else if (xHi === 0xEA && yHi === 0xE8) {
                    if (allBytes[sh.xAxisAddress] === 0 && allBytes[sh.xAxisAddress + 1] === 0) {
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
                    } else {
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
                }
            }

            // Inverse driver wish (384 = 12*16)
            else if (sh.length === 384 && sh.xAxisLength === 12 && sh.yAxisLength === 16) {
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

            // Smoke limiter / EGR (384 = 16*12)
            else if (sh.length === 384 && sh.xAxisLength === 16 && sh.yAxisLength === 12) {
                if (xHi === 0xE0 && yHi === 0xDC) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Smoke limiter [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.zAxisDescr = "Maximum IQ (mg)";
                    sh.yAxisDescr = "Engine speed (rpm)";
                    sh.xAxisDescr = "Airflow mg/stroke";
                    sh.correction = 0.01;
                    sh.xAxisCorrection = 0.1;
                    sh.yaxisUnits = "rpm";
                    sh.xaxisUnits = "mg/st";
                }
                else if (xHi === 0xEC && yHi === 0xC0) {
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
            }

            // EGR / N75 (352 = 16*11)
            else if (sh.length === 352 && sh.xAxisLength === 16 && sh.yAxisLength === 11) {
                if (xHi === 0xEC && yHi === 0xC0) {
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
                else if (xHi === 0xEC && yHi === 0xEA) {
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
            }

            // Boost target / IQ by MAP (320 = 16*10)
            else if (sh.length === 320) {
                if ((xHi === 0xE0 && yHi === 0xC3) || (xHi === 0xEA && yHi === 0xC0)) {
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
                else if (xHi === 0xE0 && yHi === 0xDC) {
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

            // SOI limiter (308)
            else if (sh.length === 308) {
                sh.category = "Detected maps";
                sh.subcategory = "Limiters";
                sh.varname = `SOI limiter (temperature) [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                sh.correction = -0.023437;
                sh.offset = 78;
                sh.yAxisDescr = "Engine speed (rpm)";
                sh.xAxisDescr = "IAT (celcius)";
                sh.xAxisCorrection = 0.1;
                sh.xAxisOffset = -273.1;
                sh.zAxisDescr = "SOI limit (degrees)";
                sh.yaxisUnits = "rpm";
                sh.xaxisUnits = "IAT C";
            }

            // Boost target (280 = 10*14)
            else if (sh.length === 280 && xHi === 0xEC && yHi === 0xC0) {
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

            // Driver wish (256 = 8*16)
            else if (sh.length === 256) {
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

            // Driver wish (240 = 12*10)
            else if (sh.length === 240 && sh.xAxisLength === 12 && sh.yAxisLength === 10 && xHi === 0xEC && yHi === 0xC0) {
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

            // Driver wish (216 = 12*9)
            else if (sh.length === 216 && sh.xAxisLength === 12 && sh.yAxisLength === 9) {
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

            // Boost limit map (200 = 10*10)
            else if (sh.length === 200) {
                if ((xHi === 0xC2 && yHi === 0xE0) || (xHi === 0xC0 && yHi === 0xEA)) {
                    sh.category = "Detected maps";
                    sh.subcategory = "Limiters";
                    sh.varname = `Boost limit map [${this.determineCodeBlockDescription(sh.flashStartAddress, newCodeBlocks)}]`;
                    sh.yAxisDescr = "Atmospheric pressure (mbar)";
                    sh.zAxisDescr = "Maximum boost pressure (mbar)";
                    sh.xAxisDescr = "Engine speed (rpm)";
                    sh.xaxisUnits = "rpm";
                    sh.yaxisUnits = "mbar";
                }
            }

            // Driver wish (192 = 8*12)
            else if (sh.length === 192 && xHi === 0xEC && yHi === 0xC0) {
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

            // Torque limiter (138, 132, 126, 120)
            else if ((sh.length === 138 && sh.xAxisLength === 3 && sh.yAxisLength === 23) ||
                (sh.length === 132 && sh.xAxisLength === 3 && sh.yAxisLength === 22) ||
                (sh.length === 126 && sh.xAxisLength === 3 && sh.yAxisLength === 21) ||
                (sh.length === 120 && sh.xAxisLength === 3 && sh.yAxisLength === 20)) {
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
        }
    }

    // SVBL detection
    private findSVBL(allBytes: Uint8Array, newSymbols: SymbolCollection, newCodeBlocks: CodeBlock[]): void {
        let found = true, offset = 0;
        const seq = [0xDF, 0x7A, 0x28, 0x00, 0x00, 0x00, 0x00, 0x00, 0xDF, 0x7A];
        const mask = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
        while (found) {
            const addr = Tools.findSequence(allBytes, offset, seq, mask);
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
                const mapMafSeq = [0x41, 0x02, 0xFF, 0xFF, 0x00, 0x01, 0x01, 0x00];
                const mapMafMask = [1, 1, 0, 0, 1, 1, 1, 1];
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
