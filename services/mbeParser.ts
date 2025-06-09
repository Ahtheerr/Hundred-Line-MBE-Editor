
import { MbeFile, MbeSheet, MbeColumn, ColumnType, MbeRow } from '../types';
import { EXPA_MAGIC_BYTES, CHNK_MAGIC_BYTES, DEFAULT_STRING_ENCODING } from '../constants';

function readString(view: DataView, offset: number, length: number, encoding: string = DEFAULT_STRING_ENCODING): string {
  if (length === 0) {
    return "";
  }
  if (offset < 0 || offset + length > view.byteLength) {
    console.warn(`readString: Attempt to read from offset ${offset} with length ${length} is out of bounds (view.byteLength: ${view.byteLength}). Returning empty string.`);
    return "";
  }
  const effectiveLength = Math.min(length, view.byteLength - offset);
  if (effectiveLength <= 0) {
    return "";
  }

  const buffer = new Uint8Array(view.buffer, view.byteOffset + offset, effectiveLength);
  
  let actualLength = effectiveLength;
  for (let i = 0; i < effectiveLength; i++) {
    if (buffer[i] === 0x00) {
      actualLength = i; 
      break;
    }
  }

  const relevantBuffer = buffer.slice(0, actualLength);
  try {
    return new TextDecoder(encoding, { fatal: false, ignoreBOM: true }).decode(relevantBuffer);
  } catch (e) {
    console.warn(`readString: Failed to decode string with ${encoding}, trying latin1 as fallback. Offset: ${offset}, Length: ${length}, ActualLength: ${actualLength}`, e);
    try {
      return new TextDecoder('latin1', { fatal: false, ignoreBOM: true }).decode(relevantBuffer);
    } catch (e2) {
      console.error(`readString: Failed to decode string with latin1 fallback as well. Offset: ${offset}, Length: ${length}, ActualLength: ${actualLength}`, e2);
      return ""; 
    }
  }
}

function findMagic(view: DataView, magicBytes: Uint8Array, startOffset: number = 0): number {
  for (let i = startOffset; i <= view.byteLength - magicBytes.length; i++) {
    let found = true;
    for (let j = 0; j < magicBytes.length; j++) {
      if (view.getUint8(i + j) !== magicBytes[j]) {
        found = false;
        break;
      }
    }
    if (found) {
      return i;
    }
  }
  return -1;
}

export async function parseMbeFile(arrayBuffer: ArrayBuffer): Promise<MbeFile> {
  const view = new DataView(arrayBuffer);
  let offset = 0;

  // Verify EXPA Magic
  for (let i = 0; i < EXPA_MAGIC_BYTES.length; i++) {
    if (view.getUint8(offset + i) !== EXPA_MAGIC_BYTES[i]) {
      throw new Error("Invalid MBE file: EXPA magic number mismatch.");
    }
  }
  offset += EXPA_MAGIC_BYTES.length;

  const sheetCount = view.getUint32(offset, true);
  offset += 4;

  const sheetHeaderData: { 
    name: string; 
    columns: MbeColumn[]; 
    expaAreaSizePerRow: number; 
    expaRowCount: number; 
    sheetExpaDataStartOffset?: number; // Will be set later
  }[] = [];
  
  let currentGlobalOffset = offset; // Tracks current position for calculating EXPA data start

  // Pass 1: Read all sheet headers
  for (let i = 0; i < sheetCount; i++) {
    const sheetNameLength = view.getUint32(currentGlobalOffset, true);
    currentGlobalOffset += 4;
    const sheetName = readString(view, currentGlobalOffset, sheetNameLength);
    currentGlobalOffset += sheetNameLength;

    const columnCount = view.getUint32(currentGlobalOffset, true);
    currentGlobalOffset += 4;

    const columns: MbeColumn[] = [];
    for (let j = 0; j < columnCount; j++) {
      const typeVal = view.getUint32(currentGlobalOffset, true) as ColumnType;
      let typeName: 'int' | 'str' | 'strID';
      switch(typeVal) {
        case ColumnType.INT: typeName = 'int'; break;
        case ColumnType.STR: typeName = 'str'; break;
        case ColumnType.STRID: typeName = 'strID'; break;
        default: throw new Error(`Unknown column type: ${typeVal} for sheet ${sheetName}, column ${j}`);
      }
      columns.push({ type: typeVal, typeName });
      currentGlobalOffset += 4;
    }

    const expaAreaSizePerRow = view.getUint32(currentGlobalOffset, true);
    currentGlobalOffset += 4;
    const expaRowCount = view.getUint32(currentGlobalOffset, true);
    currentGlobalOffset += 4;

    sheetHeaderData.push({ name: sheetName, columns, expaAreaSizePerRow, expaRowCount });
  }

  const expaDataBlocksStartOffset = currentGlobalOffset; // All EXPA data starts after all headers

  // Assign sheetExpaDataStartOffset to each sheet header
  let runningExpaOffset = expaDataBlocksStartOffset;
  for (let i = 0; i < sheetCount; i++) {
    sheetHeaderData[i].sheetExpaDataStartOffset = runningExpaOffset;
    runningExpaOffset += sheetHeaderData[i].expaAreaSizePerRow * sheetHeaderData[i].expaRowCount;
  }
  const chnkSearchStartOffset = runningExpaOffset; // CHNK must be after all EXPA data

  // Pass 2: Pre-process CHNK block
  const chnkLookupMap = new Map<number, { text: string, originalChnkLength: number }>();
  const chnkMagicOffset = findMagic(view, CHNK_MAGIC_BYTES, chnkSearchStartOffset);
  
  if (chnkMagicOffset === -1) {
     // It's possible for a file to have no CHNK block if it has no strings
     console.warn(`CHNK magic number not found. Searched from ${chnkSearchStartOffset}. Assuming no strings or CHNK block is absent.`);
  } else {
    let chnkOffset = chnkMagicOffset + CHNK_MAGIC_BYTES.length;
    const numChnkEntries = view.getUint32(chnkOffset, true);
    chnkOffset += 4;

    for (let i = 0; i < numChnkEntries; i++) {
      if (chnkOffset + 8 > view.byteLength) { // Check for reading targetExpaOffset and textLength
        console.warn(`CHNK entry ${i+1}/${numChnkEntries}: Not enough data to read entry header. Stopping CHNK parse.`);
        break;
      }
      const targetExpaCellAbsoluteFileOffset = view.getUint32(chnkOffset, true);
      const textLengthIncludingNulls = view.getUint32(chnkOffset + 4, true);
      const textActualDataFileOffset = chnkOffset + 8;

      if (textActualDataFileOffset + textLengthIncludingNulls > view.byteLength) {
        console.warn(`CHNK entry ${i+1}/${numChnkEntries} for EXPA offset ${targetExpaCellAbsoluteFileOffset}: Text data (length ${textLengthIncludingNulls} at offset ${textActualDataFileOffset}) extends beyond EOF (${view.byteLength}). Skipping this entry.`);
        chnkOffset += 8 + textLengthIncludingNulls; // Still advance offset by declared size to try next entry
        if(chnkOffset > view.byteLength) chnkOffset = view.byteLength; // Prevent infinite loop if lengths are corrupt
        continue;
      }
      
      const text = readString(view, textActualDataFileOffset, textLengthIncludingNulls);
      chnkLookupMap.set(targetExpaCellAbsoluteFileOffset, { text, originalChnkLength: textLengthIncludingNulls });
      chnkOffset += 8 + textLengthIncludingNulls;
    }
  }

  // Pass 3: Populate sheets and rows using CHNK data
  const mbeSheets: MbeSheet[] = [];
  for (let i = 0; i < sheetCount; i++) {
    const header = sheetHeaderData[i];
    if (header.sheetExpaDataStartOffset === undefined) {
        throw new Error(`Internal error: sheetExpaDataStartOffset not set for sheet ${header.name}`);
    }
    const rows: MbeRow[] = [];
    let currentCellExpaFileOffsetTracker = header.sheetExpaDataStartOffset;

    for (let r = 0; r < header.expaRowCount; r++) {
      const cells: (number | string)[] = [];
      const rowBaseFileOffset = header.sheetExpaDataStartOffset + (r * header.expaAreaSizePerRow);
      let currentOffsetWithinRow = 0;

      for (let c = 0; c < header.columns.length; c++) {
        const column = header.columns[c];
        const absoluteCellExpaFileOffset = rowBaseFileOffset + currentOffsetWithinRow;

        if (column.type === ColumnType.INT) {
          if (absoluteCellExpaFileOffset + 4 > view.byteLength) {
            console.warn(`Sheet ${header.name}, Row ${r}, Col ${c} (INT): Read out of bounds. Offset: ${absoluteCellExpaFileOffset}`);
            cells.push(0); // Default value
          } else {
            cells.push(view.getInt32(absoluteCellExpaFileOffset, true));
          }
          currentOffsetWithinRow += 4;
        } else if (column.type === ColumnType.STR || column.type === ColumnType.STRID) {
          // The 8 bytes in EXPA are placeholders. Look up the string in CHNK map.
          const chnkEntry = chnkLookupMap.get(absoluteCellExpaFileOffset);
          if (chnkEntry) {
            cells.push(chnkEntry.text);
          } else {
            // If no CHNK entry points to this EXPA cell, it's an empty string.
            // Also check if the 8 bytes in EXPA are actually 0, as a sanity check for intentional empty.
            // For now, if not in map, assume empty.
            cells.push("");
          }
          currentOffsetWithinRow += 8;
        }
      }
      rows.push({ id: `row-${i}-${r}-${Date.now()}`, cells });
    }
    mbeSheets.push({ 
      name: header.name, 
      columns: header.columns, 
      rows,
      parsedExpaAreaSizePerRow: header.expaAreaSizePerRow 
    });
  }

  return { sheets: mbeSheets };
}
