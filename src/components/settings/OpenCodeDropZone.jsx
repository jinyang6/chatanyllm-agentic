import { useState } from 'react'
import { Upload, FileCheck, AlertCircle } from 'lucide-react'

export function OpenCodeDropZone({ onFileSelect, error }) {
  const [isDragging, setIsDragging] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)

  const handleDragEnter = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const files = e.dataTransfer.files
    if (files.length > 0) {
      const file = files[0]
      if (file.name === 'opencode.exe') {
        setSelectedFile(file)
        onFileSelect(file.path)
      } else {
        setSelectedFile(null)
        onFileSelect(null)
      }
    }
  }

  const handleFileInput = (e) => {
    const files = e.target.files
    if (files.length > 0) {
      const file = files[0]
      if (file.name === 'opencode.exe') {
        setSelectedFile(file)
        onFileSelect(file.path)
      } else {
        setSelectedFile(null)
        onFileSelect(null)
      }
    }
  }

  return (
    <div className="space-y-2">
      <div
        className={`
          border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
          transition-colors duration-200
          ${isDragging ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : 'border-gray-300 dark:border-gray-700'}
          ${error ? 'border-red-500 bg-red-50 dark:bg-red-950' : ''}
          ${selectedFile ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950' : ''}
          hover:border-gray-400 dark:hover:border-gray-600
        `}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => document.getElementById('file-input').click()}
      >
        <input
          id="file-input"
          type="file"
          accept=".exe"
          onChange={handleFileInput}
          className="hidden"
        />

        {selectedFile ? (
          <div className="flex flex-col items-center gap-2">
            <FileCheck className="w-12 h-12 text-emerald-600 dark:text-emerald-400" />
            <p className="text-sm font-medium">{selectedFile.name}</p>
            <p className="text-xs text-gray-500">Click to select a different file</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <Upload className="w-12 h-12 text-gray-400" />
            <p className="text-sm font-medium">Drop opencode.exe here</p>
            <p className="text-xs text-gray-500">or click to browse</p>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}
    </div>
  )
}
