
import React, { useState, useCallback, useEffect, useRef } from 'react';
import { MbeFile, MbeSheet, MbeRow, ColumnType } from './types';
import { parseMbeFile } from './services/mbeParser';
import { generateMbeFile } from './services/mbeGenerator';
import SheetTable from './components/SheetTable';

// Simple CSV parser (can be expanded for more complex CSVs if needed)
// Handles basic comma separation and double-quoted fields.
// Assumes double quotes inside a quoted field are escaped as ""
const parseCsvContent = (csvText: string): string[][] => {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let inQuotes = false;
  let currentValue = '';

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i];

    if (char === '"') {
      if (inQuotes && i + 1 < csvText.length && csvText[i + 1] === '"') {
        currentValue += '"'; // Escaped double quote
        i++; // Skip next quote
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentValue.trim());
      currentValue = '';
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (csvText[i+1] === '\n' && char === '\r') i++; // Handle \r\n
      if (currentValue.length > 0 || currentRow.length > 0) { // Push last value of the row
        currentRow.push(currentValue.trim());
        rows.push(currentRow);
      }
      currentRow = [];
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  // Add the last value and row if any
  if (currentValue.length > 0 || currentRow.length > 0) {
    currentRow.push(currentValue.trim());
    rows.push(currentRow);
  }
  
  // Filter out completely empty rows that might result from trailing newlines
  return rows.filter(row => row.length > 0 && row.some(cell => cell.length > 0));
};


const App: React.FC = () => {
  const [mbeFile, setMbeFile] = useState<MbeFile | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);
  const csvInputRef = useRef<HTMLInputElement>(null);


  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setIsLoading(true);
      setError(null);
      setMbeFile(null);
      setFileName(file.name);
      setActiveSheetIndex(0);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const parsedFile = await parseMbeFile(arrayBuffer);
        setMbeFile(parsedFile);
      } catch (e: any) {
        console.error("Error parsing MBE file:", e);
        setError(`Error parsing MBE file: ${e.message}`);
      } finally {
        setIsLoading(false);
        event.target.value = ''; // Reset file input
      }
    }
  }, []);

  const handleSaveFile = useCallback(async () => {
    if (!mbeFile) return;
    setIsLoading(true);
    setError(null);
    try {
      const arrayBuffer = await generateMbeFile(mbeFile);
      const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = fileName || 'edited_file.mbe';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(link.href);
    } catch (e: any) {
      console.error("Error generating MBE file:", e);
      setError(`Error generating MBE file: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }, [mbeFile, fileName]);

  const handleSheetDataChange = useCallback((updatedSheet: MbeSheet) => {
    setMbeFile(prevMbeFile => {
      if (!prevMbeFile) return null;
      const newSheets = prevMbeFile.sheets.map((sheet, index) => 
        index === activeSheetIndex ? updatedSheet : sheet
      );
      return { ...prevMbeFile, sheets: newSheets };
    });
  }, [activeSheetIndex]);

  const handleCsvImport = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !mbeFile || !mbeFile.sheets[activeSheetIndex]) {
      if (csvInputRef.current) csvInputRef.current.value = '';
      return;
    }

    setIsLoading(true);
    setError(null);
    const currentSheetSchema = mbeFile.sheets[activeSheetIndex];

    try {
      const text = await file.text();
      const parsedCsvData = parseCsvContent(text);

      if (parsedCsvData.length === 0) {
        throw new Error("CSV file is empty or contains no valid data rows.");
      }

      // Ignore header row (first row of parsedCsvData)
      const dataRows = parsedCsvData.slice(1); 
      
      if (dataRows.length === 0) {
        // If only a header was present, treat as clearing the sheet
         setMbeFile(prevMbeFile => {
          if (!prevMbeFile) return null;
          const newSheets = [...prevMbeFile.sheets];
          newSheets[activeSheetIndex] = { ...newSheets[activeSheetIndex], rows: [] };
          return { ...prevMbeFile, sheets: newSheets };
        });
        setError("CSV contained only a header row. Sheet content cleared if it matched column count, otherwise no change.");
        // We still need to check column count of header if it exists
        if (parsedCsvData[0].length !== currentSheetSchema.columns.length) {
            throw new Error(`CSV header column count (${parsedCsvData[0].length}) does not match sheet column count (${currentSheetSchema.columns.length}). Sheet not modified.`);
        }
        return; // Exit after handling header-only case
      }


      // Validate column count against the first data row (after skipping header)
      if (dataRows[0].length !== currentSheetSchema.columns.length) {
        throw new Error(`CSV data column count (${dataRows[0].length}) does not match sheet column count (${currentSheetSchema.columns.length}).`);
      }

      const newMbeRows: MbeRow[] = dataRows.map((csvRow, rIdx) => {
        const cells = currentSheetSchema.columns.map((colSchema, cIdx) => {
          const csvCell = csvRow[cIdx];
          if (colSchema.type === ColumnType.INT) {
            const numVal = parseInt(csvCell, 10);
            return isNaN(numVal) ? 0 : numVal;
          }
          return String(csvCell === undefined ? "" : csvCell); // Handle potentially undefined cells from short rows
        });
        return { id: `csv-row-${Date.now()}-${rIdx}`, cells };
      });

      setMbeFile(prevMbeFile => {
        if (!prevMbeFile) return null;
        const newSheets = [...prevMbeFile.sheets];
        newSheets[activeSheetIndex] = { ...newSheets[activeSheetIndex], rows: newMbeRows };
        return { ...prevMbeFile, sheets: newSheets };
      });

    } catch (e: any) {
      console.error("Error importing CSV:", e);
      setError(`Error importing CSV: ${e.message}`);
    } finally {
      setIsLoading(false);
      if (csvInputRef.current) csvInputRef.current.value = ''; // Reset file input
    }
  }, [mbeFile, activeSheetIndex]);


  useEffect(() => {
    if (mbeFile && mbeFile.sheets.length > 0 && activeSheetIndex >= mbeFile.sheets.length) {
      setActiveSheetIndex(0);
    }
  }, [mbeFile, activeSheetIndex]);
  
  const currentSheet = mbeFile?.sheets[activeSheetIndex];

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center p-4 selection:bg-teal-500 selection:text-white">
      <header className="w-full max-w-6xl mb-8 text-center">
        <h1 className="text-5xl font-bold text-teal-400 tracking-tight my-6">MBE File Editor</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 p-6 bg-gray-800 rounded-xl shadow-2xl">
          <label htmlFor="file-upload" className="cursor-pointer w-full px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-opacity-75 flex justify-center items-center">
            {isLoading && !mbeFile ? 'Processing...' : (mbeFile ? 'Load Another MBE' : 'Load MBE File')}
          </label>
          <input id="file-upload" type="file" accept=".mbe,.*" className="hidden" onChange={handleFileChange} disabled={isLoading && !mbeFile} />
          
          {mbeFile && (
            <button
              onClick={handleSaveFile}
              disabled={isLoading}
              className="w-full px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50"
            >
              {isLoading && fileName ? 'Saving...' : 'Save MBE File'}
            </button>
          )}

          {mbeFile && currentSheet && (
             <label htmlFor="csv-import" className={`cursor-pointer w-full px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out ${isLoading ? 'opacity-50 cursor-not-allowed' : ''} flex justify-center items-center`}>
              {isLoading && fileName ? 'Processing...' : 'Import CSV to Sheet'}
            </label>
          )}
          <input 
            id="csv-import" 
            type="file" 
            accept=".csv" 
            className="hidden" 
            onChange={handleCsvImport} 
            ref={csvInputRef}
            disabled={!mbeFile || !currentSheet || isLoading}
          />
        </div>
        {fileName && <p className="mt-4 text-sm text-gray-400">Editing: <span className="font-semibold text-teal-300">{fileName}</span></p>}
      </header>

      {error && (
        <div className="w-full max-w-3xl p-4 mb-6 bg-red-700 border border-red-900 text-white rounded-lg shadow-lg" role="alert">
          <p className="font-semibold">Error:</p>
          <p>{error}</p>
        </div>
      )}

      {isLoading && (!mbeFile || (mbeFile && !currentSheet)) && ( // Show general loading when mbeFile is null or currentSheet is not yet available during loading
         <div className="w-full max-w-3xl p-4 my-8 text-center">
            <div role="status" aria-label="Loading" className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto mb-4"></div>
            <p className="text-xl text-gray-300">Loading and parsing file...</p>
        </div>
      )}

      {mbeFile && mbeFile.sheets.length > 1 && (
        <nav className="w-full max-w-6xl mb-6" aria-label="Sheet navigation">
          <ul className="flex flex-wrap border-b border-gray-700">
            {mbeFile.sheets.map((sheet, index) => (
              <li key={index} className="-mb-px mr-1">
                <button
                  onClick={() => setActiveSheetIndex(index)}
                  className={`inline-block py-3 px-5 font-semibold rounded-t-lg transition-colors duration-150
                    ${activeSheetIndex === index 
                      ? 'bg-gray-800 border-l border-t border-r border-gray-700 text-teal-400' 
                      : 'text-gray-400 hover:text-teal-300 hover:bg-gray-750'}`}
                  aria-current={activeSheetIndex === index ? 'page' : undefined}
                >
                  {sheet.name || `Sheet ${index + 1}`}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}

      {mbeFile && currentSheet && (
        <main className="w-full max-w-6xl">
          <SheetTable sheet={currentSheet} onSheetDataChange={handleSheetDataChange} isLoading={isLoading} />
        </main>
      )}
      
      {!mbeFile && !isLoading && !error && (
        <div className="text-center text-gray-500 mt-10">
          <p className="text-2xl">Welcome to the MBE File Editor!</p>
          <p>Please load an MBE file to begin editing.</p>
        </div>
      )}
    </div>
  );
};

export default App;
