
import React from 'react';
import { MbeSheet, MbeRow, ColumnType } from '../types';

interface SheetTableProps {
  sheet: MbeSheet;
  onSheetDataChange: (updatedSheet: MbeSheet) => void;
  isLoading?: boolean; // To disable buttons during global loading
}

const formatCsvCell = (value: string | number): string => {
  const strValue = String(value);
  // If the value contains a comma, newline, or double quote, enclose it in double quotes.
  // Also, double up any existing double quotes within the value.
  if (strValue.includes(',') || strValue.includes('\n') || strValue.includes('"')) {
    return `"${strValue.replace(/"/g, '""')}"`;
  }
  return strValue;
};

const SheetTable: React.FC<SheetTableProps> = ({ sheet, onSheetDataChange, isLoading }) => {
  
  const handleCellChange = (rowIndex: number, cellIndex: number, value: string | number) => {
    const newRows = sheet.rows.map((row, rIdx) => {
      if (rIdx === rowIndex) {
        const newCells = [...row.cells];
        const columnType = sheet.columns[cellIndex].type;
        if (columnType === ColumnType.INT) {
          const numValue = parseInt(value as string, 10);
          newCells[cellIndex] = isNaN(numValue) ? 0 : numValue;
        } else {
          newCells[cellIndex] = String(value);
        }
        return { ...row, cells: newCells };
      }
      return row;
    });
    onSheetDataChange({ ...sheet, rows: newRows });
  };

  const addRow = () => {
    const newRowCells = sheet.columns.map(col => {
      if (col.type === ColumnType.INT) return 0;
      return "";
    });
    const newRow: MbeRow = { id: `new-row-${Date.now()}`, cells: newRowCells };
    onSheetDataChange({ ...sheet, rows: [...sheet.rows, newRow] });
  };

  const deleteRow = (rowIndex: number) => {
    const newRows = sheet.rows.filter((_, idx) => idx !== rowIndex);
    onSheetDataChange({ ...sheet, rows: newRows });
  };

  const handleExportCsv = () => {
    if (!sheet) return;

    const headers = sheet.columns.map((col, idx) => `Col ${idx + 1} (${col.typeName})`);
    const csvRows = [
      headers.map(formatCsvCell).join(','), // Header row
      ...sheet.rows.map(row => 
        row.cells.map(formatCsvCell).join(',')
      ) // Data rows
    ];
    const csvString = csvRows.join('\r\n');
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    const safeSheetName = sheet.name.replace(/[^a-z0-9_.-]/gi, '_') || 'sheet_data';
    link.setAttribute('download', `${safeSheetName}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!sheet) return <div className="p-4 text-center text-gray-400">No sheet data available.</div>;

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-xl">
      <div className="flex flex-col sm:flex-row justify-between items-center mb-4 gap-3">
        <h2 className="text-2xl font-semibold text-teal-400">{sheet.name}</h2>
        <div className="flex gap-3">
          <button
            onClick={handleExportCsv}
            disabled={isLoading}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50"
          >
            Export Sheet as CSV
          </button>
          <button
            onClick={addRow}
            disabled={isLoading}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out disabled:opacity-50"
          >
            Add Row
          </button>
        </div>
      </div>
      <div className="overflow-x-auto table-container rounded-md">
        <table className="min-w-full divide-y divide-gray-700" aria-label={`${sheet.name} data table`}>
          <thead className="bg-gray-700 sticky top-0 z-10">
            <tr>
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">#</th>
              {sheet.columns.map((col, idx) => (
                <th key={idx} scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Col {idx + 1} ({col.typeName})
                </th>
              ))}
              <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
            </tr>
          </thead>
          <tbody className="bg-gray-800 divide-y divide-gray-700">
            {sheet.rows.map((row, rowIndex) => (
              <tr key={row.id} className="hover:bg-gray-750 transition-colors duration-150">
                <td className="px-3 py-2 whitespace-nowrap text-sm text-gray-400">{rowIndex + 1}</td>
                {row.cells.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-1 py-1 whitespace-nowrap">
                    <input
                      type={sheet.columns[cellIndex].type === ColumnType.INT ? 'number' : 'text'}
                      value={cell}
                      onChange={(e) => handleCellChange(rowIndex, cellIndex, sheet.columns[cellIndex].type === ColumnType.INT ? parseInt(e.target.value) : e.target.value)}
                      className="w-full px-2 py-1 bg-gray-700 border border-gray-600 rounded-md text-gray-200 focus:ring-teal-500 focus:border-teal-500 text-sm"
                      aria-label={`Row ${rowIndex + 1}, Column ${sheet.columns[cellIndex].typeName} ${cellIndex + 1}`}
                      disabled={isLoading}
                    />
                  </td>
                ))}
                <td className="px-3 py-2 whitespace-nowrap">
                  <button 
                    onClick={() => deleteRow(rowIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors duration-150 text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded disabled:opacity-50"
                    aria-label={`Delete row ${rowIndex + 1}`}
                    disabled={isLoading}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sheet.rows.length === 0 && (
        <p className="text-center text-gray-500 py-4">This sheet is empty. Add some rows or import a CSV!</p>
      )}
    </div>
  );
};

export default SheetTable;
