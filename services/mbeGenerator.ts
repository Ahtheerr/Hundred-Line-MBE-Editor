
import { MbeFile, MbeSheet, MbeColumn, ColumnType, MbeRow } from '../types';
import { EXPA_MAGIC_BYTES, CHNK_MAGIC_BYTES, DEFAULT_STRING_ENCODING } from '../constants';

class ArrayBufferWriter {
  private buffers: Uint8Array[] = [];
  // textEncoder removed from here, will be instantiated in generateMbeFile
  private currentOffset = 0;

  getCurrentOffset(): number {
    return this.currentOffset;
  }

  writeBytes(bytes: Uint8Array): void {
    this.buffers.push(bytes);
    this.currentOffset += bytes.length;
  }

  // writeStringData method is removed as per new logic.
  // String encoding and padding will be handled directly in generateMbeFile.
  
  writeUint32(value: number): void {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setUint32(0, value, true); // true for little-endian
    this.writeBytes(new Uint8Array(buffer));
  }

  writeInt32(value: number): void {
    const buffer = new ArrayBuffer(4);
    const view = new DataView(buffer);
    view.setInt32(0, value, true); // true for little-endian
    this.writeBytes(new Uint8Array(buffer));
  }

  toArrayBuffer(): ArrayBuffer {
    let totalLength = 0;
    for (const buffer of this.buffers) {
      totalLength += buffer.length;
    }
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of this.buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result.buffer;
  }
}


export async function generateMbeFile(mbeFile: MbeFile): Promise<ArrayBuffer> {
  const writer = new ArrayBufferWriter();
  const textEncoder = new TextEncoder(); // Using UTF-8 by default as per constants

  // Phase 1: Collect basic sheet structural information (pre-computation for header writing)
  const sheetStructureInfos: {
    originalName: string;
    encodedNameBytes: Uint8Array; // Raw encoded name, without nulls/padding yet
    columnTypes: ColumnType[];
    expaAreaSizePerRow: number;
    rowCount: number;
  }[] = [];

  for (const sheet of mbeFile.sheets) {
    const encodedNameBytes = textEncoder.encode(sheet.name);
    
    let calculatedExpaAreaSizePerRow = 0;
    const columnTypes: ColumnType[] = sheet.columns.map(col => col.type);
    for (const column of sheet.columns) {
      if (column.type === ColumnType.INT) {
        calculatedExpaAreaSizePerRow += 4;
      } else { // STR or STRID
        calculatedExpaAreaSizePerRow += 8; 
      }
    }
    
    sheetStructureInfos.push({
        originalName: sheet.name,
        encodedNameBytes: encodedNameBytes,
        columnTypes: columnTypes,
        expaAreaSizePerRow: calculatedExpaAreaSizePerRow,
        rowCount: sheet.rows.length
    });
  }
  
  // Phase 2: Calculate true header sizes with padding (dry run), then write actual headers and collect CHNK data.

  // EXPA Magic & Sheet Count (written once at the beginning by the main writer)
  writer.writeBytes(EXPA_MAGIC_BYTES);
  writer.writeUint32(mbeFile.sheets.length);

  // --- Sub-Phase 2.1: Preliminary pass to determine total header size with padding ---
  let preliminaryHeaderWriter = new ArrayBufferWriter();
  // Mimic what the actual writer has already written to get correct relative offsets
  preliminaryHeaderWriter.writeBytes(EXPA_MAGIC_BYTES);
  preliminaryHeaderWriter.writeUint32(mbeFile.sheets.length);

  for (let i = 0; i < mbeFile.sheets.length; i++) {
    const structureInfo = sheetStructureInfos[i];
    const sLen = structureInfo.encodedNameBytes.length;
    let finalSheetNameLengthWithPadding = sLen + 2; // Default to min padding (2 nulls)

    for (let totalNulls = 2; totalNulls <= 5; totalNulls++) { // Iterate 2 to 5 total null bytes
      const prospectiveNameDataLength = sLen + totalNulls;
      // The field after sheet name data is ColumnCount (u32). Its offset needs to be aligned.
      // Offset = current preliminary writer offset + 4 (for name length field) + prospectiveNameDataLength
      const offsetAfterNameData = preliminaryHeaderWriter.getCurrentOffset() + 4 + prospectiveNameDataLength;
      if (offsetAfterNameData % 4 === 0) {
        finalSheetNameLengthWithPadding = prospectiveNameDataLength;
        break;
      }
    }
    
    preliminaryHeaderWriter.writeUint32(finalSheetNameLengthWithPadding); // Sheet name length
    preliminaryHeaderWriter.writeBytes(new Uint8Array(finalSheetNameLengthWithPadding)); // Placeholder for name data
    preliminaryHeaderWriter.writeUint32(structureInfo.columnTypes.length); // Column count
    for (const type of structureInfo.columnTypes) {
      preliminaryHeaderWriter.writeUint32(type);
    }
    preliminaryHeaderWriter.writeUint32(structureInfo.expaAreaSizePerRow);
    preliminaryHeaderWriter.writeUint32(structureInfo.rowCount);
  }
  const totalHeaderSize = preliminaryHeaderWriter.getCurrentOffset(); // Includes EXPA_MAGIC & sheetCount
  const expaDataMasterStartOffset = totalHeaderSize;
  // --- End Sub-Phase 2.1 ---


  // --- Sub-Phase 2.2: Actual header writing and CHNK data collection ---
  const chnkRawStrings: { targetExpaAbsoluteFileOffset: number; encodedBytes: Uint8Array }[] = [];
  const sheetExpaDataStartOffsets: number[] = []; // To store start offset of each sheet's EXPA data
  let runningExpaOffsetTracker = expaDataMasterStartOffset;

  for (let i = 0; i < mbeFile.sheets.length; i++) {
    const sheet = mbeFile.sheets[i]; // Full sheet data from input
    const structureInfo = sheetStructureInfos[i]; // Pre-calculated structural info

    // Determine padding for sheet name and write it
    const sLen = structureInfo.encodedNameBytes.length;
    let bestTotalNullsForSheetName = 2; // Default to min padding
    let finalSheetNameLengthWithPadding = sLen + bestTotalNullsForSheetName;

    for (let totalNulls = 2; totalNulls <= 5; totalNulls++) {
      const prospectiveNameDataLength = sLen + totalNulls;
      const offsetAfterNameData = writer.getCurrentOffset() + 4 + prospectiveNameDataLength;
      if (offsetAfterNameData % 4 === 0) {
        bestTotalNullsForSheetName = totalNulls;
        finalSheetNameLengthWithPadding = prospectiveNameDataLength;
        break;
      }
    }
    
    const paddedSheetNameBytes = new Uint8Array(finalSheetNameLengthWithPadding);
    paddedSheetNameBytes.set(structureInfo.encodedNameBytes, 0); // Actual name bytes
    // Remaining bytes in paddedSheetNameBytes are already 0x00 (nulls)

    writer.writeUint32(finalSheetNameLengthWithPadding); // Length of name data (string + nulls)
    writer.writeBytes(paddedSheetNameBytes);           // Padded name data

    // Write other header parts
    writer.writeUint32(structureInfo.columnTypes.length);
    for (const type of structureInfo.columnTypes) {
      writer.writeUint32(type);
    }
    writer.writeUint32(structureInfo.expaAreaSizePerRow);
    writer.writeUint32(structureInfo.rowCount);

    const sheetExpaDataStart = runningExpaOffsetTracker;
    sheetExpaDataStartOffsets.push(sheetExpaDataStart);

    // Collect strings for CHNK block
    for (let r = 0; r < sheet.rows.length; r++) {
      const row = sheet.rows[r];
      let currentCellAbsoluteExpaOffset = sheetExpaDataStart + (r * structureInfo.expaAreaSizePerRow);
      for (let c = 0; c < sheet.columns.length; c++) {
        const column = sheet.columns[c];
        const cellValue = row.cells[c];

        if (column.type === ColumnType.STR || column.type === ColumnType.STRID) {
          const strValue = String(cellValue);
          if (strValue !== "") { // Only add non-empty strings to CHNK
            const encodedBytes = textEncoder.encode(strValue);
            chnkRawStrings.push({
              targetExpaAbsoluteFileOffset: currentCellAbsoluteExpaOffset,
              encodedBytes: encodedBytes
            });
          }
        }
        currentCellAbsoluteExpaOffset += (column.type === ColumnType.INT ? 4 : 8);
      }
    }
    runningExpaOffsetTracker += structureInfo.expaAreaSizePerRow * structureInfo.rowCount;
  }
  // --- End Sub-Phase 2.2 ---

  // Phase 3: Write EXPA data blocks
  // The writer's current offset should now be == expaDataMasterStartOffset
  if (writer.getCurrentOffset() !== expaDataMasterStartOffset) {
     console.warn(`MBE Generator: Mismatch in calculated EXPA start offset. Expected ${expaDataMasterStartOffset}, got ${writer.getCurrentOffset()}. File output might be incorrect.`);
  }

  for (let i = 0; i < mbeFile.sheets.length; i++) {
    const sheet = mbeFile.sheets[i];
    // const currentSheetExpaStart = sheetExpaDataStartOffsets[i]; // This was for planning, writer is now at the correct spot.
    for (const row of sheet.rows) {
      for (let c = 0; c < sheet.columns.length; c++) {
        const column = sheet.columns[c];
        const cellValue = row.cells[c];
        if (column.type === ColumnType.INT) {
          writer.writeInt32(Number(cellValue));
        } else if (column.type === ColumnType.STR || column.type === ColumnType.STRID) {
          // Write 8 zero bytes as placeholder in EXPA for strings
          writer.writeUint32(0);
          writer.writeUint32(0);
        }
      }
    }
  }

  // Phase 4: Write CHNK Block (if there are any strings)
  if (chnkRawStrings.length > 0) {
    writer.writeBytes(CHNK_MAGIC_BYTES);
    writer.writeUint32(chnkRawStrings.length); 

    chnkRawStrings.sort((a,b) => a.targetExpaAbsoluteFileOffset - b.targetExpaAbsoluteFileOffset);

    for (const rawEntry of chnkRawStrings) {
      const encodedStringBytes = rawEntry.encodedBytes;
      const sLen = encodedStringBytes.length;
      let bestTotalNullBytesForChnk = 2; // Default minimum 2 nulls
      let finalTextLengthWithPadding = sLen + bestTotalNullBytesForChnk;

      // Find padding that aligns the start of the *next* CHNK entry's TargetOffset
      for (let totalNulls = 2; totalNulls <= 5; totalNulls++) {
        const prospectiveTextLength = sLen + totalNulls;
        // Offset of current CHNK entry's header + 8 (header size) + prospectiveTextLength (string data size)
        const offsetAfterThisChnkEntry = writer.getCurrentOffset() + 8 + prospectiveTextLength;
        if (offsetAfterThisChnkEntry % 4 === 0) {
          bestTotalNullBytesForChnk = totalNulls;
          finalTextLengthWithPadding = prospectiveTextLength;
          break;
        }
      }
      
      const paddedStringBytes = new Uint8Array(finalTextLengthWithPadding);
      paddedStringBytes.set(encodedStringBytes, 0); // String part
      // Remainder is 0x00 by default (null padding)

      writer.writeUint32(rawEntry.targetExpaAbsoluteFileOffset); 
      writer.writeUint32(finalTextLengthWithPadding);       
      writer.writeBytes(paddedStringBytes);            
    }
  }
  
  return writer.toArrayBuffer();
}

        