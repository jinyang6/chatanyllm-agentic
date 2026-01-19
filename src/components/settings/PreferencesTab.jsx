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
  const [opencodeVersion, setOpencodeVersion] = useState(null)
  const [availableVersions, setAvailableVersions] = useState([])
  const [latestVersion, setLatestVersion] = useState(null)
  const [loading, setLoading] = useState(false)
  const [updating, setUpdating] = useState(false)

  // Load OpenCode versions on mount
  useEffect(() => {
    if (isElectron() && window.electronAPI?.opencode) {
      loadVersions()
    }
  }, [])

  const loadVersions = async () => {
    setLoading(true)
    try {
      const result = await window.electronAPI.opencode.getAvailableVersions()
      if (result.success) {
        setOpencodeVersion(result.currentVersion)
        setLatestVersion(result.latestVersion)
        setAvailableVersions(result.versions)
      }
    } catch (err) {
      console.error('Failed to load OpenCode versions:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleVersionChange = async (selectedVersion) => {
    if (selectedVersion === opencodeVersion) return // Already on this version

    setUpdating(true)
    try {
      const result = await window.electronAPI.opencode.update(selectedVersion)
      if (result.success) {
        setOpencodeVersion(result.version)
        await loadVersions() // Refresh versions
      }
    } catch (err) {
      console.error('Update failed:', err)
    } finally {
      setUpdating(false)
    }
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

        {/* Default Agent - OpenCode with Version Selector */}
        {isElectron() && (
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Default Agent
            </Label>
            <SearchableSelect
              value={opencodeVersion || ''}
              onValueChange={handleVersionChange}
              options={availableVersions.map(version => ({
                id: version,
                name: `OpenCode v${version}`,
                description: version === latestVersion
                  ? 'Latest'
                  : version === opencodeVersion
                    ? 'Current'
                    : ''
              }))}
              placeholder={loading ? 'Loading versions...' : updating ? 'Installing...' : 'Select OpenCode version...'}
              searchPlaceholder="Search versions..."
              showDescription={true}
              className="w-full justify-start"
              disabled={loading || updating}
              renderOption={(option) => {
                const version = option.id
                return (
                  <div className="flex items-center justify-between w-full">
                    <span>OpenCode v{version}</span>
                    <div className="flex items-center gap-2">
                      {version === latestVersion && (
                        <Badge variant="secondary" className="text-xs">Latest</Badge>
                      )}
                      {version === opencodeVersion && (
                        <Check className="h-4 w-4 text-green-500" />
                      )}
                    </div>
                  </div>
                )
              }}
            />
            {updating && (
              <p className="text-xs text-muted-foreground mt-1">
                Installing... Restart required after completion.
              </p>
            )}
          </div>
        )}

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
