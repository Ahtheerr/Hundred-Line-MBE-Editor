
import React from 'react';
import { MbeSheet, MbeRow, ColumnType } from '../types';

interface SheetTableProps {
  sheet: MbeSheet;
  onSheetDataChange: (updatedSheet: MbeSheet) => void;
}

const SheetTable: React.FC<SheetTableProps> = ({ sheet, onSheetDataChange }) => {
  
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

  if (!sheet) return <div className="p-4 text-center text-gray-400">No sheet data available.</div>;

  return (
    <div className="p-4 bg-gray-800 rounded-lg shadow-xl">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-2xl font-semibold text-teal-400">{sheet.name}</h2>
        <button
          onClick={addRow}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white font-semibold rounded-lg shadow-md transition duration-150 ease-in-out"
        >
          Add Row
        </button>
      </div>
      <div className="overflow-x-auto table-container rounded-md">
        <table className="min-w-full divide-y divide-gray-700">
          <thead className="bg-gray-700 sticky top-0 z-10">
            <tr>
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">#</th>
              {sheet.columns.map((col, idx) => (
                <th key={idx} className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  Col {idx + 1} ({col.typeName})
                </th>
              ))}
              <th className="px-3 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">Actions</th>
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
                    />
                  </td>
                ))}
                <td className="px-3 py-2 whitespace-nowrap">
                  <button 
                    onClick={() => deleteRow(rowIndex)}
                    className="text-red-500 hover:text-red-700 transition-colors duration-150 text-xs px-2 py-1 bg-red-800 hover:bg-red-700 rounded"
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
        <p className="text-center text-gray-500 py-4">This sheet is empty. Add some rows!</p>
      )}
    </div>
  );
};

export default SheetTable;
    