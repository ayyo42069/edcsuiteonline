import { ECUInfo } from './types';

export class PartNumberConverter {
    engineTypeToFuellingType(engineType: string): string {
        let retval = "";
        switch (engineType) {
            case "AFD":
            case "CDX":
            case "1Z":
            case "AHU":
            case "AGR":
            case "AHH":
            case "ALE":
            case "ALH":
            case "AFN":
            case "AHF":
            case "ASV":
            case "AVG":
                retval = "VP37";
                break;
            case "BSU":
            case "BRU":
            case "BXF":
            case "BXJ":
            case "ANU":
            case "ATD":
            case "AXR":
            case "BEW":
            case "BMT":
            case "AVB":
            case "AVQ":
            case "BSW":
            case "BJB":
            case "BKC":
            case "BLS":
            case "BSV":
            case "BXE":
            case "BPZ":
            case "AJM":
            case "ATJ":
            case "AUY":
            case "BVK":
            case "AWX":
            case "ASZ":
            case "AVF":
            case "BLT":
            case "ARL":
            case "BTB":
            case "BPX":
            case "BUK":
            case "AMF":
            case "BAY":
            case "BMS":
            case "BHC":
            case "BNV":
            case "ATL":
            case "BKD":
            case "BKP":
            case "BMN": 
            case "BMR":
            case "BRD":
            case "BNM":
            case "BWB":
            case "AYZ":
            case "ANY":
                retval = "PD (pumpe duse)";
                break;
            case "BDJ":
            case "BST":
            case "BDK":
                retval = "SDI (suction diesel injection)";
                break;
            case "AKE":
            case "BAU":
            case "BDH":
            case "BCZ":
            case "BDG":
            case "BFC":
            case "AYM":
            case "AFB":
            case "AKN":
                retval = "VE mechanical distributor-type injection pump with direct injection";
                break;
        }
        return retval;
    }

    getNumberOfCylinders(engineType: string, additionalInfo: string): number {
        let retval = 0;
        switch (engineType) {
            case "AFD":
            case "CDX":
            case "1Z":
            case "AHU":
            case "AGR":
            case "AHH":
            case "ALE":
            case "ALH":
            case "AFN":
            case "AHF":
            case "ASV":
            case "AVG":
                retval = 4;
                break;
            case "BSU":
            case "BRU":
            case "BXF":
            case "BXJ":
            case "ANU":
            case "ATD":
            case "AXR":
            case "BEW":
            case "BMT":
            case "AVB":
            case "AVQ":
            case "BSW":
            case "BJB":
            case "BKC":
            case "BLS":
            case "BSV":
            case "BXE":
            case "BPZ":
            case "AJM":
            case "ATJ":
            case "AUY":
            case "BVK":
            case "AWX":
            case "ASZ":
            case "AVF":
            case "BLT":
            case "ARL":
            case "BTB":
            case "BPX":
            case "BUK":
                retval = 4;
                break;
            case "BDJ":
            case "BST":
            case "BDK":
                retval = 4;
                break;
            case "AKE":
            case "BAU":
            case "BDH":
            case "BCZ":
            case "BDG":
            case "BFC":
            case "AYM":
            case "AFB":
            case "AKN":
            case "1T":
                retval = 6;
                break;
            // 1.4 R3 PD
            case "BNM":
            case "AMF":
            case "BAY":
            case "BHC":
            case "BMS":
            case "BNV":
            case "ATL":
            case "AYZ": //1.2L R3 3L
            case "ANY": //1.2L R3 3L
                retval = 3;
                break;
            //1.9D
            case "1Y":
            case "AEF":
            //1.9 SDI VP37 EDC15V+
            case "BXT":
            case "AEY":
            case "BGM":
            case "BEQ":
            case "BGL":
            case "ANC":
            case "ASY":
            case "AQM":
                retval = 4;
                break;
            //2.0 R4 TDI PD EDC16/EDC17
            case "BKD":
            case "BKP":
            case "BMN":
            case "BMR":
            case "BRD":
                retval = 4;
                break;

        }
        if (retval === 0) {
            if (additionalInfo.toUpperCase().includes("R3")) retval = 3;
            else if (additionalInfo.toUpperCase().includes("R4")) retval = 4;
            else if (additionalInfo.toUpperCase().includes("R5")) retval = 5;
            else if (additionalInfo.toUpperCase().includes("1,4L")) retval = 3;
            else if (additionalInfo.toUpperCase().includes("2.5L")) retval = 6;
            else retval = 4;
        }
        return retval;
    }

    convertPartNumber(partNumber: string, length: number): ECUInfo {
        const retval: ECUInfo = {
            hp: 0,
            tq: 0,
            fuelType: "",
            carMake: "",
            carType: "",
            engineType: "",
            ecuType: "",
            partNumber: partNumber,
            softwareID: "",
            fuellingType: ""
        };

        // TODO: Port the massive switch statement from C# source
        // For now, we will just return the initialized object with partNumber
        
        return retval;
    }
}
