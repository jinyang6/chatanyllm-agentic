/**
 * Compaction Message Component
 * Shows an expandable summary of compacted (summarized) messages
 */

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

export function CompactionMessage({ message }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="my-6">
      <div className="flex items-center gap-3">
        <div className="flex-1 h-px bg-border"></div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground px-2 hover:text-foreground transition-colors cursor-pointer"
        >
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          Earlier messages summarized ({message.compactedCount || 'multiple'} messages)
        </button>
        <div className="flex-1 h-px bg-border"></div>
      </div>

      {expanded && message.content && (
        <div className="mt-4 mx-8 p-4 bg-muted/30 rounded-lg border border-border">
          <div className="text-sm text-muted-foreground whitespace-pre-wrap">
            {message.content}
          </div>
        </div>
      )}
    </div>
  )
}
