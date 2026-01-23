import { useState, useEffect } from 'react'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Info as InfoIcon, RefreshCw, Download, Check } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SearchableSelect } from '../SearchableSelect'
import { ERROR_TYPES } from '@/hooks/useModelFetcher'
import { isElectron } from '@/lib/electron'
import { InstallOpenCodeDialog } from './InstallOpenCodeDialog'

export function PreferencesTab({
  provider,
  setProvider,
  model,
  setModel,
  allProviders,
  defaultModels,
  fetchStatus,
  getModelsForProvider
}) {
  const [bundledVersion, setBundledVersion] = useState(null)
  const [installedVersion, setInstalledVersion] = useState(null)
  const [currentVersion, setCurrentVersion] = useState(null)
  const [availableVersions, setAvailableVersions] = useState([])
  const [latestVersion, setLatestVersion] = useState(null)
  const [loading, setLoading] = useState(false)
  const [showInstallDialog, setShowInstallDialog] = useState(false)
  const [targetInstallVersion, setTargetInstallVersion] = useState(null)

  // Load OpenCode versions on mount
  useEffect(() => {
    if (isElectron() && window.electronAPI?.opencode) {
      loadVersions()
    }
  }, [])

  const loadVersions = async () => {
    setLoading(true)
    try {
      // Get available versions from GitHub
      const availResult = await window.electronAPI.opencode.getAvailableVersions()
      if (availResult.success) {
        setLatestVersion(availResult.latestVersion)
        setAvailableVersions(availResult.versions)
      }

      // Get installed version info
      const installedResult = await window.electronAPI.opencode.getInstalledVersion()
      if (installedResult.success) {
        setBundledVersion(installedResult.bundledVersion)
        setInstalledVersion(installedResult.installedVersion)
        // Current version is installed if exists, otherwise bundled
        setCurrentVersion(installedResult.installedVersion || installedResult.bundledVersion)
      }
    } catch (err) {
      console.error('Failed to load OpenCode versions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleVersionSelect = (selectedVersion) => {
    // Don't allow clicking built-in version (already installed)
    if (selectedVersion === bundledVersion) {
      return
    }

    // Check if this version is already installed
    if (selectedVersion === installedVersion) {
      setCurrentVersion(selectedVersion)
      return
    }

    // Show install dialog for new version
    setTargetInstallVersion(selectedVersion)
    setShowInstallDialog(true)
  }

  const handleInstallComplete = async (version) => {
    // Refresh version info
    await loadVersions()
  }
  const handleProviderChange = (value) => {
    setProvider(value)
    const newProvider = allProviders.find(p => p.id === value)
    if (newProvider && newProvider.models && newProvider.models.length > 0) {
      setModel(newProvider.models[0].id)
    } else {
      // For providers without static models, get fetched models
      const cached = getModelsForProvider(value)
      if (cached.length > 0) {
        setModel(cached[0].id)
      }
    }
  }

  const getModelPlaceholder = () => {
    if (fetchStatus.loading) return 'Loading models...'
    if (fetchStatus.errorType === ERROR_TYPES.NO_API_KEY) return 'Configure API key first'
    if (fetchStatus.errorType === ERROR_TYPES.INVALID_KEY) return 'Invalid API key'
    if (fetchStatus.error) return 'Error loading models'
    if (defaultModels.length === 0) return 'No models available'
    return 'Select default model...'
  }

  return (
    <ScrollArea className="h-[400px] pr-4">
      <div className="space-y-4">
        <div>
          <h3 className="text-lg font-semibold mb-2">Default Settings</h3>
          <p className="text-sm text-muted-foreground mb-4">
            Set your preferred provider and model for new conversations. You can still change these during any conversation.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-provider" className="text-sm font-medium">
            Default Provider
          </Label>
          <SearchableSelect
            value={provider}
            onValueChange={handleProviderChange}
            options={allProviders}
            placeholder="Select default provider..."
            searchPlaceholder="Search providers..."
            showDescription={true}
            className="w-full justify-start"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="default-model" className="text-sm font-medium">
            Default Model
          </Label>
          <SearchableSelect
            value={model}
            onValueChange={setModel}
            options={defaultModels}
            placeholder={getModelPlaceholder()}
            searchPlaceholder="Search models..."
            showDescription={true}
            className="w-full justify-start"
          />
        </div>

        {/* Default Agent */}
        {isElectron() && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">Default Agent</Label>
            <SearchableSelect
              value={currentVersion || ''}
              onValueChange={handleVersionSelect}
              options={[
                // Bundled version always first
                bundledVersion && {
                  id: bundledVersion,
                  name: `OpenCode v${bundledVersion}`,
                  description: 'Built-in',
                  badge: 'Built-in',
                  badgeVariant: 'secondary'
                },
                // Available versions
                ...availableVersions.map(version => ({
                  id: version,
                  name: `OpenCode v${version}`,
                  description: version === installedVersion ? 'Installed' : 'Click to install',
                  badge: version === latestVersion ? 'Latest' : null
                }))
              ].filter(Boolean)}
              placeholder={loading ? 'Loading...' : 'Select version...'}
              searchPlaceholder="Search versions..."
              showDescription={true}
              className="w-full justify-start"
              disabled={loading}
            />
          </div>
        )}

        {/* Install Dialog */}
        <InstallOpenCodeDialog
          open={showInstallDialog}
          onOpenChange={setShowInstallDialog}
          version={targetInstallVersion}
          onInstallComplete={handleInstallComplete}
        />

        <Alert>
          <InfoIcon className="h-5 w-5" />
          <AlertTitle>About Defaults</AlertTitle>
          <AlertDescription className="text-sm">
            These settings will be used when you start a new conversation. You can always override them using the provider and model selectors at the top of any chat.
          </AlertDescription>
        </Alert>
      </div>
    </ScrollArea>
  )
}
