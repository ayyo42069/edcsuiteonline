export enum EDCFileType {
    EDC15P = "EDC15P",
    EDC15P6 = "EDC15P6",
    EDC15V = "EDC15V",
    EDC15C = "EDC15C",
    EDC15M = "EDC15M",
    EDC16 = "EDC16",
    EDC17 = "EDC17",
    MSA15 = "MSA15",
    MSA12 = "MSA12",
    MSA11 = "MSA11",
    MSA6 = "MSA6",
    Unknown = "Unknown"
}

export enum GearboxType {
    Manual,
    Automatic,
    FourByFour, // 4x4 in C# code, but variable names can't start with number
    Unknown
}

export interface CodeBlock {
    blockGearboxType: GearboxType;
    startAddress: number;
    endAddress: number;
    codeID: number;
    addressID: number;
}

export interface AxisHelper {
    axisID: number;
    description: string;
    units: string;
    correction: number;
    offset: number;
}

export interface MapSelector {
    mapIndexes: number[]; // Changed from Int32Array to number[] for easier handling
    mapData: number[];
    startAddress: number;
    numRepeats: number;
    xAxisAddress: number;
    yAxisAddress: number;
    xAxisID: number;
    yAxisID: number;
    xAxisLen: number;
    yAxisLen: number;
    mapLength: number;
}

export interface SymbolHelper {
    // Flags
    is1D: boolean;
    is2D: boolean;
    is3D: boolean;
    selected: boolean;
    xaxisAssigned: boolean;
    yaxisAssigned: boolean;

    // Properties
    flashStartAddress: number; // Int64 in C#, but number (double) is fine for 512KB file addresses
    length: number;
    varname: string;
    userDescription: string;
    description: string;
    category: string;
    subcategory: string;
    
    // Axis Info
    xaxisUnits: string;
    yaxisUnits: string;
    xAxisLength: number;
    yAxisLength: number;
    xAxisID: number;
    yAxisID: number;
    xAxisAddress: number;
    yAxisAddress: number;
    xAxisDescr: string;
    yAxisDescr: string;
    zAxisDescr: string;
    
    // Correction/Offsets
    xAxisCorrection: number;
    xAxisOffset: number;
    yAxisCorrection: number;
    yAxisOffset: number;
    correction: number;
    offset: number;

    codeBlock: number;
    
    // Extended properties
    mapSelector?: MapSelector;
    bitMask?: number;
    color?: string; // Hex string or CSS color
    symbolNumber?: number;
    symbolType?: number;
    internalAddress?: number;
    
    // Helpers
    currentData?: Uint8Array;
}

export interface ECUInfo {
    hp: number;
    tq: number;
    fuelType: string;
    carMake: string;
    carType: string;
    engineType: string;
    ecuType: string;
    partNumber: string;
    softwareID: string;
    fuellingType: string;
}

export type SymbolCollection = SymbolHelper[];
