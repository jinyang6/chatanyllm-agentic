import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ExternalLink, Loader2 } from 'lucide-react'
import { OpenCodeDropZone } from './OpenCodeDropZone'
import { isElectron } from '@/lib/electron'

export function InstallOpenCodeDialog({ open, onOpenChange, version, onInstallComplete }) {
  const [selectedFilePath, setSelectedFilePath] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState(null)

  const handleFileSelect = (filePath) => {
    setSelectedFilePath(filePath)
    setError(null)
  }

  const handleInstall = async () => {
    if (!selectedFilePath) {
      setError('Please select opencode.exe file first')
      return
    }

    setInstalling(true)
    setError(null)

    try {
      const result = await window.electronAPI.opencode.installFromFile({
        version,
        filePath: selectedFilePath
      })

      if (result.success) {
        onInstallComplete(version)
        onOpenChange(false)
        // Reset state
        setSelectedFilePath(null)
      } else {
        setError(result.error || 'Installation failed')
      }
    } catch (err) {
      setError(err.message || 'Installation failed')
    } finally {
      setInstalling(false)
    }
  }

  const handleOpenGitHub = () => {
    const url = `https://github.com/anomalyco/opencode/releases/tag/v${version}`
    if (isElectron()) {
      window.electronAPI.shell.openExternal(url)
    } else {
      window.open(url, '_blank')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Install OpenCode v{version}</DialogTitle>
          <DialogDescription>
            Follow these steps to install OpenCode
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Step 1 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold">
                1
              </div>
              <h4 className="font-medium">Download <code className="bg-black dark:bg-white text-white dark:text-black px-1.5 py-0.5 rounded text-sm">opencode-windows-x64.zip</code></h4>
            </div>
            <div className="pl-8">
              <Button
                variant="outline"
                className="w-full"
                onClick={handleOpenGitHub}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Open GitHub Releases
              </Button>
            </div>
          </div>

          {/* Step 2 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold">
                2
              </div>
              <h4 className="font-medium">Right-click zip → "Extract All"</h4>
            </div>
          </div>

          {/* Step 3 */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="flex items-center justify-center w-6 h-6 rounded-full bg-black dark:bg-white text-white dark:text-black text-sm font-semibold">
                3
              </div>
              <h4 className="font-medium">Drag <code className="bg-black dark:bg-white text-white dark:text-black px-1.5 py-0.5 rounded text-sm">opencode.exe</code> here</h4>
            </div>
            <div className="pl-8">
              <OpenCodeDropZone
                onFileSelect={handleFileSelect}
                error={error}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={installing}
          >
            Cancel
          </Button>
          <Button
            onClick={handleInstall}
            disabled={!selectedFilePath || installing}
          >
            {installing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Installing...
              </>
            ) : (
              'Install'
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
