
import React, { useState, useCallback, useEffect } from 'react';
import { MbeFile, MbeSheet } from './types';
import { parseMbeFile } from './services/mbeParser';
import { generateMbeFile } from './services/mbeGenerator';
import SheetTable from './components/SheetTable';

const App: React.FC = () => {
  const [mbeFile, setMbeFile] = useState<MbeFile | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSheetIndex, setActiveSheetIndex] = useState<number>(0);

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
        setError(`Error parsing file: ${e.message}`);
      } finally {
        setIsLoading(false);
         // Reset file input to allow re-uploading the same file
        event.target.value = '';
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
      setError(`Error generating file: ${e.message}`);
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
        <div className="flex flex-col sm:flex-row justify-center items-center gap-4 p-6 bg-gray-800 rounded-xl shadow-2xl">
          <label htmlFor="file-upload" className="cursor-pointer px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out focus-within:ring-2 focus-within:ring-blue-400 focus-within:ring-opacity-75">
            {isLoading ? 'Processing...' : (mbeFile ? 'Load Another MBE File' : 'Load MBE File')}
          </label>
          <input id="file-upload" type="file" accept=".mbe,.*" className="hidden" onChange={handleFileChange} disabled={isLoading} />
          {mbeFile && (
            <button
              onClick={handleSaveFile}
              disabled={isLoading}
              className="px-6 py-3 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50"
            >
              {isLoading ? 'Saving...' : 'Save MBE File'}
            </button>
          )}
        </div>
        {fileName && <p className="mt-4 text-sm text-gray-400">Editing: <span className="font-semibold text-teal-300">{fileName}</span></p>}
      </header>

      {error && (
        <div className="w-full max-w-3xl p-4 mb-6 bg-red-700 border border-red-900 text-white rounded-lg shadow-lg">
          <p className="font-semibold">Error:</p>
          <p>{error}</p>
        </div>
      )}

      {isLoading && !mbeFile && (
         <div className="w-full max-w-3xl p-4 my-8 text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-400 mx-auto mb-4"></div>
            <p className="text-xl text-gray-300">Loading and parsing file...</p>
        </div>
      )}

      {mbeFile && mbeFile.sheets.length > 1 && (
        <nav className="w-full max-w-6xl mb-6">
          <ul className="flex flex-wrap border-b border-gray-700">
            {mbeFile.sheets.map((sheet, index) => (
              <li key={index} className="-mb-px mr-1">
                <button
                  onClick={() => setActiveSheetIndex(index)}
                  className={`inline-block py-3 px-5 font-semibold rounded-t-lg transition-colors duration-150
                    ${activeSheetIndex === index 
                      ? 'bg-gray-800 border-l border-t border-r border-gray-700 text-teal-400' 
                      : 'text-gray-400 hover:text-teal-300 hover:bg-gray-750'}`}
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
          <SheetTable sheet={currentSheet} onSheetDataChange={handleSheetDataChange} />
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
    