import { useState, useRef, useCallback } from 'react'
import { Upload as UploadIcon } from 'lucide-react'

export function DragDropWrapper({ children, onFileDrop }) {
  const [isDragging, setIsDragging] = useState(false)
  const dragCounterRef = useRef(0)

  const handleDragEnter = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current++

    // Check if dragging files
    if (e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }, [])

  const handleDragOver = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragLeave = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current--

    // Only hide overlay if all drag events have left
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }, [])

  const handleDrop = useCallback((e) => {
    e.preventDefault()
    e.stopPropagation()

    dragCounterRef.current = 0
    setIsDragging(false)

    // Get files and pass to parent
    const files = Array.from(e.dataTransfer.files)
    if (files.length > 0 && onFileDrop) {
      onFileDrop(files)
    }
  }, [onFileDrop])

  return (
    <div
      className="flex-1 flex flex-col h-full min-w-0 relative"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag-and-drop overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in-0 duration-200">
          <div className="border-4 border-dashed border-primary rounded-2xl p-12 bg-primary/10 max-w-md mx-auto shadow-2xl">
            <div className="flex flex-col items-center gap-4 text-center">
              <UploadIcon className="h-20 w-20 text-primary animate-pulse" />
              <div className="space-y-2">
                <p className="text-2xl font-bold text-foreground">Drop files here</p>
                <p className="text-sm text-muted-foreground">
                  Images, documents (max 10MB each)
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {children}
    </div>
  )
}
