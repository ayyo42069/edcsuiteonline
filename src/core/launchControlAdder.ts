import { Tools } from './tools';
import { SymbolCollection, EDCFileType } from './types';

/**
 * Launch Control Map Adder
 * Matches C# frmMain.cs btnActivateLaunchControl_ItemClick implementation
 * 
 * Searches for a specific pattern in unused flash and writes Y-axis data
 * to enable the launch control map detection
 */

// ECU types that support launch control (based on 700-byte map detection in parsers)
export const LAUNCH_CONTROL_SUPPORTED_TYPES: EDCFileType[] = [
    EDCFileType.EDC15P,
    EDCFileType.EDC15P6,
    EDCFileType.EDC15V,
    EDCFileType.EDC15C,
    EDCFileType.EDC15M
];

/**
 * Check if file type supports launch control
 */
export function supportsLaunchControl(fileType: EDCFileType): boolean {
    return LAUNCH_CONTROL_SUPPORTED_TYPES.includes(fileType);
}

/**
 * Check if launch control map already exists in symbols
 */
export function hasLaunchControlMap(symbols: SymbolCollection): boolean {
    return symbols.some(s =>
        s.varname?.toLowerCase().includes('launch control') ||
        s.subcategory === 'Launch Control'
    );
}

/**
 * Find potential launch control locations in the file
 * C# Pattern: FF FF 02 00 80 00 00 0A FF FF 02 00 00 00 70 17
 * Mask:       0  0  1  1  1  1  1  1  0  0  1  1  1  1  1  1
 */
export function findLaunchControlLocations(allBytes: Uint8Array): number[] {
    const pattern = [0xFF, 0xFF, 0x02, 0x00, 0x80, 0x00, 0x00, 0x0A, 0xFF, 0xFF, 0x02, 0x00, 0x00, 0x00, 0x70, 0x17];
    const mask = [0, 0, 1, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1];

    const locations: number[] = [];
    let offset = 0;

    while (offset < allBytes.length) {
        const addr = Tools.findSequence(allBytes, offset, pattern, mask);
        if (addr > 0) {
            locations.push(addr);
            offset = addr + 1;
        } else {
            break;
        }
    }

    return locations;
}

/**
 * Add launch control map to file buffer
 * Returns the modified buffer and locations where it was added
 */
export function addLaunchControlMap(fileBuffer: ArrayBuffer): {
    buffer: ArrayBuffer,
    locationsFound: number[],
    success: boolean,
    message: string
} {
    const allBytes = new Uint8Array(fileBuffer);
    console.log("[LaunchControl] Searching for pattern in file of size:", allBytes.length);

    const locations = findLaunchControlLocations(allBytes);
    console.log("[LaunchControl] Found locations:", locations.length, locations.map(a => '0x' + a.toString(16).toUpperCase()));

    if (locations.length === 0) {
        console.log("[LaunchControl] No locations found - pattern not present in file");
        return {
            buffer: fileBuffer,
            locationsFound: [],
            success: false,
            message: 'No suitable location found for launch control map. The file may not have the required unused flash area.'
        };
    }

    // Create a copy of the buffer for modification
    const modifiedBuffer = fileBuffer.slice(0);
    const modifiedBytes = new Uint8Array(modifiedBuffer);

    // Y-axis data: 14 values (0, 20, 40, 60, 80, 100, 120, 140, 160, 180, 200, 220, 240, 260)
    // Written as big-endian 16-bit values at offset + 2
    // C# code format: [0x00, 0x0E, 0x00, 0x00, 0x00, 0x14, 0x00, 0x28, ...]
    // First 2 bytes are length indicator (0x00, 0x0E = 14)
    const yAxisData = new Uint8Array([
        0x00, 0x0E,  // Length = 14 values
        0x00, 0x00,  // 0 km/h
        0x00, 0x14,  // 20 (0x14)
        0x00, 0x28,  // 40 (0x28)
        0x00, 0x3C,  // 60 (0x3C)
        0x00, 0x50,  // 80 (0x50)
        0x00, 0x64,  // 100 (0x64)
        0x00, 0x78,  // 120 (0x78)
        0x00, 0x8C,  // 140 (0x8C)
        0x00, 0xA0,  // 160 (0xA0)
        0x00, 0xB4,  // 180 (0xB4)
        0x00, 0xC8,  // 200 (0xC8)
        0x00, 0xDC,  // 220 (0xDC)
        0x00, 0xF0,  // 240 (0xF0)
        0x01, 0x04   // 260 (0x104)
    ]);

    // Write to all found locations
    for (const addr of locations) {
        const writeAddr = addr + 2; // Skip first 2 bytes of pattern
        console.log("[LaunchControl] Writing Y-axis data at:", '0x' + writeAddr.toString(16).toUpperCase());
        if (writeAddr + yAxisData.length <= modifiedBytes.length) {
            modifiedBytes.set(yAxisData, writeAddr);
        }
    }

    console.log("[LaunchControl] Successfully modified buffer");
    return {
        buffer: modifiedBuffer,
        locationsFound: locations,
        success: true,
        message: `Launch control map activated at ${locations.length} location(s): ${locations.map(a => '0x' + a.toString(16).toUpperCase()).join(', ')}`
    };
}

/**
 * Get launch control status for UI display
 */
export function getLaunchControlStatus(
    fileType: EDCFileType,
    symbols: SymbolCollection
): {
    canAdd: boolean,
    alreadyExists: boolean,
    supported: boolean,
    message: string
} {
    const supported = supportsLaunchControl(fileType);
    const alreadyExists = hasLaunchControlMap(symbols);

    if (!supported) {
        return {
            canAdd: false,
            alreadyExists: false,
            supported: false,
            message: `Launch control not supported for ${fileType}`
        };
    }

    if (alreadyExists) {
        return {
            canAdd: false,
            alreadyExists: true,
            supported: true,
            message: 'Launch control map already exists'
        };
    }

    return {
        canAdd: true,
        alreadyExists: false,
        supported: true,
        message: 'Click to add launch control map'
    };
}
