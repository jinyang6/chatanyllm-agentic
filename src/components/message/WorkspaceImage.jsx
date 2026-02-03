/**
 * Workspace Image Component
 * Loads images from workspace with support for relative paths and data URLs
 */

import { useState, useEffect } from 'react'
import { extractImageName } from '@/utils/imageDownload'

export function WorkspaceImage({ src, alt, currentConversationId, getWorkingDirectory, setPreviewImage }) {
  const [imageSrc, setImageSrc] = useState(src)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    const loadImage = async () => {
      // Check if it's already a valid URL (data URL, http, etc.)
      if (src.startsWith('data:') || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) {
        setImageSrc(src)
        setLoading(false)
        return
      }

      // It's a relative path - load from workspace
      try {
        const workingDir = getWorkingDirectory?.(currentConversationId)
        if (!workingDir?.path || !window.electronAPI?.fs) {
          setImageSrc(src)
          setLoading(false)
          return
        }

        const filePath = `${workingDir.path}\\${src}`
        const result = await window.electronAPI.fs.readFileBase64(filePath)

        if (result.success && result.data) {
          // Detect image type from filename
          const ext = src.split('.').pop().toLowerCase()
          const mimeType = ext === 'png' ? 'image/png' :
                          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                          ext === 'gif' ? 'image/gif' :
                          ext === 'webp' ? 'image/webp' : 'image/png'

          // Convert to data URL
          const dataUrl = `data:${mimeType};base64,${result.data}`
          setImageSrc(dataUrl)
        } else {
          setError(true)
        }
      } catch (err) {
        console.error('Failed to load workspace image:', src, err)
        setError(true)
      }
      setLoading(false)
    }

    loadImage()
  }, [src, currentConversationId, getWorkingDirectory])

  if (loading) {
    return <span className="text-sm text-muted-foreground italic">Loading image...</span>
  }

  if (error) {
    return <span className="text-sm text-red-500">Failed to load image: {src}</span>
  }

  return (
    <img
      src={imageSrc}
      alt={alt || 'Image'}
      className="max-w-full h-auto rounded-lg my-3 cursor-pointer hover:opacity-90 border border-border"
      onClick={() => setPreviewImage?.({ url: imageSrc, name: extractImageName(imageSrc, alt || 'markdown-image.png') })}
      onError={(e) => {
        console.error('Image failed to load. Src:', src)
        e.target.style.display = 'none'
        e.target.insertAdjacentHTML('afterend',
          '<div class="text-sm text-red-500 p-2 border border-red-200 rounded bg-red-50">Image failed to load: ' + src + '</div>'
        )
      }}
      loading="lazy"
    />
  )
}
