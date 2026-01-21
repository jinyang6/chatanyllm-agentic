/**
 * Chat Header Component
 * Displays provider/model selection, sidebar toggle, and status badges
 */

import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { SearchableSelect } from '@/components/SearchableSelect'
import {
  RefreshCw as RefreshCwIcon,
  AlertTriangle as AlertTriangleIcon,
  WifiOff as WifiOffIcon,
  Key as KeyIcon,
  PanelLeftClose as ChevronsLeftIcon,
  PanelLeftOpen as ChevronsRightIcon
} from 'lucide-react'
import { ERROR_TYPES } from '@/hooks/useModelFetcher'

export function ChatHeader({
  // Sidebar props
  sidebarOpen,
  onToggleSidebar,

  // Provider/Model selection
  provider,
  model,
  allProviders,
  currentModels,
  onProviderChange,
  onModelChange,

  // Model fetching
  fetchStatus,
  usingFallback,
  onRefreshModels
}) {
  return (
    <div className="border-b px-6 py-4 bg-muted/10">
      <div className="flex items-center gap-6">
        {/* Sidebar Toggle Button */}
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleSidebar}
                className="h-16 w-16 flex-shrink-0"
              >
                {sidebarOpen ? (
                  <ChevronsLeftIcon size={28} />
                ) : (
                  <ChevronsRightIcon size={28} />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={8} className="font-medium">
              <p className="text-sm">
                {sidebarOpen ? 'Collapse' : 'Expand'} sidebar
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                <kbd className="inline-flex h-4 select-none items-center gap-1 rounded border bg-muted px-1 font-mono text-[10px] font-medium">
                  {navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'}
                </kbd>
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>

        {/* Provider/Model Selection Container */}
        <div className="border rounded-xl p-3 flex items-center gap-3 w-fit shadow-sm bg-background">
          <Badge variant="secondary" className="text-sm px-3 py-1 bg-muted text-foreground hover:bg-muted pointer-events-none">
            Provider
          </Badge>
          <SearchableSelect
            value={provider}
            onValueChange={onProviderChange}
            options={allProviders}
            placeholder="Select provider..."
            searchPlaceholder="Search providers..."
            showDescription={true}
            className="h-10 text-base"
          />

          <Separator orientation="vertical" className="h-6" />

          <Badge variant="secondary" className="text-sm px-3 py-1 bg-muted text-foreground hover:bg-muted pointer-events-none">
            Model
          </Badge>
          <SearchableSelect
            value={model}
            onValueChange={onModelChange}
            options={currentModels}
            placeholder={
              fetchStatus.loading
                ? 'Loading models...'
                : fetchStatus.errorType === ERROR_TYPES.NO_API_KEY
                ? 'Configure API key first'
                : fetchStatus.errorType === ERROR_TYPES.INVALID_KEY
                ? 'Invalid API key'
                : fetchStatus.error
                ? 'Error loading models'
                : currentModels.length === 0
                ? 'No models available'
                : 'Select model...'
            }
            searchPlaceholder="Search models..."
            showDescription={true}
            className="h-10 min-w-[240px] text-base"
            loading={fetchStatus.loading}
            error={fetchStatus.error}
          />

          {/* Context-aware warning badges */}
          {fetchStatus.errorType === ERROR_TYPES.NO_API_KEY && (
            <Badge variant="outline" className="text-red-600 border-red-600 h-10 px-3 text-sm">
              <KeyIcon className="h-4 w-4 mr-2" />
              API Key Required
            </Badge>
          )}
          {fetchStatus.errorType === ERROR_TYPES.INVALID_KEY && (
            <Badge variant="outline" className="text-red-600 border-red-600 h-10 px-3 text-sm">
              <AlertTriangleIcon className="h-4 w-4 mr-2" />
              Invalid API Key
            </Badge>
          )}
          {fetchStatus.errorType === ERROR_TYPES.NETWORK_ERROR && usingFallback && (
            <Badge variant="outline" className="text-blue-600 border-blue-600 h-10 px-3 text-sm">
              <WifiOffIcon className="h-4 w-4 mr-2" />
              Network Error - Using Fallback
            </Badge>
          )}
          {fetchStatus.errorType === ERROR_TYPES.OTHER_ERROR && usingFallback && (
            <Badge variant="outline" className="text-yellow-600 border-yellow-600 h-10 px-3 text-sm">
              <AlertTriangleIcon className="h-4 w-4 mr-2" />
              Using Fallback Models
            </Badge>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-10 w-10"
            onClick={onRefreshModels}
            disabled={fetchStatus.loading}
            title="Refresh models"
          >
            <RefreshCwIcon className={`h-5 w-5 ${fetchStatus.loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>
    </div>
  )
}
